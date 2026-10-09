#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$SCRIPT_DIR/FreeFlix.xcodeproj"
BUILD_DIR="$SCRIPT_DIR/build"
APP_PATH="$BUILD_DIR/Build/Products/Release-iphoneos/FreeFlix.app"
OUTPUT_DIR="$SCRIPT_DIR/../dist/ios"

xcodebuild \
  -project "$PROJECT" \
  -target FreeFlix \
  -configuration Release \
  -sdk iphoneos \
  -derivedDataPath "$BUILD_DIR" \
  CODE_SIGNING_ALLOWED=NO

test -d "$APP_PATH" || { echo "Xcode did not produce FreeFlix.app" >&2; exit 1; }
mkdir -p "$OUTPUT_DIR"
PACKAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$PACKAGE_DIR"' EXIT
mkdir "$PACKAGE_DIR/Payload"
cp -R "$APP_PATH" "$PACKAGE_DIR/Payload/FreeFlix.app"
(
  cd "$PACKAGE_DIR"
  /usr/bin/ditto -c -k --sequesterRsrc --keepParent Payload "$OUTPUT_DIR/FreeFlix-iOS.ipa"
)
echo "Created $OUTPUT_DIR/FreeFlix-iOS.ipa"
