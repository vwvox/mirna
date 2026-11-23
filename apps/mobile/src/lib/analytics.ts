import { loadPrivacyPreferences } from "@/settings/privacy-store";

// Mirna collects no usage analytics. These keep the call sites compiling and
// do nothing.

type AnalyticsValue = null | boolean | number | string | string[] | number[];

export function captureAnalytics(
  _event: string,
  _properties: Record<string, AnalyticsValue> = {},
) {}

export function screenAnalytics(_pathname: string) {}

export function identifyAnalytics(_userId: string) {}

export function resetAnalytics() {}

export function initializeAnalytics(): Promise<void> {
  return loadPrivacyPreferences().then(() => {});
}
