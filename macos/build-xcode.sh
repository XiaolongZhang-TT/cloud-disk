#!/bin/bash
#
# build-xcode.sh – build the Xcode project that contains the menu-bar app and
# the File Provider extension.  Requires Xcode (not just Command Line Tools).
#
#   ./build-xcode.sh             # build .app (unsigned if no team configured)
#   TEAM=ABCDE12345 ./build-xcode.sh
#   ./build-xcode.sh --clean
#
set -euo pipefail
cd "$(dirname "$0")"

XCODEGEN="${XCODEGEN:-$(command -v xcodegen || true)}"
if [[ -z "$XCODEGEN" && -x /tmp/xcodegen/xcodegen/bin/xcodegen ]]; then
  XCODEGEN=/tmp/xcodegen/xcodegen/bin/xcodegen
fi
if [[ -z "$XCODEGEN" && ! -d Tern.xcodeproj ]]; then
  echo "xcodegen not found and Tern.xcodeproj is missing. Install XcodeGen: brew install xcodegen" >&2
  exit 1
fi

DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
export DEVELOPER_DIR

if [[ "${1:-}" == "--clean" ]]; then
  rm -rf Tern.xcodeproj .build-xcode
fi

if [[ -n "$XCODEGEN" ]]; then
  "$XCODEGEN" generate --spec project.yml
fi

XCODEBUILD="$DEVELOPER_DIR/usr/bin/xcodebuild"
COMMON=(
  -project Tern.xcodeproj
  -scheme Tern
  -configuration Debug
  -derivedDataPath .build-xcode
  SWIFT_ENABLE_MACRO_SANDBOX=NO
  "OTHER_SWIFT_FLAGS=\$(inherited) -Xfrontend -disable-sandbox"
)

if [[ -n "${TEAM:-}" ]]; then
  "$XCODEBUILD" "${COMMON[@]}" DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates build
else
  # No team on this machine: compile everything, including the extension, but
  # don't attempt to sign or embed a signed extension.
  "$XCODEBUILD" "${COMMON[@]}" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
fi

echo "Built: .build-xcode/Build/Products/Debug/Tern.app"
