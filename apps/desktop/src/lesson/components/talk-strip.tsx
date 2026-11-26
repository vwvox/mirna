import { useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { create } from "zustand";

import { listenerStore } from "~/store/zustand/listener/instance";

/** Above this level (0..1, as the meters use it) a channel counts as talking. */
const TALKING = 0.18;
const BUCKETS = 60;

type Sample = { mic: boolean; speaker: boolean };

const useTalkSamples = create<{ bySession: Record<string, Sample[]> }>(() => ({
  bySession: {},
}));

export function summarizeTalk(samples: Sample[], buckets = BUCKETS) {
  if (samples.length === 0) return [];
  const size = Math.max(1, Math.ceil(samples.length / buckets));
  const result: { mic: number; speaker: number }[] = [];
  for (let i = 0; i < samples.length; i += size) {
    const slice = samples.slice(i, i + size);
    result.push({
      mic: slice.filter((sample) => sample.mic).length / slice.length,
      speaker: slice.filter((sample) => sample.speaker).length / slice.length,
    });
  }
  return result;
}

/**
 * Who has been talking so far, from the two channels' levels (the microphone is you,
 * the computer's sound is the other side). Sampled once a second while shown.
 */
export function TalkStrip({ sessionId }: { sessionId: string }) {
  const { t } = useLingui();
  const samples = useTalkSamples((state) => state.bySession[sessionId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const live = listenerStore.getState().live;
      if (live.sessionId !== sessionId || live.status !== "active") return;
      const sample = {
        mic: !live.muted && live.amplitude.mic > TALKING,
        speaker: live.amplitude.speaker > TALKING,
      };
      useTalkSamples.setState((state) => ({
        bySession: {
          ...state.bySession,
          [sessionId]: [...(state.bySession[sessionId] ?? []), sample],
        },
      }));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sessionId]);

  const buckets = summarizeTalk(samples ?? []);
  const lanes = [
    { key: "speaker" as const, label: t`Them`, color: "bg-[#2B5C9E]" },
    { key: "mic" as const, label: t`You`, color: "bg-mirna-serra" },
  ];

  return (
    <div
      className="bg-background flex flex-col gap-1.5 rounded-lg border px-3 py-2"
      role="img"
      aria-label={t`Who has been talking so far`}
    >
      {lanes.map((lane) => (
        <div key={lane.key} className="flex items-center gap-2">
          <span className="text-muted-foreground w-10 text-[11px]">
            {lane.label}
          </span>
          <div className="bg-muted rounded-pill flex h-2.5 flex-1 items-stretch gap-px overflow-hidden">
            {buckets.length === 0
              ? null
              : buckets.map((bucket, index) => (
                  <span
                    key={index}
                    className={lane.color}
                    style={{
                      flex: 1,
                      opacity: Math.min(1, bucket[lane.key] * 1.4),
                    }}
                  />
                ))}
          </div>
        </div>
      ))}
    </div>
  );
}
