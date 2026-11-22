# Contributing and building Mirna

## Prerequisites (macOS, Apple Silicon)

- **Xcode:** full Xcode, with the license accepted (`sudo xcodebuild -license accept`).
- **Metal Toolchain:** `xcodebuild -downloadComponent MetalToolchain`, needed for the on-device Soniqo models (Parakeet, Qwen3-ASR). The first build compiles MLX's Metal kernels, about 8 minutes.
  - This download comes from `mesu.apple.com`, which some networks block.
  - Without it, build with `SONIQO_DISABLE=1` and add `"macOS":{"files":{"Resources/mlx-swift_Cmlx.bundle/default.metallib":null}}` to the `bundle` config.
- **Rust:** Rust via rustup (`brew install rustup`). Mirna builds with **stable** Rust (1.100+); see the toolchain note below.
- **Node and pnpm:** Node 24 and pnpm (the repo pins its pnpm version).
- **cmake:** `brew install cmake`.
- **A local model server for notes:** [Ollama](https://ollama.com), with a model that has a large context window. For example, create `qwen3.5:4b` with `PARAMETER num_ctx 32768` in a Modelfile; Ollama defaults to 4K.

## Build and run

```bash
pnpm install
export RUSTUP_TOOLCHAIN=stable CARGO_TARGET_DIR="$HOME/Library/Caches/mirna-target" CARGO_PROFILE_DEV_DEBUG=0
pnpm -F @anlg/desktop tauri build --debug --bundles app \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'
APP="$CARGO_TARGET_DIR/debug/bundle/macos/Mirna.app"
scripts/sign-macos.sh dev "$APP"
open "$APP"
```

### Sign development builds with a local certificate

macOS remembers keychain access and privacy permissions (microphone, system audio, Accessibility) per signing identity. Signed ad hoc, every rebuild is a new identity: macOS asks for your login password again and the permissions have to be granted again. A local certificate keeps the identity stable. Create it once:

1. Open **Keychain Access** (Spotlight: "Keychain Access").
2. Menu bar: **Keychain Access › Certificate Assistant › Create a Certificate…**
3. Name: `Mirna Development`. Identity Type: **Self-Signed Root**. Certificate Type: **Code Signing**.
4. Click **Create**, then **Done**.

`scripts/sign-macos.sh dev` uses it from then on. The first signature asks whether `codesign` may use the key: enter your login password and choose **Always Allow**. The first launch asks once more for Mirna's own keychain item: **Always Allow** again. After that, rebuilds don't ask.

## Install Mirna on your own Mac

An optimised build is about half a gigabyte installed. The build cache it needs (`$CARGO_TARGET_DIR`) can be deleted afterwards; the next build then starts from scratch, which takes about 30–45 minutes.

```bash
export RUSTUP_TOOLCHAIN=stable CARGO_TARGET_DIR="$HOME/Library/Caches/mirna-target"
pnpm -F @anlg/desktop tauri build --bundles app,dmg --config \
  '{"bundle":{"createUpdaterArtifacts":false,"macOS":{"signingIdentity":"Mirna Development","hardenedRuntime":false}}}'
open "$CARGO_TARGET_DIR/release/bundle/dmg/"
```

Open the `.dmg` and drag Mirna into Applications. It's signed with your local certificate, so it only runs on this Mac. Without the hardened runtime it can load its bundled frameworks under a self-signed certificate. The installer window's background comes from `design/installer/dmg-background.html`.

## Releasing

Builds for other people must be signed with an Apple **Developer ID Application** certificate (Apple Developer Program) and notarized. Its identity stays the same across versions, so keychain access and permissions survive updates. A local or ad hoc signature would make every update ask for the password and lose permissions.

```bash
scripts/sign-macos.sh release "$APP"   # refuses anything but Developer ID
scripts/sign-macos.sh check "$APP"     # use as the last step before publishing
```

## See the running app in a browser

Debug builds run a relay on `127.0.0.1:1423` (`plugins/relay`). It serves the app's interface from the Vite dev server and forwards every command, event and live query to the running desktop app. That gives a browser tab, including an agent's browser, the real app with real data and full DOM access, without screenshots or extra macOS permissions.

1. Start the signed debug app (above).
2. Run `pnpm -F desktop dev` (Vite on port 1422).
3. Open `http://localhost:1423/app/main`.

Frontend edits hot-reload in that tab, so styling can be checked instantly. The native app still needs a rebuild to pick them up. The tab acts on your real notes, so treat clicks there as real actions.

## Build quirks and why they exist

| Setting | Why |
|---|---|
| `CARGO_TARGET_DIR` outside the repo | Native dependencies built with Autotools reject paths that contain spaces |
| `RUSTUP_TOOLCHAIN=stable` | With Xcode 27, the upstream-pinned Rust 1.94 produces proc-macro dylibs that rustc can't load (`E0463 can't find crate for …_proc_macro`) when dependencies build without debug info |
| `CARGO_PROFILE_DEV_DEBUG=0` | Smaller build output on small disks |
| `SONIQO_DISABLE=1` | Builds `transcribe-soniqo` with stubs when the Metal Toolchain is unavailable |
| `vendor/swift-rs` | Xcode 27's default SwiftPM engine writes products where swift-rs does not look; the patch selects the native build system |
| `scripts/sign-macos.sh dev` | macOS ties keychain access and permissions to the app's signature. With the local certificate they carry over; signed ad hoc, they're asked for again after each rebuild. |

- **After updating Xcode:** delete `$CARGO_TARGET_DIR`, because cached build scripts keep old toolchain paths.

## Before committing

- **Typecheck and tests:** `pnpm -F @anlg/desktop typecheck`, and `pnpm -F @anlg/desktop exec vitest run` (or the affected paths).
- **Rust tests:** `cargo test -p <crate>` for each Rust crate you changed.
- **Network allowlist:** if you touched it, also run `cargo test -p desktop --no-default-features --features direct-distribution --lib http_scope_allows`.
- **Formatting:** `pnpm exec dprint fmt --allow-no-files <changed files>`.
