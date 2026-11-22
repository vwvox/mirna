import { isUserError } from "@anlg/user-error";

import { loadPrivacyPreferences } from "@/settings/privacy-store";

// Mirna has no crash reporting service. In development builds operational
// errors are written to the Metro/logcat console; nothing leaves the phone.

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
  if (typeof __DEV__ === "undefined" || !__DEV__ || isUserError(error)) return;
  if (error && typeof error === "object") {
    if (loggedErrors.has(error)) return;
    loggedErrors.add(error);
  }
  // console.log rather than console.error so dev builds show no error overlay.
  console.log(`[mirna] ${operation} (${level})`, error, tags ?? {});
}

export function addOperationalBreadcrumb(
  _operation: string,
  _data?: Record<string, ErrorContextValue>,
) {}

export function addNavigationBreadcrumb(_from: string | null, _to: string) {}

export function setErrorReportingUser(_userId: string | null) {}
