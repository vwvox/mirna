import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { useAuth } from "./auth-context";
import { AuthProvider } from "./context";

describe("AuthProvider", () => {
  it("is permanently signed out and never issues credentials", async () => {
    const { result } = renderHook(useAuth, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      ),
    });

    expect(result.current.session).toBeNull();
    expect(result.current.supabase).toBeNull();
    expect(result.current.getHeaders()).toBeNull();
    await expect(result.current.getSessionForRequest()).resolves.toBeNull();
  });
});
