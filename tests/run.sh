#!/usr/bin/env bash
# run.sh — 跑单元测试（只需要 gjs）
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec gjs -m tests/test-profiles.js
