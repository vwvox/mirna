import { useQuery } from "@tanstack/react-query";

// Mirna has no hosted resource catalog: suggestions that used to be fetched
// from the vendor's website resolve to an empty list without any network call.
export function useWebResources<T>(endpoint: string) {
  return useQuery({
    queryKey: ["settings", endpoint, "suggestions"],
    queryFn: async () => [] as T[],
  });
}
