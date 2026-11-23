const activeSessions = new Set<string>();
const stopHandlers = new Map<string, () => Promise<unknown>>();
const stopWaiters = new Map<
  string,
  Array<(stop: (() => Promise<unknown>) | null) => void>
>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function beginMobileCapture(
  sessionId: string,
  stop?: () => Promise<unknown>,
): void {
  const wasActive = activeSessions.size > 0;
  activeSessions.add(sessionId);
  if (stop) {
    stopHandlers.set(sessionId, stop);
    for (const resolve of stopWaiters.get(sessionId) ?? []) resolve(stop);
    stopWaiters.delete(sessionId);
  }
  if (!wasActive) notify();
}

export function endMobileCapture(sessionId: string): void {
  const wasActive = activeSessions.size > 0;
  activeSessions.delete(sessionId);
  stopHandlers.delete(sessionId);
  for (const resolve of stopWaiters.get(sessionId) ?? []) resolve(null);
  stopWaiters.delete(sessionId);
  if (wasActive && activeSessions.size === 0) notify();
}

export function subscribeMobileCapture(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMobileCaptureActive(): boolean {
  return activeSessions.size > 0;
}

/** Whether this session's recording is still in progress (not yet saved). */
export function isCapturingSession(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}

// Sessions whose mic is on, about to be, or paused. Narrower than the active
// captures above, which also cover saving and failed recordings.
const recordingSessions = new Set<string>();
const recordingListeners = new Set<() => void>();

export function setSessionRecording(
  sessionId: string,
  recording: boolean,
): void {
  const wasRecording = recordingSessions.size > 0;
  if (recording) recordingSessions.add(sessionId);
  else recordingSessions.delete(sessionId);
  if (wasRecording !== recordingSessions.size > 0) {
    for (const listener of recordingListeners) listener();
  }
}

/**
 * True while a recording is running or paused. Saving is not recording, so
 * a recording that has just stopped can be sent to the Mac straight away.
 */
export function isRecordingNow(): boolean {
  return recordingSessions.size > 0;
}

export function subscribeRecordingNow(listener: () => void): () => void {
  recordingListeners.add(listener);
  return () => recordingListeners.delete(listener);
}

export async function stopMobileCapture(): Promise<boolean> {
  const registeredStop = stopHandlers.values().next().value;
  if (registeredStop) {
    await registeredStop();
    return true;
  }

  const sessionId = activeSessions.values().next().value;
  if (!sessionId) return false;
  const stop = await new Promise<(() => Promise<unknown>) | null>((resolve) => {
    const waiters = stopWaiters.get(sessionId) ?? [];
    waiters.push(resolve);
    stopWaiters.set(sessionId, waiters);
  });
  if (!stop) return false;
  await stop();
  return true;
}
