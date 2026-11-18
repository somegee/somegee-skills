"""herdr 앱 설정 폴더 위치 — 모든 스크립트가 여기서 읽는다(시험 땐 HERDR_APP_HOME 으로 바꿈)."""
import os

APP_HOME = os.environ.get("HERDR_APP_HOME") or os.path.join(os.path.expanduser("~"), ".config", "herdr-app")
