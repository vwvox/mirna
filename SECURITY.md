# Security

Mirna is a personal prototype. Please report security or privacy problems privately to the repository owner rather than in a public issue.

Mirna promises that recordings, transcripts and notes stay on the device unless the user connects a cloud provider with their own key. Any of the following is a bug worth reporting:

- **Unexpected traffic:** the app contacts a host outside its network allowlist (`apps/desktop/src-tauri/capabilities/default.json`), or reaches out from Rust code without a user action.
- **Data sent without a choice:** audio, transcripts or notes go to a provider the user did not choose.
- **Telemetry or accounts coming back:** analytics, crash reporting, update checks or account sign-in reappear after an upstream merge.
