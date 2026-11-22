# mirna

**Calm notes, kept close.** Mirna is a private meeting notetaker for macOS. It listens to your meetings, calls and voice notes, writes structured notes, and keeps everything on your own computer.

> **Status:** early prototype, for personal use. It works end to end on an Apple Silicon Mac. Expect rough edges, leftover code from the original app, and branding that is still being changed.

## What it does

- **Records without a meeting bot.** It captures your microphone and the computer's audio, so it works with Zoom, Meet, Teams, WhatsApp, or a conversation in the room.
- **Transcribes on your Mac** with Whisper (whisper.cpp). Parakeet is also available on machines with Xcode's Metal toolchain.
- **Writes notes from your rough notes and the transcript**, using a local model through Ollama, LM Studio or Apple Intelligence, or a cloud model you connect with your own API key.
- **Answers questions** about a meeting with the same model.

## Privacy

Mirna is built to keep recordings, transcripts and notes on your device.

- **No account, no analytics, no crash reporting, no update checks.**
- **Audio never leaves the Mac** unless you pick a cloud speech provider yourself.
- **The app's network access is an allowlist.** It can reach only:
  - your own machine
  - your local network, or Tailscale, for a model server on another computer
  - the API hosts of AI and speech providers you connect with your own key

  Everything else is refused.
- **Model downloads** (Whisper and GGUF) come from Hugging Face when you start them.

## Run it (development)

Requirements:

- An Apple Silicon Mac with Xcode
- Node 24 and pnpm
- Rust via rustup
- cmake
- [Ollama](https://ollama.com), for local notes

```bash
pnpm install
export RUSTUP_TOOLCHAIN=stable CARGO_TARGET_DIR="$HOME/Library/Caches/mirna-target" CARGO_PROFILE_DEV_DEBUG=0 SONIQO_DISABLE=1
pnpm -F @anlg/desktop tauri build --debug --bundles app \
  --config '{"bundle":{"createUpdaterArtifacts":false,"macOS":{"files":{"Resources/mlx-swift_Cmlx.bundle/default.metallib":null}}}}'
APP="$CARGO_TARGET_DIR/debug/bundle/macos/Mirna.app"
xattr -cr "$APP" 2>/dev/null || true  # macOS may refuse to strip its provenance tag; harmless
codesign --force --deep --sign - --identifier app.mirna.dev --entitlements apps/desktop/src-tauri/Entitlements.plist "$APP"
open "$APP"
```

- **Why a bundle:** run it as a real `.app` like this, rather than with `tauri dev`, so that macOS can grant microphone, system-audio and Accessibility permissions to the app itself.
- **`SONIQO_DISABLE=1`:** builds without Parakeet. Drop it once `xcodebuild -downloadComponent MetalToolchain` has succeeded.
- **More detail:** [CONTRIBUTING.md](CONTRIBUTING.md) explains the build quirks.

In the app:

- **Transcription:** choose *BYO-model* and pick a whisper.cpp `.bin` file.
- **Intelligence:** choose *Ollama* and a model, for example a 4B Qwen with a 32K context window.

## Roadmap

1. **Cloud-free by construction.** Mostly done. Remaining: delete the dormant cloud code still compiled in.
2. **Become Mirna:** rename, the new icon and wordmark, and a calm visual restyle.
3. **Two cloud switches** (cloud transcription and cloud notes), each with a global default and a per-meeting override.
4. **Android companion:** record on the phone when you're out.
5. **Phone ↔ Mac sync** over an encrypted local connection.
6. **Later:** Portuguese, a quick voice-note mode, speaker names, Windows and iPhone.

## Origin and license

Mirna is a fork of [Anarlog](https://github.com/fastrepl/anarlog), formerly Hyprnote, by Fastrepl, Inc.

- **Source:** imported at upstream commit `7c2a321` (desktop v1.4.35) under the MIT License. The first commit in this repository is that tree, unchanged.
- **Changes since then:** listed in the history.
- **License:** MIT, see [LICENSE](LICENSE). Third-party models and components keep their own licences, see [LICENSING.md](LICENSING.md).
