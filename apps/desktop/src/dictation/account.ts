import { useAuth } from "~/auth";

/**
 * Mirna has no accounts, so dictations, their recovery records and what learning
 * picks up belong to this device. A signed-in account (none today) still wins.
 */
export const LOCAL_DICTATION_ACCOUNT = "local";

export function useDictationAccount(): string {
  const { session } = useAuth();
  return session?.user.id ?? LOCAL_DICTATION_ACCOUNT;
}
