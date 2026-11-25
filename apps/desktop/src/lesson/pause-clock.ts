/**
 * Paused stretches of a recording aren't saved, so a mark's place in the audio
 * is the time since the recording started minus the time spent paused. This
 * follows the recorder's paused flag in each window that can add marks.
 */

type PauseClock = { pausedMs: number; pausedSince: number | null };
type LiveView = { sessionId: string | null; paused: boolean };

export function createPauseClocks(now: () => number = Date.now) {
  const clocks = new Map<string, PauseClock>();
  let last: LiveView = { sessionId: null, paused: false };

  return {
    /** Call with the recorder's state whenever it changes. */
    observe(live: LiveView) {
      const { sessionId, paused } = live;
      if (!sessionId) {
        last = { sessionId: null, paused: false };
        return;
      }
      if (sessionId !== last.sessionId) {
        // A new capture starts its own clock, even for a note recorded before.
        clocks.set(sessionId, {
          pausedMs: 0,
          pausedSince: paused ? now() : null,
        });
      } else if (paused !== last.paused) {
        const clock = clocks.get(sessionId) ?? {
          pausedMs: 0,
          pausedSince: null,
        };
        if (paused) {
          clock.pausedSince = now();
        } else if (clock.pausedSince !== null) {
          clock.pausedMs += now() - clock.pausedSince;
          clock.pausedSince = null;
        }
        clocks.set(sessionId, clock);
      }
      last = { sessionId, paused };
    },
    /** Time spent paused in the session's current capture, up to `at`. */
    pausedMs(sessionId: string, at = now()): number {
      const clock = clocks.get(sessionId);
      if (!clock) return 0;
      return (
        clock.pausedMs +
        (clock.pausedSince !== null ? Math.max(0, at - clock.pausedSince) : 0)
      );
    },
  };
}

export const pauseClocks = createPauseClocks();
