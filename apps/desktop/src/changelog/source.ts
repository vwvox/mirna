// Mirna does not fetch release notes from the internet. Callers already treat
// a null URL as "no remote changelog available".
export function changelogUrl(_version: string): string | null {
  return null;
}
