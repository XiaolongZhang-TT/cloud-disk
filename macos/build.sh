#!/bin/bash
#
# build.sh – build the Tern menu-bar client without Xcode.
#
# Works with the macOS Command Line Tools only (no Xcode, no xcodebuild, no
# Apple Developer account):
#
#   * compiles the Swift sources with swiftc,
#   * assembles a proper .app bundle with Info.plist + icon,
#   * ad-hoc signs everything (`codesign --sign -`),
#   * writes a distributable zip + sha256 into macos/dist/.
#
# Usage:
#   ./build.sh                # arm64 build (default)
#   ./build.sh --clean        # remove .build/ and dist/ first
#   ARCHS="arm64 x86_64" ./build.sh    # universal binary (needs both slices)
#
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
APP_NAME="Tern"
BUNDLE_ID="com.tern.menubar"
BUILD_DIR="$ROOT/.build"
DIST_DIR="$ROOT/dist"
APP_DIR="$DIST_DIR/$APP_NAME.app"
MODULE_CACHE="$BUILD_DIR/ModuleCache"
TMP_DIR="$BUILD_DIR/tmp"
ARCHS="${ARCHS:-arm64}"
DEPLOYMENT_TARGET="${DEPLOYMENT_TARGET:-13.0}"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$ROOT/Resources/Info.plist" 2>/dev/null || echo 1.1.0)"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m  !\033[0m %s\n' "$*"; }
fail()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

if [[ "${1:-}" == "--clean" ]]; then
  info "清理构建目录"
  rm -rf "$BUILD_DIR" "$DIST_DIR"
fi

mkdir -p "$BUILD_DIR" "$DIST_DIR" "$MODULE_CACHE" "$TMP_DIR"
export TMPDIR="$TMP_DIR"
# Some sandboxed terminals cannot write the default clang module cache; keep
# everything inside the project directory instead.
export CLANG_MODULE_CACHE_PATH="$MODULE_CACHE"
export SWIFT_MODULE_CACHE_PATH="$MODULE_CACHE"

# ---------------------------------------------------------------------------
# Toolchain / SDK discovery
# ---------------------------------------------------------------------------
SWIFTC="${SWIFTC:-$(command -v swiftc || true)}"
[[ -x "$SWIFTC" ]] || fail "找不到 swiftc。请先安装 Xcode Command Line Tools：xcode-select --install"
CLANG="${CLANG:-$(command -v clang || true)}"
[[ -x "$CLANG" ]] || fail "找不到 clang。请先安装 Xcode Command Line Tools。"

# Some CLT releases ship an SDK whose Swift module was built with a slightly
# different compiler than /usr/bin/swiftc (the "this SDK is not supported by
# the compiler" error).  Probe the candidates with a tiny compile and use the
# first one the local compiler can actually use.  An explicit SDK is honoured
# but still probed, so mistakes are reported clearly.
SDK="${SDK_PATH:-${MACOSX_SDK:-}}"
SDK_CANDIDATES=()
if [[ -n "$SDK" ]]; then
  SDK_CANDIDATES+=("$SDK")
else
  if command -v xcrun >/dev/null 2>&1; then
    SDK_CANDIDATES+=("$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)")
  fi
  SDK_CANDIDATES+=(
    "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk"
    "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"
  )
  # Versioned CLT SDKs, newest first (skip symlinks such as MacOSX.sdk and MacOSX14.sdk).
  VERSIONED_SDKS="$(find /Library/Developer/CommandLineTools/SDKs -maxdepth 1 -name 'MacOSX*.sdk' -type d 2>/dev/null | sort -rV)"
  for versioned in $VERSIONED_SDKS; do
    SDK_CANDIDATES+=("$versioned")
  done
fi

sdk_works() {
  local candidate="$1"
  [[ -n "$candidate" && -d "$candidate" ]] || return 1
  local probe="$BUILD_DIR/.sdk-probe.swift"
  local binary="$BUILD_DIR/.sdk-probe"
  printf 'import Foundation\nprint("sdk-ok")\n' > "$probe"
  if "$SWIFTC" -sdk "$candidate" -module-cache-path "$MODULE_CACHE" \
       -target "${PROBE_ARCH:-arm64}-apple-macos$DEPLOYMENT_TARGET" \
       "$probe" -o "$binary" >/dev/null 2>&1; then
    rm -f "$probe" "$binary"
    return 0
  fi
  rm -f "$probe" "$binary"
  return 1
}

PROBE_ARCH="${ARCHS%% *}"
SDK=""
for candidate in "${SDK_CANDIDATES[@]}"; do
  if sdk_works "$candidate"; then SDK="$candidate"; break; fi
  warn "SDK 不可用（编译器模块版本不匹配）：$candidate"
done
if [[ -z "$SDK" ]]; then
  if [[ -n "${SDK_PATH:-${MACOSX_SDK:-}}" ]]; then
    fail "指定的 SDK 不可用：${SDK_PATH:-$MACOSX_SDK}。请确认该 SDK 与 swiftc 版本匹配。"
  fi
  fail "找不到可用的 macOS SDK。请安装匹配的 Command Line Tools，或设置 SDK_PATH=/Library/Developer/CommandLineTools/SDKs/MacOSX14.5.sdk"
fi

info "工具链"
echo "    swiftc:  $SWIFTC"
echo "    clang:   $CLANG"
echo "    SDK:     $SDK"
echo "    target:  ${ARCHS} / macOS ${DEPLOYMENT_TARGET}+"
echo "    version: $VERSION"
"$SWIFTC" --version | head -2 | sed 's/^/    /'

# ---------------------------------------------------------------------------
# Swift sources
# ---------------------------------------------------------------------------
SHARED_SOURCES=(
  Sources/Shared/TernInfo.swift
  Sources/Shared/Log.swift
  Sources/Shared/KeychainStore.swift
  Sources/FileProvider/FileProviderShared.swift
  Sources/FileProvider/TernSyncClient.swift
)
APP_SOURCES=(
  Sources/App/TernApp.swift
  Sources/App/AppModel.swift
  Sources/App/SettingsStore.swift
  Sources/App/LaunchAgentManager.swift
  Sources/App/MenuBarView.swift
  Sources/App/SettingsView.swift
  Sources/App/FileProviderBridge.swift
  Sources/App/FileProviderWatcher.swift
  Sources/App/ShareRequestHandler.swift
  Sources/App/UpdateChecker.swift
)
for file in "${SHARED_SOURCES[@]}" "${APP_SOURCES[@]}"; do
  [[ -f "$file" ]] || fail "缺少源文件：$file"
done

PLUGIN_PATH="/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/usr/lib/swift/host/plugins"
PLUGIN_FLAGS=()
if [[ -d "$PLUGIN_PATH" ]]; then PLUGIN_FLAGS=(-plugin-path "$PLUGIN_PATH"); fi
COMMON_FLAGS=(
  -sdk "$SDK"
  -module-cache-path "$MODULE_CACHE"
  -swift-version 5
  -Xfrontend -disable-sandbox
  -O
  -parse-as-library
  -framework Security
  -framework AppKit
  -framework SwiftUI
  -framework FileProvider
)

APP_SLICES=()
for arch in $ARCHS; do
  target="${arch}-apple-macos$DEPLOYMENT_TARGET"
  app_slice="$BUILD_DIR/${APP_NAME}-${arch}"

  info "编译应用（${arch}）"
  if ! "$SWIFTC" "${COMMON_FLAGS[@]}" "${PLUGIN_FLAGS[@]}" -target "$target" \
        "${APP_SOURCES[@]}" "${SHARED_SOURCES[@]}" \
        -o "$app_slice" 2> "$BUILD_DIR/build-app-${arch}.log"; then
    cat "$BUILD_DIR/build-app-${arch}.log" >&2
    fail "应用编译失败（${arch}），日志：$BUILD_DIR/build-app-${arch}.log"
  fi
  if [[ -s "$BUILD_DIR/build-app-${arch}.log" ]]; then
    sed 's/^/    /' "$BUILD_DIR/build-app-${arch}.log" | head -40
  fi
  ok "$app_slice"

  APP_SLICES+=("$app_slice")
done

# ---------------------------------------------------------------------------
# Assemble the .app bundle
# ---------------------------------------------------------------------------
info "组装 $APP_NAME.app"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

if [[ ${#APP_SLICES[@]} -eq 1 ]]; then
  cp "${APP_SLICES[0]}" "$APP_DIR/Contents/MacOS/$APP_NAME"
else
  /usr/bin/lipo -create "${APP_SLICES[@]}" -output "$APP_DIR/Contents/MacOS/$APP_NAME"
fi
chmod +x "$APP_DIR/Contents/MacOS/$APP_NAME"

cp "$ROOT/Resources/Info.plist" "$APP_DIR/Contents/Info.plist"
printf 'APPL????' > "$APP_DIR/Contents/PkgInfo"
if [[ -f "$ROOT/Resources/AppIcon.icns" ]]; then
  cp "$ROOT/Resources/AppIcon.icns" "$APP_DIR/Contents/Resources/AppIcon.icns"
else
  warn "缺少 Resources/AppIcon.icns（可运行 tools/make-icon.py 生成）"
fi

# ---------------------------------------------------------------------------
# Ad-hoc code signing
# ---------------------------------------------------------------------------
info "临时签名（ad-hoc，无需开发者账号）"
/usr/bin/codesign --force --sign - --timestamp=none "$APP_DIR/Contents/MacOS/$APP_NAME" >/dev/null 2>&1 \
  || fail "应用二进制签名失败"
/usr/bin/codesign --force --sign - --timestamp=none "$APP_DIR" >/dev/null 2>&1 \
  || fail "应用包签名失败"

/usr/bin/codesign --verify --deep --strict --verbose=2 "$APP_DIR" 2>&1 | sed 's/^/    /'
/usr/bin/codesign -dv "$APP_DIR" 2>&1 | sed -n '1,6p' | sed 's/^/    /'
ok "codesign --verify 通过"

# ---------------------------------------------------------------------------
# Distributable zip
# ---------------------------------------------------------------------------
rm -f "$DIST_DIR"/"$APP_NAME"-*.zip "$DIST_DIR"/"$APP_NAME"-*.zip.sha256
ZIP="$DIST_DIR/$APP_NAME-$VERSION.zip"
info "打包 $ZIP"
rm -f "$ZIP"
/usr/bin/ditto -c -k --keepParent "$APP_DIR" "$ZIP"
( cd "$DIST_DIR" && /usr/bin/shasum -a 256 "$(basename "$ZIP")" > "$(basename "$ZIP").sha256" )
ok "$ZIP"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
SIZE_APP=$(/usr/bin/du -sh "$APP_DIR" | awk '{print $1}')
SIZE_ZIP=$(/usr/bin/du -sh "$ZIP" | awk '{print $1}')
echo
info "构建完成"
echo "    应用:      $APP_DIR ($SIZE_APP)"
echo "    Zip:       $ZIP ($SIZE_ZIP)"
echo "    签名:      ad-hoc（$(/usr/bin/codesign -dv "$APP_DIR" 2>&1 | awk -F= '/Identifier=/{print $2; exit}')）"
echo
echo "下一步:"
echo "    open \"$APP_DIR\"                       # 启动菜单栏应用"
echo "    TEAM=你的TeamID ./build-xcode.sh        # 生成带 File Provider 扩展的签名版"
