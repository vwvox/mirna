#!/usr/bin/env bash
# Signs Mirna.app, or checks that a build is fit to give to other people.
#
#   scripts/sign-macos.sh dev     <Mirna.app>   development builds
#   scripts/sign-macos.sh release <Mirna.app>   builds for other people
#   scripts/sign-macos.sh check   <Mirna.app>   refuse anything not release-signed
#
# Why it matters: macOS remembers keychain access and privacy permissions
# (microphone, system audio, Accessibility) per signing identity. A build
# signed ad hoc gets a new identity every time, so each rebuild asks for the
# login password again and loses its permissions. For people downloading
# Mirna, that would happen on every update. So:
#
# - dev signs with a stable local certificate, "Mirna Development" by default
#   (override with MIRNA_SIGNING_IDENTITY). Without one it falls back to ad
#   hoc and says so.
# - release only accepts an Apple "Developer ID Application" identity, adds the
#   hardened runtime and checks the result. Notarize the app afterwards.
# - check fails unless the app carries a Developer ID signature with a team.

set -euo pipefail

MODE="${1:-}"
APP="${2:-}"
BUNDLE_ID="app.mirna.dev"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTITLEMENTS="$ROOT/apps/desktop/src-tauri/Entitlements.plist"
DEV_IDENTITY="${MIRNA_SIGNING_IDENTITY:-Mirna Development}"

usage() {
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

[[ -n "$MODE" && -n "$APP" ]] || usage
[[ -d "$APP" ]] || { echo "No app at $APP" >&2; exit 1; }

has_identity() {
  # Self-signed certificates aren't "valid" to the system, so list them all.
  security find-identity -p codesigning 2>/dev/null | grep -qF "\"$1\""
}

release_identity() {
  security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' | head -1
}

check_release() {
  local details
  details="$(codesign -dvv "$APP" 2>&1)" || {
    echo "✗ $APP isn't signed." >&2
    return 1
  }
  if grep -q "Signature=adhoc" <<<"$details"; then
    echo "✗ $APP is signed ad hoc. People who install it would be asked for their password and lose permissions on every update." >&2
    return 1
  fi
  if ! grep -q "Authority=Developer ID Application" <<<"$details"; then
    echo "✗ $APP isn't signed with a Developer ID certificate (found: $(grep -m1 '^Authority=' <<<"$details" || echo none))." >&2
    return 1
  fi
  if grep -q "TeamIdentifier=not set" <<<"$details"; then
    echo "✗ $APP has no team identifier." >&2
    return 1
  fi
  codesign --verify --deep --strict "$APP"
  echo "✓ $APP is signed for release ($(grep -m1 '^TeamIdentifier=' <<<"$details")). Notarize it before sharing."
}

clear_attributes() {
  # macOS may refuse to strip its provenance tag; that's harmless.
  xattr -cr "$APP" 2>/dev/null || true
}

case "$MODE" in
  dev)
    clear_attributes
    if has_identity "$DEV_IDENTITY"; then
      codesign --force --deep --sign "$DEV_IDENTITY" --identifier "$BUNDLE_ID" \
        --entitlements "$ENTITLEMENTS" "$APP"
      echo "✓ Signed with \"$DEV_IDENTITY\". Keychain access and permissions carry over between builds."
    else
      codesign --force --deep --sign - --identifier "$BUNDLE_ID" \
        --entitlements "$ENTITLEMENTS" "$APP"
      echo "! Signed ad hoc: no \"$DEV_IDENTITY\" certificate. Expect password prompts and permission requests after each rebuild. See CONTRIBUTING.md." >&2
    fi
    codesign --verify --deep --strict "$APP"
    ;;
  release)
    identity="${MIRNA_SIGNING_IDENTITY:-$(release_identity)}"
    if [[ "$identity" != "Developer ID Application:"* ]]; then
      echo "✗ No Developer ID Application certificate. Release builds can't be signed ad hoc or with a local certificate." >&2
      exit 1
    fi
    clear_attributes
    codesign --force --deep --options runtime --timestamp --sign "$identity" \
      --identifier "$BUNDLE_ID" --entitlements "$ENTITLEMENTS" "$APP"
    check_release
    ;;
  check)
    check_release
    ;;
  *)
    usage
    ;;
esac
