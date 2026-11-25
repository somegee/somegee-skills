#!/usr/bin/env python3
"""흩어진 notes 노트를 <홈>/.claude/notes-data 하나로 합친다 (notes 0.22.3, 2026-11-26).

0.22.2 까지는 설정 폴더가 .claude-keyring(CLAUDE_CONFIG_DIR) 이면 노트를 버전별
<플러그인 캐시>/notes/<버전>/data/ 에 썼다. 0.22.3 부터는 늘 <홈>/.claude/notes-data 에 쓰므로
그 전에 버전별 data/ 에 쌓인 노트를 여기로 모은다.

- 기본은 미리보기(아무것도 안 바꿈). --apply 를 붙여야 쓴다. 쓰기 전에 notes-data 를 통째로 백업한다.
- 합치는 대상: 맨 위 *.json(_all.json·폴더별)과 sessions/*.json. live/ 는 3분 지나면 무시되니 옮기지 않는다.
- 같은 이름의 탭은 updatedAt 이 더 최근인 쪽을 남기고, 오래된 것부터 늘어놓아 최근 30개만 둔다(notes 의 mergeTabs 와 같음).
- 합쳐서 탭이 바뀐 파일은 되돌리기 기록(history·future)을 비운다(서로 다른 파일의 기록을 섞으면 되돌리기가 어긋난다).
- 원본 버전별 data/ 는 지우지 않는다(확인 뒤 손으로 지우면 된다).

실행: python merge_notes_data.py          # 미리보기
      python merge_notes_data.py --apply  # 실제로 합치기
"""
import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

MAX_TABS = 30
HOME = Path.home()
TARGET = HOME / ".claude" / "notes-data"


def updated_ms(tab):
    try:
        return datetime.fromisoformat(str(tab.get("updatedAt", "")).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def merge_tabs(lists):
    by_title = {}
    for tab in (t for lst in lists for t in lst):
        if not isinstance(tab, dict) or not isinstance(tab.get("title"), str):
            continue
        kept = by_title.get(tab["title"])
        if kept is None or updated_ms(tab) > updated_ms(kept):
            by_title[tab["title"]] = tab
    return sorted(by_title.values(), key=updated_ms)[-MAX_TABS:]


def source_dirs():
    seen, found = set(), []
    for cfg in sorted(HOME.glob(".claude*")):
        for d in sorted((cfg / "plugins" / "cache").glob("*/notes/*/data")):
            real = d.resolve()
            if d.is_dir() and real not in seen and real != TARGET.resolve():
                seen.add(real)
                found.append(d)
    return found


def load(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError) as err:
        print(f"  ! 건너뜀(읽기 실패) {path}: {err}")
        return None


def note_files(base):
    return [p for p in base.glob("*.json")] + [p for p in (base / "sessions").glob("*.json")]


def plan(sources):
    """상대 경로 → 합친 결과. 바뀌는 것만 돌려준다."""
    rels = sorted({p.relative_to(s).as_posix() for s in sources for p in note_files(s)})
    changes = {}
    for rel in rels:
        target = TARGET / rel
        current = load(target) if target.exists() else None
        books = [b for b in (load(s / rel) for s in sources if (s / rel).exists()) if b]
        base_tabs = current.get("tabs", []) if current else []
        merged = merge_tabs([base_tabs] + [b.get("tabs", []) for b in books])
        if current and json.dumps(merged, sort_keys=True) == json.dumps(base_tabs, sort_keys=True):
            continue
        root = (current or {}).get("root") or next((b.get("root") for b in books if b.get("root")), "")
        changes[rel] = {"root": root, "tabs": merged, "history": [], "future": []}
        print(f"  {rel}: 지금 {len(base_tabs)}개 → 합친 뒤 {len(merged)}개 (원본 {len(books)}곳)")
    return changes


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="실제로 합친다(없으면 미리보기)")
    args = ap.parse_args()

    sources = source_dirs()
    print(f"합칠 곳: {TARGET}")
    print("찾은 버전별 data/:" if sources else "버전별 data/ 가 없습니다. 할 일 없음.")
    for s in sources:
        print(f"  - {s}")
    if not sources:
        return 0
    changes = plan(sources)
    if not changes:
        print("바뀔 파일이 없습니다.")
        return 0
    if not args.apply:
        print("\n미리보기입니다. 합치려면 --apply 를 붙여 다시 실행하세요.")
        return 0
    if TARGET.exists():
        backup = TARGET.with_name("notes-data.bak-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S"))
        shutil.copytree(TARGET, backup)
        print(f"백업: {backup}")
    for rel, book in changes.items():
        out = TARGET / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(book, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(out)
    print(f"완료: {len(changes)}개 파일. 확인 뒤 버전별 data/ 는 손으로 지워도 됩니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
