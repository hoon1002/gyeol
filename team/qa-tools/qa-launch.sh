#!/bin/sh
# QA 헤드리스 크롬: 작업 폴더 안 임시 프로필 team/.qa-profile, 디버깅 포트는 0(자동) → 프로필의 DevToolsActivePort에서 읽는다
cd "$(dirname "$0")/../.."
rm -f "$PWD/team/.qa-profile/DevToolsActivePort"
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=0 \
  --user-data-dir="$PWD/team/.qa-profile" --no-first-run --no-default-browser-check --disable-extensions \
  --disable-background-networking --disable-sync --window-size=1440,900 --enable-unsafe-swiftshader \
  --autoplay-policy=no-user-gesture-required about:blank
