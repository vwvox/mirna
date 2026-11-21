# Licensing

All code in this repository is under the MIT License (see [LICENSE](LICENSE)).

- Mirna's changes and additions: Copyright (c) 2026-present vwvox and the Mirna contributors.
- The original Anarlog code: Copyright (c) 2023-present Fastrepl, Inc.

The MIT License allows modifying, sublicensing and selling the code. Its one condition is that the original copyright notice and permission text stay with all copies or substantial portions, which is why both lines appear in [LICENSE](LICENSE). That file must not be removed or have the Fastrepl line deleted.

- **Enterprise code removed:** Anarlog's commercially licensed `enterprise/` workspace is not part of Mirna.
- **Vendored code:** `vendor/swift-rs` is a vendored copy of [swift-rs](https://github.com/Brendonovich/swift-rs), MIT OR Apache-2.0.

## Models and runtimes Mirna can download or use

| Component | Licence | Note |
|---|---|---|
| Whisper / whisper.cpp models | MIT | Downloaded from Hugging Face (`ggerganov/whisper.cpp`) |
| NVIDIA Parakeet TDT | CC-BY-4.0 | Attribution required |
| pyannote speaker diarization | CC-BY-4.0 | Attribution required |
| sqlite-sync (CRDT extension) | Apache-2.0 | Vendored binary in `crates/cloudsync` |
| Qwen 3.5, Gemma 4 (via Ollama) | Apache-2.0 | Installed by the user |

Before distributing Mirna to others, audit third-party notices and include the required attributions.
