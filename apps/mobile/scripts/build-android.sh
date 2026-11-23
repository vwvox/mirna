#!/usr/bin/env bash
# Builds Mirna for Android as a signed release APK (64-bit ARM phones).
#
#   apps/mobile/scripts/build-android.sh            # app only
#   apps/mobile/scripts/build-android.sh --bridge   # rebuild the Rust bridge first
#   apps/mobile/scripts/build-android.sh --quick    # reuse android/ (JS-only changes)
#
# Needs the Android SDK (with NDK 27.1) in ~/Library/Android/sdk, JDK 17, and
# the signing key made for this Mac (see below). Prints the APK's path.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile="$(cd "$here/.." && pwd)"
root="$(cd "$mobile/../.." && pwd)"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-$ANDROID_HOME/ndk/27.1.12297006}"
export JAVA_HOME="${JAVA_HOME:-/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home}"
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmake/3.22.1/bin:$PATH"
export RUSTUP_TOOLCHAIN="${RUSTUP_TOOLCHAIN:-stable}"
# Kept apart from the desktop build's target folder.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/Library/Caches/mirna-target-android/android}"
export APP_VARIANT="${APP_VARIANT:-stable}"

if [[ "${1:-}" == "--bridge" ]]; then
  (cd "$root" && cargo xtask mobile-bridge android --release --targets arm64-v8a)
fi

if [[ ! -f "$root/packages/mobile-bridge-rn/android/src/main/jniLibs/arm64-v8a/libmobile_bridge.so" ]]; then
  echo "The Rust bridge isn't built yet. Run again with --bridge." >&2
  exit 1
fi

cd "$mobile"
if [[ "${1:-}" != "--quick" || ! -d "$mobile/android" ]]; then
  CI=1 pnpm exec expo prebuild --platform android --clean --no-install
fi

# Mirna's own signing key lives outside the repo; its password is in the
# macOS Keychain (service "mirna-android-signing").
keystore="$HOME/Library/Application Support/Mirna/android-signing/mirna-release.keystore"
if [[ -f "$keystore" ]]; then
  export MIRNA_RELEASE_STORE_FILE="$keystore"
  export MIRNA_RELEASE_KEY_ALIAS="mirna-release"
  MIRNA_RELEASE_STORE_PASSWORD="$(security find-generic-password -s mirna-android-signing -a mirna-release -w)"
  export MIRNA_RELEASE_STORE_PASSWORD
else
  echo "No Mirna signing key found; the APK will use the debug key." >&2
fi

cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain

apk="$mobile/android/app/build/outputs/apk/release/app-release.apk"
version="$(node -p "require('$mobile/release-version.json').version")"
out_dir="${MIRNA_APK_DIR:-$root/dist/android}"
mkdir -p "$out_dir"
cp "$apk" "$out_dir/Mirna-$version.apk"
echo "$out_dir/Mirna-$version.apk"
