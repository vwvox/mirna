const gains = new WeakMap<HTMLMediaElement, GainNode>();

/** The volume node a media element plays through, once routed to the centre. */
export function centeredGain(media: HTMLMediaElement): GainNode | null {
  return gains.get(media) ?? null;
}

export function configureCenteredPlayback(
  media: HTMLMediaElement,
  createContext: () => AudioContext = () => new AudioContext(),
): AudioContext | null {
  let context: AudioContext;
  try {
    context = createContext();
  } catch {
    return null;
  }

  try {
    const gainNode = context.createGain();
    gainNode.channelCount = 1;
    gainNode.channelCountMode = "explicit";
    gainNode.channelInterpretation = "speakers";
    gainNode.connect(context.destination);
    context.createMediaElementSource(media).connect(gainNode);
    gains.set(media, gainNode);
  } catch {
    void context.close().catch(() => {});
    return null;
  }

  return context;
}

/**
 * Sends `source` to both ears as one voice: its channels mixed or, for a
 * two-channel recording, only `channel` (0 is the mic, 1 the call). A clip of
 * the teacher then isn't heard in one ear, or with the student talking over it.
 */
export function routeCentered(
  context: BaseAudioContext,
  source: AudioNode,
  channel: number | null = null,
): { output: AudioNode; disconnect: () => void } {
  const mono = context.createGain();
  mono.channelCount = 1;
  mono.channelCountMode = "explicit";
  mono.channelInterpretation = "speakers";
  let splitter: ChannelSplitterNode | null = null;
  if (channel === null) {
    source.connect(mono);
  } else {
    splitter = context.createChannelSplitter(2);
    source.connect(splitter);
    splitter.connect(mono, channel);
  }
  mono.connect(context.destination);
  return {
    output: mono,
    disconnect: () => {
      source.disconnect();
      splitter?.disconnect();
      mono.disconnect();
    },
  };
}

// WebKitGTK creates contexts in the non-standard "interrupted" state, so any
// state other than running needs a resume() before the media graph emits sound.
export function shouldResumeBeforePlay(
  context: AudioContext | null,
): context is AudioContext {
  return (
    context !== null &&
    context.state !== "running" &&
    context.state !== "closed"
  );
}
