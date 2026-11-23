// Whether the paired Mac answers right now, for the home screen's Mac pill and
// Settings › Mac. Checks only while one of those is on screen.
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { isOnLocalNetwork } from "../../modules/mac-discovery";
import * as bridge from "./bridge";
import { LinkError } from "./bridge";
import { loadIdentity, targetFor, usePairedMac } from "./pairing";

export type MacReachability =
  | "checking"
  | "not_paired"
  | "ok"
  | "no_wifi" // not on Wi-Fi or Ethernet: away from the Mac
  | "removed" // the Mac no longer knows this phone
  | "other" // a different computer answered at the Mac's address
  | "unreachable";

export function useMacReachability(refetchMs = 15_000): MacReachability {
  const { mac, loading } = usePairedMac();
  // Home stays mounted under the note screen: only check while on screen.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const query = useQuery({
    queryKey: ["mac-link", "reachability", mac?.mac_id, mac?.last_host],
    enabled: !!mac && focused,
    queryFn: async (): Promise<MacReachability> => {
      if (!mac) return "not_paired";
      if (!isOnLocalNetwork()) return "no_wifi";
      const identity = await loadIdentity();
      if (!identity) return "not_paired";
      try {
        const info = await bridge.info({ identity, mac: targetFor(mac, null) });
        return info.paired ? "ok" : "removed";
      } catch (error) {
        return error instanceof LinkError && error.code === "mac_mismatch"
          ? "other"
          : "unreachable";
      }
    },
    refetchInterval: focused ? refetchMs : false,
  });
  if (loading) return "checking";
  if (!mac) return "not_paired";
  return query.data ?? "checking";
}
