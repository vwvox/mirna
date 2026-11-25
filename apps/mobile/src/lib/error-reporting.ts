import { isUserError } from "@anlg/user-error";

import { logDiagnostic, logDiagnosticError } from "@/lib/diagnostics";
import { loadPrivacyPreferences } from "@/settings/privacy-store";

// Mirna has no crash reporting service. Operational errors go to the phone's
// own problem log (see diagnostics.ts), and in development builds to the
// Metro/logcat console too.

type ErrorContextValue = null | boolean | number | string;
type SeverityLevel = "fatal" | "error" | "warning" | "log" | "info" | "debug";

const loggedErrors = new WeakSet<object>();

export async function initializeErrorReporting() {
  await loadPrivacyPreferences();
}

export function captureOperationalError(
  error: unknown,
  {
    operation,
    level = "error",
    tags,
  }: {
    operation: string;
    level?: SeverityLevel;
    tags?: Record<string, ErrorContextValue>;
    context?: Record<string, ErrorContextValue>;
  },
) {
  if (isUserError(error)) return;
  if (error && typeof error === "object") {
    if (loggedErrors.has(error)) return;
    loggedErrors.add(error);
  }
  logDiagnosticError(
    operation,
    error,
    tags,
    level === "fatal" || level === "error"
      ? "error"
      : level === "warning"
        ? "warning"
        : "info",
  );
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  // console.log rather than console.error so dev builds show no error overlay.
  console.log(`[mirna] ${operation} (${level})`, error, tags ?? {});
}

export function addOperationalBreadcrumb(
  operation: string,
  data?: Record<string, ErrorContextValue>,
) {
  logDiagnostic(operation, data);
}

export function addNavigationBreadcrumb(_from: string | null, _to: string) {}

export function setErrorReportingUser(_userId: string | null) {}
