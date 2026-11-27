import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";

import { DeviceMobile, Laptop, Play } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { Spinner } from "@anlg/ui/components/ui/spinner";

import { useLessonDocument } from "../documents";
import { useLessonSheet } from "../queries";
import { parseLessonPractice } from "../schema";
import { requestReviewPlan, useReviewPlanStatus } from "./auto";
import { useReviewPlan } from "./document";
import { ReviewPlayer } from "./review-player";
import { piecesFor, type ReviewLength } from "./types";

import { useLanguageModel } from "~/ai/hooks";

/** The study sheet's Review button: 5 minutes, or 10, full window. */
export function ReviewButton({
  sessionId,
  title,
}: {
  sessionId: string;
  title: string;
}) {
  const { t } = useLingui();
  const sheet = useLessonSheet(sessionId);
  const document = useReviewPlan(sessionId);
  const writing = useReviewPlanStatus((state) =>
    Boolean(state.bySession[sessionId]),
  );
  const model = useLanguageModel("enhance");
  const [playing, setPlaying] = useState<ReviewLength | null>(null);
  const hasSheet = Boolean(sheet);
  const hasPlan = Boolean(document);

  // Lessons written up before reviews get theirs the first time they're opened.
  useEffect(() => {
    if (hasSheet && !hasPlan) void requestReviewPlan(sessionId, model);
  }, [hasPlan, hasSheet, model, sessionId]);

  if (!sheet) return null;
  const short = document ? piecesFor(document.plan, 5) : [];
  const long = document?.plan.pieces ?? [];

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          onClick={() => setPlaying(5)}
          disabled={short.length === 0}
          title={
            short.length === 0
              ? t`Nothing to review in this lesson yet`
              : t`A 5-minute review of this lesson`
          }
        >
          {!document && writing ? (
            <Spinner className="size-3.5" />
          ) : (
            <Play className="size-3.5" weight="bold" />
          )}
          <Trans>Review · 5 min</Trans>
        </Button>
        {long.length > short.length ? (
          <Button size="sm" variant="outline" onClick={() => setPlaying(10)}>
            <Trans>10 min</Trans>
          </Button>
        ) : null}
      </div>
      {playing && document ? (
        <ReviewPlayer
          key={playing}
          sessionId={sessionId}
          title={title}
          document={document}
          length={playing}
          onLength={setPlaying}
          onClose={() => setPlaying(null)}
        />
      ) : null}
    </>
  );
}

/** The last review, wherever it was played, for the sheet's header. */
export function LastReview({ sessionId }: { sessionId: string }) {
  const practice = useLessonDocument(
    sessionId,
    "lesson_practice",
    parseLessonPractice,
  );
  const reviews = practice?.reviews ?? [];
  const last = reviews[reviews.length - 1];
  if (!last) return null;
  const when = new Date(last.endedAt);
  const date = Number.isNaN(when.getTime())
    ? ""
    : when.toLocaleString(undefined, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
  const right = last.right;
  const total = last.total;
  return (
    <span className="inline-flex items-center gap-1.5">
      {last.device === "phone" ? (
        <DeviceMobile className="size-3.5" />
      ) : (
        <Laptop className="size-3.5" />
      )}
      {last.device === "phone" ? (
        <Trans>
          Reviewed on the phone {date}, {right} of {total} right
        </Trans>
      ) : (
        <Trans>
          Reviewed {date}, {right} of {total} right
        </Trans>
      )}
    </span>
  );
}
