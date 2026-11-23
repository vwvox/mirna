import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/auth/context";

import { readProviderConfig } from "./providers";
import type { ProviderKind } from "./providers-model";

// True only when the user has set up a provider with their own key. Mirna never
// falls back to Anarlog's hosted models.
export function useProviderAccess(kind: ProviderKind) {
  const auth = useAuth();
  const account = auth.session?.user.id ?? null;
  const config = useQuery({
    queryKey: ["provider", account, kind],
    queryFn: () => readProviderConfig(account, kind),
  });
  return Boolean(config.data && config.data.provider !== "anarlog");
}
