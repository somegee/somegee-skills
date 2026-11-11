"""ccd_folder.py — 폴더 옵션 읽기·PowerShell 프로필 ccd 함수 읽기·설치본 값 왕복.

  python -m pytest herdr/skills/herdr-use/desktop/tests
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import ccd_folder  # noqa: E402

WIN_PATH = "C:\\Users\\홍길동\\Desktop\\projects"
KEY_SRC = 'const ARGV = ["claude"];\nconst FOLDER = "";  // 설치 때 채움\n'


@pytest.mark.parametrize("argv, expected", [
    ([], None),
    (["--remove"], None),
    (["--ccd-folder", WIN_PATH], WIN_PATH),
    (["--ccd-folder=" + WIN_PATH], WIN_PATH),
    (["--ccd-folder", ""], ""),
    (["--ccd-folder", '  "' + WIN_PATH + '"  '], WIN_PATH),
])
def test_parse_arg_reads_option_or_none(argv, expected):
    assert ccd_folder.parse_arg(argv) == expected


def test_parse_arg_without_value_stops():
    with pytest.raises(SystemExit):
        ccd_folder.parse_arg(["--ccd-folder"])


@pytest.mark.parametrize("profile, expected", [
    ('function ccd { Set-Location "%s"; claude --dangerously-skip-permissions }' % WIN_PATH, WIN_PATH),
    ("function ccd {\n    Set-Location '%s'\n    claude --dangerously-skip-permissions\n}" % WIN_PATH, WIN_PATH),
    ('Set-Alias ll ls\nfunction other { Set-Location "D:\\x" }\nfunction ccd() {\n  Set-Location "%s"\n}' % WIN_PATH, WIN_PATH),
])
def test_ccd_from_text_finds_set_location_in_ccd_function(profile, expected):
    assert ccd_folder.ccd_from_text(profile) == expected


@pytest.mark.parametrize("profile", [
    "",
    'function other { Set-Location "D:\\x" }',
    "function ccd { cd C:\\work; claude }",
    'function ccd { Set-Location -Path "C:\\work"; claude }',
    'function ccd { Set-Location "$HOME\\work"; claude }',
    'function ccd { Push-Location "C:\\work"; claude }',
    'function ccd { claude }\nSet-Location "C:\\outside"',
])
def test_ccd_from_text_skips_unknown_forms(profile):
    assert ccd_folder.ccd_from_text(profile) is None


def test_set_in_source_escapes_backslashes_and_reads_back(tmp_path):
    src = ccd_folder.set_in_source(KEY_SRC, "FOLDER", WIN_PATH)
    assert 'const FOLDER = "C:\\\\Users\\\\홍길동\\\\Desktop\\\\projects";' in src
    main = tmp_path / "main.js"
    main.write_text(src, encoding="utf-8")
    assert ccd_folder.read_installed(str(main)) == WIN_PATH


def test_read_installed_keeps_cleared_value_and_none_for_old_install(tmp_path):
    cleared = tmp_path / "cleared.js"
    cleared.write_text(KEY_SRC, encoding="utf-8")
    old = tmp_path / "old.js"
    old.write_text('const ARGV = ["claude"];\n', encoding="utf-8")
    assert ccd_folder.read_installed(str(cleared)) == ""
    assert ccd_folder.read_installed(str(old)) is None
    assert ccd_folder.read_installed(str(tmp_path / "missing.js")) is None


def test_read_installed_reads_menu_constant(tmp_path):
    main = tmp_path / "main.js"
    main.write_text(ccd_folder.set_in_source('const CCD_FOLDER = "";\n', "CCD_FOLDER", WIN_PATH), encoding="utf-8")
    assert ccd_folder.read_installed(str(main)) == WIN_PATH


def test_set_in_source_stops_when_line_missing():
    with pytest.raises(SystemExit):
        ccd_folder.set_in_source("const OTHER = 1;", "FOLDER", WIN_PATH)


def test_resolve_prefers_option_then_installed_then_profile(tmp_path, monkeypatch):
    monkeypatch.setattr(ccd_folder, "from_profile", lambda: str(tmp_path))
    monkeypatch.setattr(ccd_folder, "installed_values", lambda: {ccd_folder.KEY_MOD: None, ccd_folder.MENU_MOD: None})
    assert ccd_folder.resolve(None) == str(tmp_path)  # 설치본 없음 → 프로필
    monkeypatch.setattr(ccd_folder, "installed_values", lambda: {ccd_folder.KEY_MOD: "", ccd_folder.MENU_MOD: None})
    assert ccd_folder.resolve(None) == ""  # 해제해 둔 값은 유지(프로필로 되살리지 않음)
    assert ccd_folder.resolve(str(tmp_path)) == str(tmp_path)  # 옵션이 먼저


def test_resolve_drops_missing_folder(tmp_path, capsys):
    assert ccd_folder.resolve(str(tmp_path / "nope")) == ""
    assert "ccd 폴더가 없음" in capsys.readouterr().out
