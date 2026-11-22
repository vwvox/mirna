# Mirna — agent guide

Mirna is a local-first meeting notetaker for macOS, forked from Anarlog (MIT) at upstream commit `7c2a321`. Read [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md) first.

## Product rules (do not break)

- **Nothing leaves the device by default.** No analytics, crash reporting, update checks, accounts or vendor-hosted services.
- **Cloud is opt-in only:** the only outbound traffic allowed is to providers the user configured with their own API key, and to model downloads the user starts.
- **The webview's network access is an allowlist** in `apps/desktop/src-tauri/capabilities/default.json`.
  - Keep every entry a valid URLPattern: one invalid entry makes Tauri reject the whole scope.
  - `http_scope_allows_local_models_and_blocks_vendor_hosts` in `apps/desktop/src-tauri/src/lib.rs` must keep passing.
- **Never re-enable hosted or account features.** Sign-in and billing are local stand-ins (`apps/desktop/src/auth/context.tsx` and `billing.tsx`). Do not re-enable the vendor's hosted providers (the `"anarlog"` provider id), Supabase, PostHog, Sentry, the updater or CloudSync networking.
- **Vendor code is legacy.** Code that still references anarlog.so, Supabase, sharing, teams or CloudSync is being removed, so don't build new features on it.

## Layout

- `apps/desktop/`: Tauri 2 app.
  - **Frontend:** React, TypeScript, Vite and Tailwind in `src/`.
  - **Rust shell:** `src-tauri/`.
  - **State:** Zustand owns UI state; TanStack Query and Form own queries, mutations and forms.
- `apps/mobile/`: Expo/React Native app with a Rust UniFFI bridge. Kept for the planned Android companion; not yet adapted.
- `apps/cli/`: CLI/MCP entry point.
- `crates/`, `plugins/`: Rust crates and Tauri plugins.
  - `crates/db-app` is the shared SQLite schema. Migrations are append-only and must stay downgrade-safe.
  - `crates/transcribe-core` handles speech chunking, including the noisy-audio fallback.
- `packages/`: shared TypeScript packages, for example `@anlg/ui`.
- `vendor/swift-rs`: patched to use SwiftPM's native build system (Xcode 27).

Package names still use the `anlg`/`anarlog` prefixes. Renaming them is part of the Mirna rename.

## Commands

- **Install:** `pnpm install`.
- **Typecheck the frontend:** `pnpm -F @anlg/desktop typecheck`.
- **Test the frontend:** `pnpm -F @anlg/desktop exec vitest run [paths]`. The full suite has about 4,200 tests.
- **Lint:** `pnpm exec oxlint --quiet` (run in `apps/desktop`).
- **Format:** `pnpm exec dprint fmt --allow-no-files <files>`.
- **Rust:**
  - Export `RUSTUP_TOOLCHAIN=stable CARGO_TARGET_DIR="$HOME/Library/Caches/mirna-target" CARGO_PROFILE_DEV_DEBUG=0 SONIQO_DISABLE=1`.
  - Run `cargo test -p <crate>` or `cargo build -p desktop --no-default-features --features direct-distribution,dev`.
- **Run the app:** build and sign a debug `.app` as shown in the README. `tauri dev` cannot obtain the system-audio and Accessibility permissions.
- **See and drive the UI yourself:** with the debug app running, start `pnpm -F desktop dev` and open `http://localhost:1423/app/main` in your browser tool. The relay connects it to the real app (see CONTRIBUTING.md). Use it to check visual changes instead of asking for screenshots.

## Conventions

- Write a regression test for each fix. Replace tests that assert removed vendor behaviour, rather than skipping them.
- Avoid comments unless they explain why. Use `cn` from `@anlg/utils` with arrays for conditional classes.
- Use `useForm` and `useQuery`/`useMutation` instead of manual state.
- Commit only when asked. Keep commits focused, with succinct messages that explain what and why.
