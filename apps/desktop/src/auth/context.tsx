import type { ReactNode } from "react";

import { AuthContext, type AuthContextType } from "./auth-context";

// Mirna has no accounts. The provider keeps the auth context's shape so the
// rest of the app keeps working, but it is permanently signed out and never
// contacts an identity service: there is no client, no session and no tokens.
const LOCAL_AUTH: AuthContextType = {
  supabase: null,
  session: null,
  isRefreshingSession: false,
  isFingerprintSettled: true,
  signIn: async () => {},
  signOut: async () => {},
  refreshSession: async () => null,
  getSessionForRequest: async () => null,
  handleAuthCallback: async () => {},
  setSessionFromTokens: async () => {},
  getHeaders: () => null,
  getAvatarUrl: async () => null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={LOCAL_AUTH}>{children}</AuthContext.Provider>
  );
}
