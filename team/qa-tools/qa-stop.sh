#!/bin/sh
# QA 것만 끈다: qa-driver · team/.qa-profile 크롬 → 프로필 지움
cd "$(dirname "$0")/../.."
pkill -f "team/qa-tools/qa-driver.mjs" 2>/dev/null
pkill -f "user-data-dir=$PWD/team/.qa-profile" 2>/dev/null
sleep 1
rm -rf "$PWD/team/.qa-profile"
