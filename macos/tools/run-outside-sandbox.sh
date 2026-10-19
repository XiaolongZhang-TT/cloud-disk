#!/bin/bash
#
# run-outside-sandbox.sh – run a command in the user's LaunchServices session.
#
# Why does this exist?
#   macOS only allows NetFS network mounts (and writing to the login Keychain)
#   from a normal graphical login session.  Shells started by CI runners, IDEs,
#   remote agents or *sandboxed* terminals can get EPERM / OSStatus 100001 even
#   though the same operation works fine when the app is double-clicked.
#
#   This helper wraps the command in a throw-away .app, launches it through
#   LaunchServices (`open -n`) and streams its output into a log file.  The
#   launched process is no longer sandboxed, so `mount-smoke`, the app's hidden
#   `--smoke` mode and Keychain writes behave exactly like a Finder launch.
#
# Usage:
#   macos/tools/run-outside-sandbox.sh --out /tmp/smoke.log -- \
#       macos/tools/mount-smoke --url http://127.0.0.1:18080/Tern \
#       --user admin --password '密码'
#
#   macos/tools/run-outside-sandbox.sh --out /tmp/app-smoke.log -- \
#       macos/dist/Tern.app/Contents/MacOS/Tern --smoke \
#       --url http://127.0.0.1:18080/Tern --user admin --password '密码'
#
#   macos/tools/run-outside-sandbox.sh --out /tmp/setpw.log -- \
#       macos/dist/Tern.app/Contents/MacOS/Tern --set-password \
#       --url http://127.0.0.1:18080/Tern --user admin --password '密码'
#
# Options:
#   --out FILE       log file (default: macos/.build/launchservices-run.log)
#   --timeout SEC    how long to wait for the command (default 180)
#   --keep           keep the generated runner app (default: remove)
#
# Exit code: the wrapped command's exit code (124 on timeout).
#
# NOTE: the generated runner script contains the arguments (including any
# password) so it is created with mode 0700 and deleted afterwards unless
# --keep is passed.  Prefer --password-stdin / TERN_PASSWORD or --keychain
# when possible.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

OUT=""
WAIT_SECONDS=180
KEEP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --timeout) WAIT_SECONDS="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --help|-h)
      sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    --) shift; break ;;
    *)
      echo "未知参数: $1（命令请放在 -- 之后）" >&2
      exit 2 ;;
  esac
done

if [[ $# -eq 0 ]]; then
  echo "错误：缺少要执行的命令。示例：$0 --out /tmp/x.log -- /bin/echo hi" >&2
  exit 2
fi

if [[ -z "$OUT" ]]; then
  OUT="$ROOT/.build/launchservices-run.log"
fi
mkdir -p "$(dirname "$OUT")"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
rm -f "$OUT"

WORK="$ROOT/.build/launchservices-runner"
APP="$WORK/Runner.app"
rm -rf "$WORK"
mkdir -p "$APP/Contents/MacOS"

# Build a self-contained launcher script (the arguments are embedded, so the
# launched app never needs to read files from the workspace).
{
  printf '#!/bin/sh\n'
  printf 'OUT=%q\n' "$OUT"
  printf '{\n'
  printf '  echo "RUNNER_START $(date)"\n'
  printf '  cd %q\n' "$ROOT"
  printf '  command'
  for argument in "$@"; do
    printf ' %q' "$argument"
  done
  printf '\n'
  printf '  echo "RUNNER_EXIT=$?"\n'
  printf '} >> "$OUT" 2>&1\n'
} > "$APP/Contents/MacOS/Runner"
chmod 700 "$APP/Contents/MacOS/Runner"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Runner</string>
<key>CFBundleIdentifier</key><string>com.tern.launchservices-runner</string>
<key>CFBundleName</key><string>TernRunner</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
</dict></plist>
PLIST

/usr/bin/codesign --force --sign - "$APP" >/dev/null 2>&1 || true
/usr/bin/touch "$OUT"

/usr/bin/open -n "$APP"
OPEN_STATUS=$?
if [[ $OPEN_STATUS -ne 0 ]]; then
  echo "无法通过 LaunchServices 启动 runner（open 退出码 $OPEN_STATUS）" >&2
  exit 1
fi

waited=0
exit_code=""
while [[ $waited -lt $WAIT_SECONDS ]]; do
  if [[ -f "$OUT" ]] && /usr/bin/grep -q 'RUNNER_EXIT=' "$OUT" 2>/dev/null; then
    exit_code="$(/usr/bin/grep 'RUNNER_EXIT=' "$OUT" | /usr/bin/tail -1 | /usr/bin/sed 's/.*RUNNER_EXIT=//')"
    break
  fi
  sleep 1
  waited=$((waited + 1))
done

if [[ -z "$exit_code" ]]; then
  echo "等待命令完成超时（${WAIT_SECONDS}s）。日志：$OUT" >&2
  [[ $KEEP -eq 0 ]] && rm -rf "$WORK"
  exit 124
fi

echo "--- output ($OUT) ---"
cat "$OUT"
echo "----------------------"

if [[ $KEEP -eq 0 ]]; then
  rm -rf "$WORK"
fi
exit "${exit_code:-1}"
