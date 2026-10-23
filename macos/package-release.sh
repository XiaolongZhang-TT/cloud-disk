#!/bin/bash
#
# package-release.sh – Developer ID archive + notarization for the File Provider build.
#
# Required environment:
#   TEAM                 Apple Developer Team ID
#   APPLE_ID             Apple ID used for notarization
#   APPLE_TEAM_ID        Team ID for notarytool
#   APPLE_APP_PASSWORD   App-specific password
#
# Optional:
#   VERSION              marketing version (default: Info.plist)
#
set -euo pipefail
cd "$(dirname "$0")"

: "${TEAM:?Set TEAM to your Apple Developer Team ID}"
: "${APPLE_ID:?Set APPLE_ID for notarization}"
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID for notarization}"
: "${APPLE_APP_PASSWORD:?Set APPLE_APP_PASSWORD to an app-specific password}"

DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
export DEVELOPER_DIR
VERSION="${VERSION:-$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' Resources/Info.plist)}"
ARCHIVE=".build-xcode/Tern.xcarchive"
EXPORT="dist/export"
APP="$EXPORT/Tern.app"
ZIP="dist/Tern-FileProvider-$VERSION.zip"

rm -rf "$ARCHIVE" "$EXPORT" "$ZIP"
mkdir -p dist

/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild \
  -project Tern.xcodeproj \
  -scheme Tern \
  -configuration Release \
  -archivePath "$ARCHIVE" \
  -derivedDataPath .build-xcode \
  DEVELOPMENT_TEAM="$TEAM" \
  CODE_SIGN_STYLE=Automatic \
  archive

cat > .build-xcode/ExportOptions.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>developer-id</string>
  <key>signingStyle</key>
  <string>automatic</string>
</dict>
</plist>
PLIST

/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist .build-xcode/ExportOptions.plist \
  -exportPath "$EXPORT"

if [[ ! -d "$APP" ]]; then
  echo "Export did not produce $APP" >&2
  exit 1
fi

ditto -c -k --keepParent "$APP" "$ZIP"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$APP"
xcrun notarytool submit "$ZIP" \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_PASSWORD" \
  --wait
xcrun stapler staple "$APP"
ditto -c -k --keepParent "$APP" "$ZIP"
shasum -a 256 "$ZIP" > "$ZIP.sha256"

echo "Notarized: $ZIP"
