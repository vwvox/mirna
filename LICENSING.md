# Licensing

All code in this repository is under the MIT License (see [LICENSE](LICENSE)), inherited from Anarlog (Copyright (c) 2023-present Fastrepl, Inc.).

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
