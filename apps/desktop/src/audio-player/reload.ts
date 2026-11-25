import type { QueryClient } from "@tanstack/react-query";

/**
 * Makes an open note load its recording again after the file changed in
 * place. The path can stay the same (a trimmed MP3), so the player is emptied
 * first; otherwise it would keep playing what it already loaded.
 */
export function reloadSessionAudio(
  queryClient: QueryClient,
  sessionId: string,
) {
  queryClient.setQueryData(["audio", sessionId, "url"], {
    status: "error",
    error: "audio_reloading",
  });
  void queryClient.invalidateQueries({ queryKey: ["audio", sessionId] });
}
