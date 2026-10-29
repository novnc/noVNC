#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

export ANDROID_HOME="${ANDROID_HOME:-/home/user/Android/Sdk}"
export PATH="$ANDROID_HOME/build-tools/34.0.0:$PATH"

BUILD_DIR="/tmp/novnc_build"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/compiled_res"
mkdir -p "$BUILD_DIR/gen"
mkdir -p "$BUILD_DIR/classes"
mkdir -p "$BUILD_DIR/dex"

echo "==> 0. Bundling noVNC web core with esbuild..."
if [ -f "$PROJECT_ROOT/node_modules/.bin/esbuild" ]; then
  ESBUILD="$PROJECT_ROOT/node_modules/.bin/esbuild"
elif [ -f "/tmp/node_modules/.bin/esbuild" ]; then
  ESBUILD="/tmp/node_modules/.bin/esbuild"
else
  ESBUILD="npx --yes esbuild"
fi
"$ESBUILD" "$SCRIPT_DIR/app/src/main/assets/novnc/bridge-main.js" \
  --bundle \
  --format=iife \
  --minify \
  --outfile="$SCRIPT_DIR/app/src/main/assets/novnc/novnc.bundle.js"

echo "==> 1. Compiling Android resources with aapt2..."
aapt2 compile --dir "$SCRIPT_DIR/app/src/main/res" -o "$BUILD_DIR/compiled_res.zip"

echo "==> 2. Linking APK package and assets..."
aapt2 link -I "$ANDROID_HOME/platforms/android-34/android.jar" \
  --manifest "$SCRIPT_DIR/app/src/main/AndroidManifest.xml" \
  -o "$BUILD_DIR/novnc_unaligned.apk" \
  -A "$SCRIPT_DIR/app/src/main/assets" \
  --java "$BUILD_DIR/gen" \
  --auto-add-overlay \
  "$BUILD_DIR/compiled_res.zip"

echo "==> 3. Compiling Java sources..."
javac -source 11 -target 11 \
  -cp "$ANDROID_HOME/platforms/android-34/android.jar" \
  -d "$BUILD_DIR/classes" \
  $(find "$BUILD_DIR/gen" -name "*.java") \
  $(find "$SCRIPT_DIR/app/src/main/java" -name "*.java")

echo "==> 4. Converting bytecode with d8..."
d8 --min-api 24 \
  --lib "$ANDROID_HOME/platforms/android-34/android.jar" \
  --output "$BUILD_DIR/dex" \
  $(find "$BUILD_DIR/classes" -name "*.class")

echo "==> 5. Packaging classes.dex..."
cd "$BUILD_DIR/dex"
zip -u "$BUILD_DIR/novnc_unaligned.apk" classes.dex
cd "$PROJECT_ROOT"

echo "==> 6. Zipaligning APK..."
zipalign -v -f -p 4 "$BUILD_DIR/novnc_unaligned.apk" "$SCRIPT_DIR/novnc-android-client.apk"

echo "==> 7. Signing APK..."
KEYSTORE_PATH="/tmp/debug.keystore"
if [ ! -f "$KEYSTORE_PATH" ]; then
  keytool -genkey -v -keystore "$KEYSTORE_PATH" -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=noVNC Android,O=noVNC,C=US"
fi
apksigner sign --ks "$KEYSTORE_PATH" --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android "$SCRIPT_DIR/novnc-android-client.apk"

echo "==> 8. Verifying APK signature..."
apksigner verify -v "$SCRIPT_DIR/novnc-android-client.apk"

echo "SUCCESS! Output APK generated at: $SCRIPT_DIR/novnc-android-client.apk"
ls -lh "$SCRIPT_DIR/novnc-android-client.apk"
