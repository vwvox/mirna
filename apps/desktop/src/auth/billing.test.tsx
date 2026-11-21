import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { BillingProvider } from "./billing";
import { useBillingAccess } from "./billing-context";

describe("BillingProvider", () => {
  it("unlocks local features without any subscription or trial", () => {
    const { result } = renderHook(useBillingAccess, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <BillingProvider>{children}</BillingProvider>
      ),
    });

    expect(result.current).toMatchObject({
      isReady: true,
      isPro: true,
      isPaid: true,
      isTrialing: false,
      canStartTrial: { data: false, isPending: false },
    });
  });
});
