#!/usr/bin/env python3
"""Terminal Swarm — Agent Swarm을 위한 터미널 제어 시스템

데몬(HTTP 서버)이 subprocess 세션들을 관리하고,
CLI 클라이언트가 HTTP API로, 브라우저가 SSE로 실시간 출력을 수신한다.
"""

import sys
import os
import json
import subprocess
import threading
import time
import signal
import re
import argparse
import asyncio
import base64
from http.server import BaseHTTPRequestHandler
from socketserver import TCPServer
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from urllib.error import URLError
from urllib.parse import quote, unquote, parse_qs
from copy import deepcopy
from collections import deque
from pathlib import Path
from datetime import datetime
import pyte

# Pre-compiled regex for ANSI stripping (hot path)
_RE_ANSI_CSI = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")
_RE_ANSI_OSC = re.compile(r"\x1b\][^\x07]*\x07")
_RE_ANSI_OTHER = re.compile(r"\x1b[^[]\S*")

_ACTIVE_CHARS = frozenset('●✻✶✽✢')

SWARM_DIR = Path.home() / ".swarm"
LOGS_DIR = SWARM_DIR / "logs"
PID_FILE = SWARM_DIR / "daemon.pid"
CONFIG_FILE = SWARM_DIR / "config.json"
DEFAULT_PORT = 7890
WS_PORT = 7891
DEFAULT_HOST = "127.0.0.1"
MAX_BUFFER_LINES = 3000
DEFAULT_SCREEN_COLS = 120
DEFAULT_SCREEN_ROWS = 40


class VTermScreen(pyte.HistoryScreen):
    """Alternate screen buffer(DEC 1049)를 지원하는 pyte Screen."""

    def __init__(self, columns, lines, history=1000):
        super().__init__(columns, lines, history=history)
        self._saved_main_buffer = None
        self._saved_main_cursor = None
        self._in_alt_screen = False

    def set_mode(self, *modes, **kwargs):
        if kwargs.get('private') and 1049 in modes:
            self._saved_main_buffer = deepcopy(self.buffer)
            self._saved_main_cursor = self.cursor.x, self.cursor.y
            self.reset()
            self._in_alt_screen = True
            modes = tuple(m for m in modes if m != 1049)
            if not modes:
                return
        super().set_mode(*modes, **kwargs)

    def reset_mode(self, *modes, **kwargs):
        if kwargs.get('private') and 1049 in modes:
            if self._in_alt_screen and self._saved_main_buffer is not None:
                self.buffer = self._saved_main_buffer
                self.cursor.x, self.cursor.y = self._saved_main_cursor
                self._in_alt_screen = False
            modes = tuple(m for m in modes if m != 1049)
            if not modes:
                return
        super().reset_mode(*modes, **kwargs)


def ensure_dirs():
    SWARM_DIR.mkdir(exist_ok=True)
    LOGS_DIR.mkdir(exist_ok=True)


# ─── Config ──────────────────────────────────────────────────────────────────

def load_config():
    """~/.swarm/config.json 로드. 없으면 빈 dict 반환."""
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}

def save_config(cfg):
    """~/.swarm/config.json 저장."""
    ensure_dirs()
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")

def auto_save_python_path():
    """현재 실행 중인 Python 경로를 config에 자동 저장."""
    cfg = load_config()
    cfg["python_path"] = sys.executable
    save_config(cfg)


def safe_filename(name):
    """파일시스템 금지 문자를 _로 치환 (한글은 유지)"""
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name)


# ─── Quick Launch ─────────────────────────────────────────────────────────────

QUICKLAUNCH_FILE = SWARM_DIR / "quicklaunch.json"

DEFAULT_QUICKLAUNCH = [
    {"name": "claude", "command": "claude"},
]

def load_quicklaunch():
    if QUICKLAUNCH_FILE.exists():
        try:
            return json.loads(QUICKLAUNCH_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []
    # 첫 사용 시 기본 Quick Launch 항목 생성
    save_quicklaunch(DEFAULT_QUICKLAUNCH)
    return list(DEFAULT_QUICKLAUNCH)

def save_quicklaunch(items):
    ensure_dirs()
    QUICKLAUNCH_FILE.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")


# ─── Session ─────────────────────────────────────────────────────────────────

class Session:
    """PTY 기반 터미널 세션 (pywinpty). 인터랙티브 프로그램 지원."""

    def __init__(self, name, command, shell=None, cwd=None):
        self.name = name
        self.command = command
        self.cwd = cwd or os.getcwd()
        self.shell = shell or self._default_shell()
        self.created_at = datetime.now().isoformat()
        self.buffer = deque(maxlen=MAX_BUFFER_LINES)
        self.raw_buffer = deque(maxlen=MAX_BUFFER_LINES)
        self.log_file = LOGS_DIR / f"{safe_filename(name)}.log"
        self.pty = None
        self._reader_thread = None
        self._lock = threading.Lock()
        self._total_lines = 0
        self._alive = False
        self._last_output_time = 0.0
        self._booted = False            # ❯ 최초 감지 여부
        self._boot_time = 0.0           # ❯ 최초 감지 시각
        self._hook_state = None         # Claude Code hook 상태: "active"|"ready"|"attention"|None
        self._hook_state_time = 0.0     # 마지막 hook 상태 변경 시각
        self._data_events = []          # WebSocket 스트리밍용 asyncio.Event 목록
        self._data_events_lock = threading.Lock()
        # pyte 가상 터미널 (TUI 앱의 현재 화면 상태 추적)
        self._vt_screen = VTermScreen(DEFAULT_SCREEN_COLS, DEFAULT_SCREEN_ROWS, history=MAX_BUFFER_LINES)
        self._vt_stream = pyte.Stream(self._vt_screen)

    def _default_shell(self):
        if os.name == "nt":
            # cmd.exe를 기본으로 사용 (ConPTY 호환성 최고)
            return os.environ.get("COMSPEC", "cmd.exe")
        return os.environ.get("SHELL", "/bin/sh")

    def start(self):
        from winpty import PtyProcess

        # 자식 프로세스용 환경변수 (SWARM_SESSION 포함)
        child_env = os.environ.copy()
        child_env["SWARM_SESSION"] = self.name
        # no-flicker 모드는 xterm.js와 충돌 (alternate screen buffer → 한글 복사 깨짐)
        child_env.pop("CLAUDE_CODE_NO_FLICKER", None)

        # 셸에 따라 명령어 구성
        if "bash" in self.shell.lower():
            spawn_cmd = f'"{self.shell}" -c "{self.command}"'
        elif "powershell" in self.shell.lower() or "pwsh" in self.shell.lower():
            spawn_cmd = f'"{self.shell}" -Command "{self.command}"'
        else:
            spawn_cmd = f'{self.shell} /c {self.command}'

        try:
            self.pty = PtyProcess.spawn(spawn_cmd, cwd=self.cwd, env=child_env)
        except Exception:
            # cwd 실패 시 기본 디렉토리로 재시도
            self.pty = PtyProcess.spawn(spawn_cmd, env=child_env)
        self._alive = True
        self._reader_thread = threading.Thread(target=self._read_output, daemon=True)
        self._reader_thread.start()

    def _read_output(self):
        try:
            with open(self.log_file, "w", encoding="utf-8") as f:
                while self.pty and self.pty.isalive():
                    try:
                        data = self.pty.read(4096)
                        if not data:
                            continue
                    except EOFError:
                        break
                    except Exception:
                        time.sleep(0.05)
                        continue

                    clean = _RE_ANSI_CSI.sub("", data)
                    clean = _RE_ANSI_OSC.sub("", clean)
                    clean = _RE_ANSI_OTHER.sub("", clean)

                    with self._lock:
                        self.raw_buffer.append(data)
                        self.buffer.append(clean)
                        self._total_lines += 1
                        self._last_output_time = time.time()
                        if '❯' in clean and not self._booted:
                            self._booted = True
                            self._boot_time = time.time()
                        # attention 상태에서 출력이 계속되면 permission 승인된 것으로 판단
                        if self._hook_state == "attention" and (time.time() - self._hook_state_time > 3):
                            self._hook_state = None  # idle로 복귀
                            self._hook_state_time = time.time()
                        # pyte 가상 터미널에 feed
                        try:
                            self._vt_stream.feed(data)
                        except Exception:
                            pass

                    f.write(clean)
                    f.flush()

                    # WebSocket 스트리밍에게 새 데이터 도착 알림
                    with self._data_events_lock:
                        for evt in self._data_events:
                            evt.set()
        except Exception as e:
            with self._lock:
                msg = f"[swarm] PTY reader error: {e}\n"
                self.buffer.append(msg)
                self.raw_buffer.append(msg)
                self._total_lines += 1
        finally:
            self._alive = False

    def _effective_ui_state(self):
        """hook 상태 우선, 없으면 기본 alive/idle 판정."""
        if not self.is_alive():
            return "exited"
        if self._hook_state:
            return self._hook_state
        return "idle"

    def _recent_lines(self, n=20):
        """버퍼에서 최근 N줄을 O(n)으로 추출. 호출자가 lock을 잡아야 함."""
        buf_len = len(self.buffer)
        start = max(0, buf_len - n)
        return [self.buffer[i] for i in range(start, buf_len)]

    def get_new_raw_lines(self, last_seen):
        with self._lock:
            current = self._total_lines
            if current <= last_seen:
                return current, []
            new_count = current - last_seen
            buf_list = list(self.raw_buffer)
            return current, buf_list[-new_count:] if new_count <= len(buf_list) else buf_list

    def register_data_event(self, evt):
        """WebSocket 스트리밍용 asyncio.Event 등록."""
        with self._data_events_lock:
            self._data_events.append(evt)

    def unregister_data_event(self, evt):
        """WebSocket 스트리밍용 asyncio.Event 해제."""
        with self._data_events_lock:
            try:
                self._data_events.remove(evt)
            except ValueError:
                pass

    def write_stdin(self, text, raw=False, chunked=False):
        if self.pty:
            try:
                if not raw and not text.endswith("\r") and not text.endswith("\n"):
                    text += "\r"
                if chunked and len(text) > 512:
                    for i in range(0, len(text), 512):
                        self.pty.write(text[i:i+512])
                        time.sleep(0.01)
                else:
                    self.pty.write(text)
                return True
            except (BrokenPipeError, OSError, EOFError):
                return False
        return False

    def read_output(self, lines=None, grep=None):
        with self._lock:
            if self._vt_screen._in_alt_screen:
                # TUI/alt screen 모드: pyte 가상 터미널에서 현재 화면 추출
                display = self._vt_screen.display
                output = [l.rstrip() for l in display if l.strip()]
            else:
                # 일반 모드: 기존 deque 버퍼 (순차 출력, -n으로 원하는 만큼 읽기 가능)
                if lines and lines > 0 and not grep:
                    n = min(lines, len(self.buffer))
                    output = [self.buffer[len(self.buffer) - n + i] for i in range(n)]
                else:
                    output = list(self.buffer)
        if grep:
            try:
                pattern = re.compile(grep, re.IGNORECASE)
                output = [l for l in output if pattern.search(l)]
            except re.error:
                output = [l for l in output if grep.lower() in l.lower()]
            if lines and lines > 0:
                output = output[-lines:]
        return output

    def is_alive(self):
        if self.pty:
            try:
                return self.pty.isalive()
            except Exception:
                return False
        return self._alive

    def resize(self, rows, cols):
        if self.pty:
            try:
                self.pty.setwinsize(rows, cols)
                with self._lock:
                    self._vt_screen.resize(rows, cols)
                return True
            except Exception:
                return False
        return False

    def wait_for(self, grep=None, exit=False, timeout=300, idle=0, lookback=50, ready=False):
        """Block until pattern found, process exits, output idle, or ui_state ready."""
        deadline = time.time() + timeout
        grep_nospace = re.sub(r'\s+', '', grep).lower() if grep else None

        # ready 모드: ui_state 기반 대기
        if ready:
            state = self._effective_ui_state()
            if state == "ready":
                return {"event": "ready", "message": f"Session '{self.name}' is ready"}
            while time.time() < deadline:
                if not self.is_alive():
                    return {"event": "exit", "message": f"Session '{self.name}' exited"}
                state = self._effective_ui_state()
                if state == "ready":
                    return {"event": "ready", "message": f"Session '{self.name}' is ready"}
                if state == "attention":
                    return {"event": "attention", "message": f"Session '{self.name}' needs input (permission prompt)"}
                time.sleep(0.5)
            return {"event": "timeout", "message": f"Timeout after {timeout}s"}

        # 기존 출력에서 패턴 먼저 검사 (lookback)
        if grep_nospace and lookback > 0:
            with self._lock:
                recent = self._recent_lines(lookback)
            for line in recent:
                line_nospace = re.sub(r'\s+', '', line).lower()
                if grep_nospace in line_nospace:
                    return {"event": "match", "pattern": grep, "line": line.strip(), "source": "lookback"}

        with self._lock:
            seen = len(self.buffer)
        last_change = time.time()
        while time.time() < deadline:
            if exit and not self.is_alive():
                return {"event": "exit", "message": f"Session '{self.name}' exited"}
            with self._lock:
                current = len(self.buffer)
            if current > seen:
                if grep_nospace:
                    new_lines = list(self.buffer)[seen:current]
                    for line in new_lines:
                        line_nospace = re.sub(r'\s+', '', line).lower()
                        if grep_nospace in line_nospace:
                            return {"event": "match", "pattern": grep, "line": line.strip()}
                seen = current
                last_change = time.time()
            elif idle > 0 and (time.time() - last_change) >= idle:
                return {"event": "idle", "message": f"No new output for {idle}s", "idle_seconds": idle}
            time.sleep(0.3)
        return {"event": "timeout", "message": f"Timeout after {timeout}s"}

    def kill(self):
        if self.pty:
            try:
                self.pty.close(force=True)
            except Exception:
                pass
        self._alive = False

    def _is_waiting_for_answer(self):
        """최근 출력에서 Claude Code 질문 대기 패턴을 감지."""
        with self._lock:
            # 최근 버퍼 5개 청크를 확인
            recent = list(self.buffer)[-5:]
        text = "".join(recent)
        # Claude Code의 AskUserQuestion 패턴: 질문 후 사용자 입력 대기
        # 터미널에 나타나는 패턴들:
        #   - "? " 로 시작하는 inquirer 스타일 프롬프트
        #   - "(y/n)" 또는 "(Y/n)" 패턴
        #   - 줄 끝에 ": " 로 끝나는 입력 대기
        patterns = [
            r'^\?\s+.+',           # inquirer 스타일: "? question text"
            r'\(y/n\)',            # yes/no 프롬프트
            r'\(Y/n\)',            # Yes/no 프롬프트
            r'\(yes/no\)',         # yes/no 프롬프트
        ]
        for pat in patterns:
            if re.search(pat, text, re.MULTILINE | re.IGNORECASE):
                return True
        return False

    def set_hook_state(self, state):
        """Claude Code hook에서 호출: 상태를 설정하고 알림 전송."""
        # Stop 이벤트 시 질문 대기 중이면 attention으로 전환
        reason = None
        if state == "ready" and self._is_waiting_for_answer():
            state = "attention"
            reason = "question"
        self._hook_state = state
        self._hook_state_time = time.time()
        if state in ("ready", "attention"):
            _send_notification(self.name, state, reason=reason)

    def to_dict(self):
        return {
            "name": self.name, "command": self.command, "cwd": self.cwd,
            "shell": self.shell,
            "pid": self.pty.pid if self.pty else None,
            "alive": self.is_alive(), "created_at": self.created_at,
            "exit_code": None,
            "buffer_lines": len(self.buffer), "log_file": str(self.log_file),
            "ui_state": self._effective_ui_state(),
        }

    def get_history(self):
        """raw_buffer 히스토리와 현재 라인 수 반환."""
        with self._lock:
            return list(self.raw_buffer), self._total_lines

    def ack_ready(self):
        """ready/attention 상태 해제."""
        with self._lock:
            if self._hook_state in ("ready", "attention"):
                self._hook_state = None


class SessionManager:
    def __init__(self):
        self.sessions = {}
        self._lock = threading.Lock()

    def create(self, name, command, shell=None, cwd=None):
        with self._lock:
            if name in self.sessions:
                old = self.sessions[name]
                if old.is_alive():
                    raise ValueError(f"Session '{name}' already exists and is running")
                del self.sessions[name]
            session = Session(name, command, shell, cwd)
            try:
                session.start()
            except Exception as e:
                raise ValueError(f"Session start failed: {e}")
            self.sessions[name] = session
            return session

    def get(self, name):
        with self._lock:
            return self.sessions.get(name)

    def list_all(self):
        with self._lock:
            return [s.to_dict() for s in self.sessions.values()]

    def rename(self, old_name, new_name):
        with self._lock:
            session = self.sessions.get(old_name)
            if not session:
                raise ValueError(f"Session '{old_name}' not found")
            if new_name in self.sessions:
                raise ValueError(f"Session '{new_name}' already exists")
            session.name = new_name
            del self.sessions[old_name]
            self.sessions[new_name] = session
            # hook 캐시에서 old_name → new_name 갱신
            for k, v in list(_hook_session_cache.items()):
                if v == old_name:
                    _hook_session_cache[k] = new_name

    def kill(self, name):
        with self._lock:
            session = self.sessions.get(name)
            if not session:
                raise ValueError(f"Session '{name}' not found")
            session.kill()
            del self.sessions[name]

    def kill_all(self):
        with self._lock:
            for s in self.sessions.values():
                s.kill()
            self.sessions.clear()


manager = SessionManager()


# ─── Dashboard HTML (SSE + 자유 스플릿) ──────────────────────────────────────

_SCRIPT_DIR = Path(__file__).resolve().parent

def _load_dashboard():
    html_path = _SCRIPT_DIR / "dashboard.html"
    return html_path.read_text(encoding="utf-8")

DASHBOARD_HTML_CACHE = None

def get_dashboard_html():
    global DASHBOARD_HTML_CACHE
    if DASHBOARD_HTML_CACHE is None:
        DASHBOARD_HTML_CACHE = _load_dashboard()
    return DASHBOARD_HTML_CACHE




# ─── System Fonts ────────────────────────────────────────────────────────────

_font_cache = None

def get_system_fonts():
    """C:\\Windows\\Fonts 에서 .ttf/.otf 폰트 이름을 추출하여 반환"""
    global _font_cache
    if _font_cache is not None:
        return _font_cache

    import struct
    fonts_dir = Path("C:/Windows/Fonts")
    seen = set()
    result = []

    def read_font_name(fp):
        """OpenType/TrueType name table에서 Font Family Name 추출"""
        try:
            with open(fp, "rb") as f:
                header = f.read(12)
                if len(header) < 12:
                    return None
                num_tables = struct.unpack(">H", header[4:6])[0]
                name_offset = None
                for _ in range(num_tables):
                    entry = f.read(16)
                    if len(entry) < 16:
                        return None
                    tag = entry[:4]
                    if tag == b"name":
                        name_offset = struct.unpack(">I", entry[8:12])[0]
                        break
                if name_offset is None:
                    return None
                f.seek(name_offset)
                name_header = f.read(6)
                if len(name_header) < 6:
                    return None
                count, string_offset = struct.unpack(">HH", name_header[2:6])
                storage_start = name_offset + string_offset
                for _ in range(count):
                    rec = f.read(12)
                    if len(rec) < 12:
                        return None
                    pid, eid, lid, nid, length, offset = struct.unpack(">6H", rec)
                    if nid == 1:  # Font Family Name
                        pos = f.tell()
                        f.seek(storage_start + offset)
                        raw = f.read(length)
                        f.seek(pos)
                        if pid == 3:  # Windows
                            return raw.decode("utf-16-be", errors="ignore").strip()
                        elif pid == 1:  # Mac
                            return raw.decode("latin-1", errors="ignore").strip()
        except Exception:
            pass
        return None

    # System fonts + User-installed fonts
    font_dirs = [fonts_dir]
    user_fonts = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/Windows/Fonts"
    if user_fonts.exists():
        font_dirs.append(user_fonts)

    for d in font_dirs:
        if not d.exists():
            continue
        for fp in d.iterdir():
            if fp.suffix.lower() in (".ttf", ".otf"):
                name = read_font_name(fp)
                if name and name not in seen:
                    seen.add(name)
                    result.append(name)

    result.sort(key=lambda x: x.lower())
    _font_cache = result
    return result


# ─── HTTP Server ─────────────────────────────────────────────────────────────

class PooledHTTPServer(TCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, server_address, RequestHandlerClass, pool_size=8):
        super().__init__(server_address, RequestHandlerClass)
        self._pool = ThreadPoolExecutor(max_workers=pool_size)

    def process_request(self, request, client_address):
        self._pool.submit(self._process_request_thread, request, client_address)

    def _process_request_thread(self, request, client_address):
        try:
            self.finish_request(request, client_address)
        except Exception:
            self.handle_error(request, client_address)
        finally:
            self.shutdown_request(request)

    def server_close(self):
        super().server_close()
        self._pool.shutdown(wait=False)

    def handle_error(self, request, client_address):
        """에러가 발생해도 서버를 죽이지 않음."""
        try:
            with open(SWARM_DIR / "error.log", "a", encoding="utf-8") as f:
                import traceback
                f.write(f"[{datetime.now().isoformat()}] Handler error from {client_address}:\n")
                traceback.print_exc(file=f)
                f.write("\n")
        except Exception:
            pass


_last_dashboard_poll = 0.0  # 대시보드 /sessions 폴링 시각 (토스트 중복 방지)

class SwarmHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def handle_one_request(self):
        """에러가 발생해도 데몬이 죽지 않도록 보호."""
        try:
            super().handle_one_request()
        except Exception as e:
            try:
                with open(SWARM_DIR / "error.log", "a", encoding="utf-8") as f:
                    f.write(f"[{datetime.now().isoformat()}] Handler error: {type(e).__name__}: {e}\n")
            except Exception:
                pass

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n)) if n else {}

    def _json(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"))

    def _html(self, code, html):
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))

    def _handle_sse(self, name):
        """SSE 스트리밍: 세션 출력을 실시간으로 브라우저에 전송."""
        session = manager.get(name)
        if not session:
            self._json(404, {"error": f"Session '{name}' not found"})
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        # 기존 히스토리 전송
        history, last_seen = session.get_history()

        if history:
            chunk = "".join(history)
            payload = json.dumps({"output": chunk}, ensure_ascii=False)
            try:
                self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
                self.wfile.flush()
            except Exception:
                return

        # 실시간 스트리밍 루프
        while True:
            time.sleep(0.15)
            current, new_lines = session.get_new_raw_lines(last_seen)
            if new_lines:
                last_seen = current
                data = "".join(new_lines)
                payload = json.dumps({"output": data}, ensure_ascii=False)
                try:
                    self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
                    self.wfile.flush()
                except Exception:
                    break  # 클라이언트 연결 끊김

    def _session_name(self, path):
        return unquote(path.split("/")[2])

    def do_GET(self):
        path = self.path.split("?")[0]
        params = {}
        if "?" in self.path:
            params = parse_qs(self.path.split("?")[1])

        if path == "/" or path == "":
            self._html(200, get_dashboard_html())

        elif path == "/reload-dashboard":
            global DASHBOARD_HTML_CACHE
            DASHBOARD_HTML_CACHE = None
            self._json(200, {"message": "dashboard cache cleared"})

        # SSE 스트리밍 엔드포인트
        elif path.startswith("/sessions/") and path.endswith("/stream"):
            name = self._session_name(path)
            self._handle_sse(name)

        elif path == "/health":
            self._json(200, {"status": "ok", "sessions": len(manager.sessions), "cwd": os.getcwd().replace("\\", "/")})
        elif path == "/sessions":
            global _last_dashboard_poll
            _last_dashboard_poll = time.time()
            self._json(200, {"sessions": manager.list_all()})
        elif path.startswith("/sessions/") and path.endswith("/read"):
            name = self._session_name(path)
            session = manager.get(name)
            if not session:
                self._json(404, {"error": f"Session '{name}' not found"})
                return
            lines = int(params.get("lines", [0])[0]) if "lines" in params else None
            grep = params.get("grep", [None])[0]
            output = session.read_output(lines=lines, grep=grep)
            self._json(200, {"name": name, "alive": session.is_alive(), "lines": len(output), "output": "".join(output)})
        elif path == "/files/search":
            query = params.get("q", [""])[0].lower()
            if not query or len(query) < 2:
                self._json(400, {"error": "query too short (min 2 chars)"})
                return
            cfg = load_config()
            ignore = set(cfg.get("tree_ignore", [])) | {".git", "node_modules", "__pycache__", "venv", ".venv", "dist", "build", ".next", ".cache"}
            results = []
            root = Path(os.getcwd()).resolve()
            max_results = 30
            max_depth = 10
            def _search(d, depth):
                if depth > max_depth or len(results) >= max_results:
                    return
                try:
                    for item in d.iterdir():
                        if item.name in ignore:
                            continue
                        if item.is_file() and query in item.name.lower():
                            results.append({"name": item.name, "path": str(item).replace("\\", "/"), "ext": item.suffix.lstrip(".")})
                            if len(results) >= max_results:
                                return
                        elif item.is_dir() and depth < max_depth:
                            _search(item, depth + 1)
                except (PermissionError, OSError):
                    pass
            _search(root, 0)
            self._json(200, {"query": query, "results": results})
        elif path == "/files/git-status":
            try:
                cwd = Path(os.getcwd()).resolve()
                # Collect git roots: either CWD itself or immediate subdirectories
                git_roots = []
                top = subprocess.run(
                    ["git", "rev-parse", "--show-toplevel"],
                    capture_output=True, text=True, timeout=5, cwd=str(cwd)
                )
                if top.returncode == 0:
                    git_roots.append(top.stdout.strip().replace("\\", "/"))
                else:
                    # CWD is not a git repo — scan immediate subdirs
                    try:
                        for item in cwd.iterdir():
                            if item.is_dir() and (item / ".git").exists():
                                git_roots.append(str(item).replace("\\", "/"))
                    except (PermissionError, OSError):
                        pass
                if not git_roots:
                    self._json(200, {"is_git": False, "files": {}, "dirs": {}, "root": ""})
                    return
                all_files = {}
                all_dirs = set()
                for git_root in git_roots:
                    result = subprocess.run(
                        ["git", "status", "--porcelain"],
                        capture_output=True, text=True, timeout=5,
                        cwd=git_root
                    )
                    for line in result.stdout.splitlines():
                        if len(line) < 4:
                            continue
                        status = line[:2].strip() or line[:2]
                        rel_path = line[3:].strip()
                        if " -> " in rel_path:
                            rel_path = rel_path.split(" -> ")[-1]
                        rel_path = rel_path.strip('"').replace("\\", "/")
                        abs_path = git_root + "/" + rel_path
                        all_files[abs_path] = status
                        # collect absolute parent dirs
                        parts = abs_path.split("/")
                        for i in range(1, len(parts)):
                            all_dirs.add("/".join(parts[:i]))
                dirs_dict = {d: True for d in sorted(all_dirs)}
                root = git_roots[0] if len(git_roots) == 1 else str(cwd).replace("\\", "/")
                self._json(200, {"is_git": True, "files": all_files, "dirs": dirs_dict, "root": root})
            except subprocess.TimeoutExpired:
                self._json(500, {"error": "git command timed out"})
            except FileNotFoundError:
                self._json(200, {"is_git": False, "files": {}, "dirs": {}, "root": ""})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/files/tree":
            tree_path = params.get("path", [os.getcwd()])[0]
            cfg = load_config()
            ignore = set(cfg.get("tree_ignore", [])) | {".git", "node_modules", "__pycache__", "venv", ".venv", "dist", "build", ".next", ".cache"}
            root = Path(tree_path).resolve()
            entries = []
            try:
                for item in sorted(root.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                    if item.name in ignore:
                        continue
                    if item.is_dir():
                        entries.append({"name": item.name, "type": "dir", "path": str(item).replace("\\", "/")})
                    elif item.is_file():
                        try:
                            size = item.stat().st_size
                        except Exception:
                            size = 0
                        entries.append({"name": item.name, "type": "file", "path": str(item).replace("\\", "/"), "ext": item.suffix.lstrip("."), "size": size})
            except PermissionError:
                pass
            except FileNotFoundError:
                self._json(404, {"error": "Directory not found"})
                return
            self._json(200, {"root": str(root).replace("\\", "/"), "entries": entries})
        elif path == "/files/read":
            file_path = params.get("path", [None])[0]
            if not file_path:
                self._json(400, {"error": "path required"})
                return
            try:
                p = Path(file_path).resolve()
                if not p.is_file():
                    self._json(404, {"error": "File not found"})
                    return
                content = p.read_text(encoding="utf-8", errors="replace")
                self._json(200, {"path": str(p), "content": content})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/presets":
            presets_file = SWARM_DIR / "presets.json"
            try:
                data = json.loads(presets_file.read_text(encoding="utf-8")) if presets_file.is_file() else {}
            except Exception:
                data = {}
            self._json(200, data)
        elif path == "/fonts":
            self._json(200, {"fonts": get_system_fonts()})
        elif path == "/quicklaunch":
            self._json(200, {"items": load_quicklaunch()})
        elif path.startswith("/sessions/"):
            name = self._session_name(path)
            session = manager.get(name)
            if not session:
                self._json(404, {"error": f"Session '{name}' not found"})
                return
            self._json(200, session.to_dict())
        else:
            self._json(404, {"error": "Not found"})

    def do_POST(self):
        path = self.path.split("?")[0]
        body = self._body()
        if path == "/sessions":
            name, command = body.get("name"), body.get("command")
            if not name or not command:
                self._json(400, {"error": "name and command are required"})
                return
            try:
                session = manager.create(name, command, body.get("shell"), body.get("cwd"))
                self._json(201, session.to_dict())
            except ValueError as e:
                self._json(409, {"error": str(e)})
            except Exception as e:
                self._json(500, {"error": f"Session start failed: {e}"})
        elif path.startswith("/sessions/") and path.endswith("/send"):
            name = self._session_name(path)
            session = manager.get(name)
            if not session:
                self._json(404, {"error": f"Session '{name}' not found"})
                return
            text = body.get("text", "")
            raw = body.get("raw", False)
            if body.get("base64"):
                try:
                    text = base64.b64decode(body["base64"]).decode("utf-8")
                except Exception as e:
                    self._json(400, {"error": f"base64 decode failed: {e}"})
                    return
                # Bracketed paste로 전송 후, 딜레이를 두고 \r을 별도 전송
                text = text.rstrip("\n\r")
                paste = "\x1b[200~" + text + "\x1b[201~"
                raw = True
                session.write_stdin(paste, raw=True, chunked=len(paste) > 512)
                time.sleep(0.5)
                session.write_stdin("\r", raw=True)
                time.sleep(0.2)
                session.write_stdin("\r", raw=True)
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                return
            chunked = len(text) > 512
            if session.write_stdin(text, raw=raw, chunked=chunked):
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
            else:
                self._json(500, {"error": "Failed to send"})
        elif path.startswith("/sessions/") and path.endswith("/rename"):
            name = self._session_name(path)
            new_name = body.get("name")
            if not new_name:
                self._json(400, {"error": "name is required"})
                return
            try:
                manager.rename(name, new_name)
                self._json(200, {"message": "renamed", "old": name, "new": new_name})
            except ValueError as e:
                self._json(409, {"error": str(e)})
        elif path.startswith("/sessions/") and path.endswith("/wait"):
            name = self._session_name(path)
            session = manager.get(name)
            if not session:
                self._json(404, {"error": f"Session '{name}' not found"})
                return
            grep = body.get("grep")
            wait_exit = body.get("exit", False)
            timeout = body.get("timeout", 300)
            idle = body.get("idle", 0)
            wait_ready = body.get("ready", False)
            if not grep and not wait_exit and idle <= 0 and not wait_ready:
                self._json(400, {"error": "grep, exit, idle, or ready required"})
                return
            lookback = body.get("lookback", 50)
            result = session.wait_for(grep=grep, exit=wait_exit, timeout=timeout, idle=idle, lookback=lookback, ready=wait_ready)
            self._json(200, result)
        elif path.startswith("/sessions/") and path.endswith("/resize"):
            name = self._session_name(path)
            session = manager.get(name)
            if not session:
                self._json(404, {"error": f"Session '{name}' not found"})
                return
            rows = body.get("rows", 24)
            cols = body.get("cols", 80)
            session.resize(rows, cols)
            self._json(200, {"message": "resized", "rows": rows, "cols": cols})
        elif path.startswith("/sessions/") and path.endswith("/ack"):
            name = self._session_name(path)
            session = manager.get(name)
            if not session:
                self._json(404, {"error": f"Session '{name}' not found"})
                return
            session.ack_ready()
            self._json(200, {"ok": True})
        elif path == "/files/resolve":
            name = body.get("name")
            if not name:
                self._json(400, {"error": "name required"})
                return
            matches = []
            # CWD + 홈 디렉토리 주요 폴더 검색
            search_roots = [Path.cwd()]
            home = Path.home()
            for d in ["Desktop", "Documents", "Downloads"]:
                p = home / d
                if p.exists() and p not in search_roots:
                    search_roots.append(p)
            for search_root in search_roots:
                try:
                    for root, dirs, files in os.walk(search_root):
                        depth = len(Path(root).relative_to(search_root).parts)
                        if depth > 4:
                            dirs.clear()
                            continue
                        if name in files:
                            fp = Path(root) / name
                            fp_str = str(fp)
                            if fp_str not in matches:
                                matches.append(fp_str)
                        if len(matches) >= 10:
                            break
                except Exception:
                    continue
                if len(matches) >= 10:
                    break
            self._json(200, {"matches": matches})
        elif path == "/files/write":
            file_path = body.get("path")
            content = body.get("content")
            if not file_path or content is None:
                self._json(400, {"error": "path and content required"})
                return
            try:
                p = Path(file_path).resolve()
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(content.encode("utf-8"))
                self._json(200, {"message": "saved", "path": str(p)})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/presets":
            presets_file = SWARM_DIR / "presets.json"
            try:
                presets_file.write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
                self._json(200, {"message": "presets saved"})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/quicklaunch":
            # 배열이면 전체 목록 교체 (reorder용)
            if isinstance(body, list):
                save_quicklaunch(body)
                self._json(200, {"message": "reordered", "items": body})
                return
            items = load_quicklaunch()
            if not body.get("name"):
                self._json(400, {"error": "name required"})
                return
            if any(i["name"] == body["name"] for i in items):
                self._json(409, {"error": f"'{body['name']}' already exists"})
                return
            items.append(body)
            save_quicklaunch(items)
            self._json(201, {"message": "added", "item": body})
        elif path == "/hooks/claude-state":
            # Claude Code hooks에서 HTTP POST로 상태 전달
            event_name = body.get("hook_event_name", "")
            # 1) 쿼리 파라미터 session으로 매핑 시도
            raw_path = self.path
            qs = parse_qs(raw_path.split("?", 1)[1]) if "?" in raw_path else {}
            swarm_session = unquote(qs.get("session", [""])[0])
            session = manager.get(swarm_session) if swarm_session else None
            # 2) 없으면 session_id → PID 트리로 매핑
            is_subagent = False
            if not session:
                hook_session_id = body.get("session_id", "")
                if hook_session_id:
                    session, is_subagent = _match_session_by_hook_id(hook_session_id)
            if not session:
                self._json(200, {"ok": False, "reason": "session not found"})
                return
            # 서브에이전트의 PermissionRequest/Stop은 부모가 자동 처리하므로 무시
            if is_subagent and event_name in ("PermissionRequest", "Stop", "StopFailure"):
                self._json(200, {"ok": True, "session": swarm_session, "event": event_name, "ignored": "subagent"})
                return
            if event_name == "Stop" or event_name == "StopFailure":
                session.set_hook_state("ready")
            elif event_name == "PermissionRequest":
                session.set_hook_state("attention")
            elif event_name == "UserPromptSubmit":
                session._hook_state = None  # idle (일반 초록) — active 깜빡임 제거
            elif event_name == "SessionEnd":
                session._hook_state = None
            self._json(200, {"ok": True, "session": swarm_session, "event": event_name})
        else:
            self._json(404, {"error": "Not found"})

    def do_DELETE(self):
        try:
            path = self.path.split("?")[0]
            if path == "/sessions":
                try: manager.kill_all()
                except Exception: pass
                self._json(200, {"message": "All sessions killed"})
            elif path.startswith("/sessions/"):
                name = self._session_name(path)
                try:
                    manager.kill(name)
                    self._json(200, {"message": f"Session '{name}' killed"})
                except ValueError as e:
                    self._json(404, {"error": str(e)})
                except Exception as e:
                    self._json(500, {"error": str(e)})
            elif path.startswith("/quicklaunch/"):
                name = unquote(path.split("/quicklaunch/", 1)[1])
                items = load_quicklaunch()
                found = None
                for i, item in enumerate(items):
                    if item.get("name") == name:
                        found = items.pop(i)
                        break
                if not found:
                    self._json(404, {"error": f"'{name}' not found"})
                else:
                    save_quicklaunch(items)
                    self._json(200, {"message": "deleted", "item": found})
            else:
                self._json(404, {"error": "Not found"})
        except Exception as e:
            try: self._json(500, {"error": str(e)})
            except Exception: pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Swarm-Session")
        self.end_headers()


# ─── Daemon ──────────────────────────────────────────────────────────────────

def is_daemon_running(port=DEFAULT_PORT):
    try:
        return urlopen(f"http://{DEFAULT_HOST}:{port}/health", timeout=2).status == 200
    except Exception:
        return False

async def _ws_handler(websocket):
    """WebSocket 핸들러: 세션 I/O 양방향 통신."""
    try:
        path = websocket.request.path
    except Exception:
        path = str(getattr(websocket, 'path', ''))
    if not path.startswith("/ws/sessions/"):
        await websocket.close()
        return
    name = unquote(path.split("/")[3])
    session = manager.get(name)
    if not session:
        await websocket.close()
        return

    # 히스토리 전송
    history, last_seen = session.get_history()
    if history:
        await websocket.send("".join(history))

    # 출력 스트리밍 태스크 (이벤트 드리븐 + 최소 배치 간격)
    data_event = asyncio.Event()
    # PTY 스레드에서 set()하면 asyncio 이벤트 루프에 안전하게 알림
    _loop = asyncio.get_event_loop()
    _thread_event = threading.Event()
    session.register_data_event(_thread_event)

    async def _bridge_event():
        """threading.Event → asyncio.Event 브릿지."""
        while True:
            await asyncio.to_thread(_thread_event.wait)
            _thread_event.clear()
            data_event.set()

    bridge_task = asyncio.create_task(_bridge_event())

    async def stream():
        nonlocal last_seen
        MIN_BATCH_INTERVAL = 0.008  # 8ms (≈120fps)
        while True:
            await data_event.wait()
            data_event.clear()
            await asyncio.sleep(MIN_BATCH_INTERVAL)  # 짧은 배치 윈도우
            current, new_lines = session.get_new_raw_lines(last_seen)
            if new_lines:
                last_seen = current
                try:
                    await websocket.send("".join(new_lines))
                except Exception:
                    break

    task = asyncio.create_task(stream())
    try:
        async for msg in websocket:
            # DA 응답(ESC[?1;2c 등) 필터링 — xterm.js가 자동 응답하는 것이 입력으로 들어오는 것 방지
            filtered = re.sub(r'\x1b\[\?[\d;]*c', '', msg)
            if filtered:
                session.write_stdin(filtered, raw=True)
    except Exception:
        pass
    finally:
        task.cancel()
        bridge_task.cancel()
        session.unregister_data_event(_thread_event)


def _run_ws_server():
    """별도 스레드에서 WebSocket 서버 실행."""
    from websockets.asyncio.server import serve
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    async def main():
        for attempt in range(5):
            try:
                async with serve(_ws_handler, DEFAULT_HOST, WS_PORT, reuse_address=True) as server:
                    await server.serve_forever()
            except OSError as e:
                if attempt < 4:
                    await asyncio.sleep(2)
                    continue
                print(f"[swarm] WS server failed: {e}", file=sys.stderr)
                return
    try:
        loop.run_until_complete(main())
    except Exception as e:
        print(f"[swarm] WS server error: {e}", file=sys.stderr)


def _kill_port_holders():
    """시작 전 포트 점유 프로세스 정리 (Windows)."""
    if os.name != "nt":
        return
    my_pid = str(os.getpid())
    for port in [DEFAULT_PORT, WS_PORT]:
        try:
            r = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, timeout=5)
            for line in r.stdout.splitlines():
                if f":{port}" in line and "LISTEN" in line:
                    pid = line.strip().split()[-1]
                    if pid != my_pid and pid != "0":
                        subprocess.run(["taskkill", "/F", "/T", "/PID", pid], capture_output=True, timeout=5)
        except Exception:
            pass

# ─── Desktop Notification ────────────────────────────────────────────────────

def _is_browser_foreground():
    """포그라운드 윈도우가 Terminal Swarm 대시보드인지 확인 (Windows only, ctypes)."""
    if os.name != "nt":
        return False
    try:
        import ctypes
        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return False
        length = user32.GetWindowTextLengthW(hwnd)
        if length == 0:
            return False
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        return "terminal swarm" in buf.value.lower()
    except Exception:
        return False


_hook_session_cache = {}  # session_id → swarm session name

def _match_session_by_hook_id(hook_session_id):
    """hook body의 session_id로 swarm 세션을 매핑. 결과를 캐시.
    Returns (session, is_subagent) 튜플. is_subagent=True이면 서브에이전트(손자 프로세스)."""
    # 캐시 히트
    if hook_session_id in _hook_session_cache:
        cached_name, cached_sub = _hook_session_cache[hook_session_id]
        session = manager.get(cached_name)
        if session:
            return session, cached_sub
        # 세션이 삭제/재생성됨 → 캐시 무효화
        del _hook_session_cache[hook_session_id]

    sessions_dir = Path.home() / ".claude" / "sessions"
    if not sessions_dir.exists():
        return None, False
    # 1) session_id로 Claude Code PID 찾기
    claude_pid = None
    for f in sessions_dir.iterdir():
        if f.suffix != ".json":
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            if data.get("sessionId") == hook_session_id:
                claude_pid = data.get("pid")
                break
        except Exception:
            continue
    if not claude_pid:
        return None, False
    # 2) claude_pid → 조상 PID 체인을 올라가며 swarm 세션 매칭
    session_pids = {s.pty.pid: s for s in manager.sessions.values() if s.pty}
    cur_pid = claude_pid
    depth = 0  # 0=claude 자신, 1=직접 자식, 2+=손자(서브에이전트)
    try:
        for _ in range(10):  # 무한루프 방지
            parent_pid = None
            # PowerShell 우선 (Windows 11에서 wmic 제거됨)
            r = subprocess.run(
                ["powershell", "-NoProfile", "-NoLogo", "-c",
                 f"(Get-CimInstance Win32_Process -Filter 'ProcessId={cur_pid}').ParentProcessId"],
                capture_output=True, text=True, timeout=5
            )
            val = r.stdout.strip()
            if val.isdigit():
                parent_pid = int(val)
            else:
                # PowerShell 실패 시 wmic 폴백
                r2 = subprocess.run(
                    ["wmic", "process", "where", f"ProcessId={cur_pid}", "get", "ParentProcessId", "/value"],
                    capture_output=True, text=True, timeout=5
                )
                for line in r2.stdout.strip().split("\n"):
                    if "ParentProcessId=" in line:
                        parent_pid = int(line.split("=")[1].strip())
                        break
            if parent_pid is None:
                break
            depth += 1
            if parent_pid in session_pids:
                is_subagent = depth > 1  # depth 1 = 직접 자식, depth 2+ = 서브에이전트
                _hook_session_cache[hook_session_id] = (session_pids[parent_pid].name, is_subagent)
                return session_pids[parent_pid], is_subagent
            cur_pid = parent_pid
    except Exception:
        pass
    return None, False


def _send_notification(session_name, state, reason=None):
    """즉시 winotify 알림 전송. state: 'ready' | 'attention'"""
    try:
        from winotify import Notification, audio
    except ImportError:
        return

    browser_fg = _is_browser_foreground()

    try:
        if state == "ready":
            toast = Notification(
                app_id="Terminal Swarm",
                title=f"\U0001f535 작업 완료 — {session_name}",
                msg=f"[{session_name}] 작업이 완료되었습니다",
                duration="short",
            )
            toast.show()
        elif state == "attention":
            if reason == "question":
                title = f"\U0001f7e1 응답 대기 — {session_name}"
                msg = f"[{session_name}] 사용자 응답이 필요합니다"
            else:
                title = f"\U0001f7e1 승인 요청 — {session_name}"
                msg = f"[{session_name}] 사용자 승인이 필요합니다"
            toast = Notification(
                app_id="Terminal Swarm",
                title=title,
                msg=msg,
                duration="short" if browser_fg else "long",
            )
            toast.set_audio(audio.Default, loop=False)
            toast.show()
    except Exception:
        pass


def _run_notification_monitor_legacy():
    """[DEPRECATED] PTY 기반 모니터링 — hooks 전환으로 미사용. 향후 제거 예정."""
    try:
        from winotify import Notification, audio
    except ImportError:
        print("[swarm] winotify not installed — desktop notifications disabled", file=sys.stderr)
        return

    notified_ready = set()
    notified_attention = set()

    while True:
        try:
            time.sleep(2)
            sessions = manager.list_all()
            active_names = set()
            for s in sessions:
                name = s["name"]
                command = s.get("command", "")
                state = s.get("ui_state", "idle")
                active_names.add(name)

                # Claude Code 세션만 알림 대상
                if "claude" not in command.lower():
                    continue

                try:
                    # ready 전환 감지 (_ready_flag가 세팅되면 ui_state=ready)
                    if state == "ready" and name not in notified_ready:
                        notified_ready.add(name)
                        notified_attention.discard(name)
                        toast = Notification(
                            app_id="Terminal Swarm",
                            title=f"🔵 작업 완료 — {name}",
                            msg=f"[{name}] 작업이 완료되었습니다",
                            duration="short",
                        )
                        toast.show()

                    # attention 전환 감지
                    elif state == "attention" and name not in notified_attention:
                        notified_attention.add(name)
                        notified_ready.discard(name)
                        toast = Notification(
                            app_id="Terminal Swarm",
                            title=f"🟠 승인 요청 — {name}",
                            msg=f"[{name}] 사용자 승인이 필요합니다",
                            duration="long",
                        )
                        toast.set_audio(audio.Default, loop=False)
                        toast.show()

                    # active 상태 진입 시 notified 리셋 (새 작업 시작)
                    elif state == "active":
                        notified_ready.discard(name)
                        notified_attention.discard(name)
                except Exception:
                    pass


            # 삭제된 세션 정리
            notified_ready &= active_names
            notified_attention &= active_names
        except Exception:
            pass


def start_daemon(port=DEFAULT_PORT):
    ensure_dirs()
    auto_save_python_path()
    if is_daemon_running(port):
        print(f"Daemon already running on port {port}")
        return

    # 이전 좀비 프로세스 정리
    _kill_port_holders()
    time.sleep(1)

    # WebSocket 서버를 별도 스레드로
    ws_thread = threading.Thread(target=_run_ws_server, daemon=True)
    ws_thread.start()

    # Desktop notification: hooks 기반으로 전환됨 (별도 모니터 스레드 불필요)

    PID_FILE.write_text(str(os.getpid()))
    print(f"[swarm] HTTP: {DEFAULT_HOST}:{port} | WS: {DEFAULT_HOST}:{WS_PORT} | UI: http://{DEFAULT_HOST}:{port}/")
    sys.stdout.flush()

    while True:
        try:
            server = PooledHTTPServer((DEFAULT_HOST, port), SwarmHandler)
            server.serve_forever()
        except KeyboardInterrupt:
            try: manager.kill_all()
            except Exception: pass
            try: server.shutdown()
            except Exception: pass
            break
        except Exception as e:
            # 크래시해도 자동 재시작
            try:
                with open(SWARM_DIR / "error.log", "a", encoding="utf-8") as f:
                    f.write(f"[{datetime.now().isoformat()}] Server crashed: {type(e).__name__}: {e}\n")
            except Exception: pass
            try: server.shutdown()
            except Exception: pass
            time.sleep(1)
            continue

    PID_FILE.unlink(missing_ok=True)


# ─── CLI ─────────────────────────────────────────────────────────────────────

def api(method, path, body=None, timeout=10):
    url = f"http://{DEFAULT_HOST}:{DEFAULT_PORT}{path}"
    data = json.dumps(body).encode("utf-8") if body else None
    req = Request(url, data=data, method=method)
    if body:
        req.add_header("Content-Type", "application/json")
    try:
        return json.loads(urlopen(req, timeout=timeout).read().decode("utf-8"))
    except URLError as e:
        reason = str(getattr(e, "reason", e))
        if "refused" in reason.lower() or "no connection" in reason.lower():
            print("Error: Daemon not running. Start with: swarm start")
            sys.exit(1)
        if hasattr(e, "read"):
            try:
                print(f"Error: {json.loads(e.read().decode('utf-8')).get('error')}")
                sys.exit(1)
            except Exception:
                pass
        raise

def cmd_start(a): start_daemon(port=a.port)
def cmd_stop(a):
    if not is_daemon_running(): print("Daemon not running."); return
    try: api("DELETE", "/sessions")
    except Exception: pass
    if PID_FILE.exists():
        pid = int(PID_FILE.read_text().strip())
        try:
            # /T: 프로세스 트리 전체 종료 (자식 포함)
            if os.name == "nt": subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
            else: os.kill(pid, signal.SIGTERM)
        except Exception: pass
        PID_FILE.unlink(missing_ok=True)
    _kill_port_holders()
    print("Daemon stopped.")
def cmd_status(a):
    if is_daemon_running(): r=api("GET","/health"); print(f"Daemon: running ({r['sessions']} sessions)")
    else: print("Daemon: not running")
def cmd_create(a):
    c = a.cmd if a.cmd else " ".join(a.command)
    if not c: print("Error: command required"); sys.exit(1)
    r=api("POST","/sessions",{"name":a.name,"command":c,"shell":a.shell,"cwd":a.cwd})
    print(f"Created '{r['name']}' (PID: {r['pid']})")
def cmd_list(a):
    ss=api("GET","/sessions")["sessions"]
    if not ss: print("No sessions."); return
    print(f"{'NAME':<15} {'PID':<8} {'STATUS':<12} {'LINES':<8} {'COMMAND'}")
    print("-"*75)
    for s in ss:
        st="running" if s["alive"] else f"exited({s['exit_code']})"
        cd=s["command"][:35]+"..." if len(s["command"])>35 else s["command"]
        print(f"{s['name']:<15} {s['pid'] or '-':<8} {st:<12} {s['buffer_lines']:<8} {cd}")
KEY_MAP = {
    "enter": "\r", "return": "\r",
    "up": "\x1b[A", "down": "\x1b[B", "right": "\x1b[C", "left": "\x1b[D",
    "ctrl-c": "\x03", "ctrl-d": "\x04", "ctrl-z": "\x1a",
    "tab": "\t", "esc": "\x1b", "escape": "\x1b",
    "backspace": "\x7f", "delete": "\x1b[3~",
    "home": "\x1b[H", "end": "\x1b[F",
    "pageup": "\x1b[5~", "pagedown": "\x1b[6~",
}

def cmd_send(a):
    url = f"http://{DEFAULT_HOST}:{DEFAULT_PORT}/sessions/{quote(a.name)}/send"

    # --enter: \r 전송
    if a.enter:
        data = json.dumps({"text": "\r", "raw": True}).encode("utf-8")
    # --key: 이름으로 키 전송
    elif a.key:
        seq = KEY_MAP.get(a.key.lower())
        if not seq:
            print(f"Error: unknown key '{a.key}'. Available: {', '.join(sorted(KEY_MAP.keys()))}")
            sys.exit(1)
        repeat = a.repeat if a.repeat else 1
        data = json.dumps({"text": seq * repeat, "raw": True}).encode("utf-8")
    # --file: 파일 내용을 base64로 전송
    elif a.file:
        try:
            content = Path(a.file).read_text(encoding="utf-8")
        except Exception as e:
            print(f"Error reading file: {e}")
            sys.exit(1)
        encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
        data = json.dumps({"base64": encoded}).encode("utf-8")
    # --base64: stdin에서 읽어 base64로 전송
    elif a.base64:
        content = sys.stdin.read()
        encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
        data = json.dumps({"base64": encoded}).encode("utf-8")
    # 일반 텍스트 전송
    else:
        text = a.cmd if a.cmd else " ".join(a.text) if a.text else ""
        body = {"text": text}
        if a.raw:
            body["raw"] = True
        data = json.dumps(body).encode("utf-8")

    req = Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        urlopen(req, timeout=10)
        print(f"Sent to '{a.name}'")
    except URLError as e:
        print(f"Error: {e}")
        sys.exit(1)
def cmd_read(a):
    p=[]
    if a.lines: p.append(f"lines={a.lines}")
    if a.grep: p.append(f"grep={quote(a.grep)}")
    q="?"+"&".join(p) if p else ""
    r=api("GET",f"/sessions/{quote(a.name)}/read{q}")
    if a.raw: print(r["output"],end="")
    else:
        st="running" if r["alive"] else "exited"
        print(f"--- [{r['name']}] ({st}, {r['lines']} lines) ---")
        print(r["output"],end="")
        if r["output"] and not r["output"].endswith("\n"): print()
        print("--- end ---")
def cmd_wait(a):
    body = {"timeout": a.timeout}
    if a.grep: body["grep"] = a.grep
    if a.exit: body["exit"] = True
    if a.idle: body["idle"] = a.idle
    if a.ready: body["ready"] = True
    if not a.grep and not a.exit and not a.idle and not a.ready:
        body["exit"] = True  # 기본: 프로세스 종료 대기
    url = f"/sessions/{quote(a.name)}/wait"
    r = api("POST", url, body, timeout=a.timeout+10)
    event = r.get("event", "unknown")
    if event == "match":
        print(f"[{a.name}] Pattern matched: {r.get('line', '')}")
    elif event == "idle":
        print(f"[{a.name}] Output idle for {r.get('idle_seconds', '?')}s")
    elif event == "ready":
        print(f"[{a.name}] Session ready (response completed)")
    elif event == "attention":
        print(f"[{a.name}] Session needs input (permission prompt)")
    elif event == "exit":
        print(f"[{a.name}] Session exited")
    elif event == "timeout":
        print(f"[{a.name}] Timeout after {a.timeout}s")
        sys.exit(1)
    else:
        print(f"[{a.name}] {r}")
def cmd_rename(a):
    r=api("POST",f"/sessions/{quote(a.old)}/rename",{"name":a.new})
    print(f"Renamed '{a.old}' -> '{a.new}'")
def cmd_kill(a):
    print(api("DELETE",f"/sessions/{quote(a.name)}")["message"])
def cmd_kill_all(a): print(api("DELETE","/sessions")["message"])

def cmd_config(a):
    cfg = load_config()
    if a.action == "show":
        if not cfg:
            print("No config. Run 'swarm config init' to auto-detect settings.")
        else:
            print(json.dumps(cfg, indent=2, ensure_ascii=False))
    elif a.action == "init":
        cfg["python_path"] = sys.executable
        save_config(cfg)
        print(f"Config saved to {CONFIG_FILE}")
        print(f"  python_path: {cfg['python_path']}")
    elif a.action == "set":
        if not a.key or a.value is None:
            print("Usage: swarm config set <key> <value>")
            sys.exit(1)
        cfg[a.key] = a.value
        save_config(cfg)
        print(f"Set {a.key} = {a.value}")
    elif a.action == "get":
        if not a.key:
            print("Usage: swarm config get <key>")
            sys.exit(1)
        val = cfg.get(a.key)
        if val is None:
            print(f"Key '{a.key}' not found")
            sys.exit(1)
        print(val)

def cmd_fav(a):
    if a.action == "list":
        items = api("GET", "/quicklaunch")["items"]
        if not items:
            print("No Quick Launch items.")
            return
        for i, item in enumerate(items):
            if item.get("filePath"):
                print(f"  {i+1}. [file] {item['name']} — {item['filePath']}")
            else:
                cmd = item.get("command", "")
                cwd = item.get("cwd", "")
                print(f"  {i+1}. [cmd]  {item['name']} — {cmd}" + (f" (cwd: {cwd})" if cwd else ""))
    elif a.action == "add":
        if not a.name_val or not a.command_val:
            print("Usage: swarm fav add <name> <command> [--cwd <dir>]")
            sys.exit(1)
        body = {"name": a.name_val, "command": a.command_val}
        if a.cwd:
            body["cwd"] = a.cwd
        api("POST", "/quicklaunch", body)
        print(f"Added: {a.name_val}")
    elif a.action == "del":
        if not a.name_val:
            print("Usage: swarm fav del <name>")
            sys.exit(1)
        r = api("DELETE", f"/quicklaunch/{quote(a.name_val)}")
        item = r.get("item", {})
        info = item.get("filePath") or item.get("command", "")
        print(f"Deleted: {a.name_val} — {info}")
    elif a.action == "launch":
        if not a.name_val:
            print("Usage: swarm fav launch <name>")
            sys.exit(1)
        items = api("GET", "/quicklaunch")["items"]
        item = next((i for i in items if i["name"] == a.name_val), None)
        if not item:
            print(f"Not found: {a.name_val}")
            sys.exit(1)
        if item.get("filePath"):
            print(f"File items cannot be launched via CLI: {item['filePath']}")
            sys.exit(1)
        body = {"name": a.name_val, "command": item["command"]}
        if item.get("cwd"):
            body["cwd"] = item["cwd"]
        r = api("POST", "/sessions", body)
        print(f"Launched '{r['name']}' (PID: {r['pid']})")

def cmd_hooks(a):
    settings_path = Path.home() / ".claude" / "settings.json"
    if a.action == "setup":
        settings = {}
        if settings_path.exists():
            try:
                settings = json.loads(settings_path.read_text(encoding="utf-8"))
            except Exception:
                pass
        swarm_hook = {
            "hooks": [{
                "type": "http",
                "url": f"http://localhost:{DEFAULT_PORT}/hooks/claude-state",
                "timeout": 3
            }]
        }
        swarm_url = f"http://localhost:{DEFAULT_PORT}/hooks/claude-state"
        if "hooks" not in settings:
            settings["hooks"] = {}
        for event in ("Stop", "PermissionRequest", "UserPromptSubmit"):
            existing = settings["hooks"].get(event, [])
            # 이미 swarm 훅이 있으면 스킵
            already = any(
                h.get("hooks", [{}])[0].get("url", "") == swarm_url
                if isinstance(h, dict) and h.get("hooks") else False
                for h in existing
            )
            if not already:
                existing.append(swarm_hook)
            settings["hooks"][event] = existing
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(json.dumps(settings, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Hooks configured in {settings_path}")
        print("  Events: Stop, PermissionRequest, UserPromptSubmit")
        print(f"  Endpoint: http://localhost:{DEFAULT_PORT}/hooks/claude-state")
    elif a.action == "status":
        if not settings_path.exists():
            print("No settings.json found. Run 'swarm hooks setup' first.")
            return
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
        hooks = settings.get("hooks", {})
        for event in ("Stop", "PermissionRequest", "UserPromptSubmit"):
            status = "configured" if event in hooks else "not configured"
            print(f"  {event}: {status}")
    elif a.action == "remove":
        if not settings_path.exists():
            print("No settings.json found.")
            return
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
        hooks = settings.get("hooks", {})
        swarm_url = f"http://localhost:{DEFAULT_PORT}/hooks/claude-state"
        removed = 0
        for event in ("Stop", "PermissionRequest", "UserPromptSubmit"):
            if event not in hooks:
                continue
            before = len(hooks[event])
            hooks[event] = [
                h for h in hooks[event]
                if not (isinstance(h, dict) and any(
                    hh.get("url", "") == swarm_url
                    for hh in h.get("hooks", [])
                ))
            ]
            if len(hooks[event]) < before:
                removed += 1
            # 훅 배열이 비었으면 이벤트 키 자체 제거
            if not hooks[event]:
                del hooks[event]
        settings_path.write_text(json.dumps(settings, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Removed {removed} hook(s) from settings.json")

def main():
    p=argparse.ArgumentParser(prog="swarm",description="Terminal Swarm — Agent Swarm을 위한 터미널 제어")
    s=p.add_subparsers(dest="command",required=True)
    x=s.add_parser("start",help="데몬 시작 (백그라운드로 실행)"); x.add_argument("--port",type=int,default=DEFAULT_PORT); x.set_defaults(func=cmd_start)
    x=s.add_parser("stop",help="데몬 + 모든 세션 종료"); x.set_defaults(func=cmd_stop)
    x=s.add_parser("status",help="데몬 상태 확인"); x.set_defaults(func=cmd_status)
    x=s.add_parser("create",help="세션 생성 (name + command)"); x.add_argument("name"); x.add_argument("command",nargs="*"); x.add_argument("--cmd","-c"); x.add_argument("--shell","-s"); x.add_argument("--cwd","-d"); x.set_defaults(func=cmd_create)
    x=s.add_parser("list",help="세션 목록 조회"); x.set_defaults(func=cmd_list)
    x=s.add_parser("send",help="세션에 입력 전송 (텍스트/키/파일)"); x.add_argument("name"); x.add_argument("text",nargs="*"); x.add_argument("--cmd","-c"); x.add_argument("--enter",action="store_true",help="Send Enter key (\\r)"); x.add_argument("--key","-k",help="Send named key (up,down,ctrl-c,tab,...)"); x.add_argument("--repeat",type=int,help="Repeat --key N times"); x.add_argument("--base64","-b",action="store_true",help="Read stdin and send as base64"); x.add_argument("--file","-f",help="Send file contents as base64"); x.add_argument("--raw","-r",action="store_true",help="Send raw (no auto \\r)"); x.set_defaults(func=cmd_send)
    x=s.add_parser("read",help="세션 출력 읽기 (-n, -g, -r)"); x.add_argument("name"); x.add_argument("--lines","-n",type=int); x.add_argument("--grep","-g"); x.add_argument("--raw","-r",action="store_true"); x.set_defaults(func=cmd_read)
    x=s.add_parser("wait",help="패턴/종료/idle/ready 대기"); x.add_argument("name"); x.add_argument("--grep","-g"); x.add_argument("--exit","-e",action="store_true"); x.add_argument("--ready","-r",action="store_true",help="Wait until Claude Code response completed (ui_state=ready)"); x.add_argument("--idle","-i",type=int,default=0,help="Wait until no new output for N seconds"); x.add_argument("--timeout","-t",type=int,default=300); x.set_defaults(func=cmd_wait)
    x=s.add_parser("rename",help="세션 이름 변경"); x.add_argument("old"); x.add_argument("new"); x.set_defaults(func=cmd_rename)
    x=s.add_parser("kill",help="세션 종료"); x.add_argument("name"); x.set_defaults(func=cmd_kill)
    x=s.add_parser("kill-all",help="모든 세션 종료"); x.set_defaults(func=cmd_kill_all)
    x=s.add_parser("config",help="설정 관리 (show/init/set/get)"); x.add_argument("action",choices=["show","init","set","get"]); x.add_argument("key",nargs="?"); x.add_argument("value",nargs="?"); x.set_defaults(func=cmd_config)
    x=s.add_parser("fav",help="Quick Launch 관리 (list/add/del/launch)"); x.add_argument("action",choices=["list","add","del","launch"]); x.add_argument("name_val",nargs="?"); x.add_argument("command_val",nargs="?"); x.add_argument("--cwd","-d"); x.set_defaults(func=cmd_fav)
    x=s.add_parser("hooks",help="Claude Code hooks 설정 (setup/status/remove)"); x.add_argument("action",choices=["setup","status","remove"]); x.set_defaults(func=cmd_hooks)
    a=p.parse_args(); a.func(a)

if __name__=="__main__":
    if os.name=="nt":
        import io
        sys.stdin=io.TextIOWrapper(sys.stdin.buffer,encoding="utf-8",errors="replace")
        sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding="utf-8",errors="replace")
        sys.stderr=io.TextIOWrapper(sys.stderr.buffer,encoding="utf-8",errors="replace")
    main()
