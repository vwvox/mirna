import type { ReactNode } from "react";

import type { BillingInfo } from "@anlg/supabase";

import { type BillingAccess, BillingContext } from "./billing-context";

// Mirna has no subscriptions. Everything that runs on this device is
// available, and plan status is never checked or purchased online. The shape
// matches the old billing context so feature gates simply resolve as unlocked.
const LOCAL_BILLING: BillingInfo = {
  entitlements: ["hyprnote_pro"],
  subscriptionStatus: null,
  isPro: true,
  isLite: false,
  isPaid: true,
  isTrialing: false,
  isPaused: false,
  hasPaymentMethod: false,
  trialEnd: null,
  trialDaysRemaining: null,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  plan: "pro",
};

const LOCAL_BILLING_ACCESS: BillingAccess = {
  ...LOCAL_BILLING,
  isReady: true,
  canStartTrial: { data: false, isPending: false },
  upgradeToPro: () => {},
  isUpgradingToPro: false,
};

export function BillingProvider({ children }: { children: ReactNode }) {
  return (
    <BillingContext.Provider value={LOCAL_BILLING_ACCESS}>
      {children}
    </BillingContext.Provider>
  );
}
