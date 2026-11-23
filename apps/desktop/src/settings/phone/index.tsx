import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useEffect, useState } from "react";

import {
  commands as phoneLinkCommands,
  events as phoneLinkEvents,
  type PairingInfo,
} from "@anlg/plugin-phone-link";
import { Shield } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { toast } from "@anlg/ui/components/ui/toast";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";
import { formatDistanceToNow } from "@anlg/utils";

import { SettingsPageTitle } from "~/settings/page-title";
import { useLatestRef } from "~/shared/hooks/useLatestRef";

const PHONES_QUERY_KEY = ["phone-link", "phones"] as const;
const STATUS_QUERY_KEY = ["phone-link", "status"] as const;

async function unwrap<T>(
  result: Promise<
    { status: "ok"; data: T } | { status: "error"; error: string }
  >,
) {
  const value = await result;
  if (value.status === "error") throw new Error(value.error);
  return value.data;
}

export function SettingsPhone() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const [pairing, setPairing] = useState<PairingInfo | null>(null);

  const phones = useQuery({
    queryKey: PHONES_QUERY_KEY,
    queryFn: () => unwrap(phoneLinkCommands.listPhones()),
  });
  const status = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: () => unwrap(phoneLinkCommands.getStatus()),
    refetchInterval: 10_000,
  });

  useMountEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void phoneLinkEvents.phoneLinkEvent
      .listen((event) => {
        if (event.payload.type !== "phonePaired") return;
        setPairing(null);
        toast.success(t`Paired with ${event.payload.name}`);
        void queryClient.invalidateQueries({ queryKey: PHONES_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  });

  const startPairing = useMutation({
    mutationFn: () => unwrap(phoneLinkCommands.startPairing()),
    onSuccess: (info) => {
      setPairing(info);
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const cancelPairing = useMutation({
    mutationFn: () => unwrap(phoneLinkCommands.cancelPairing()),
    onSettled: () => {
      setPairing(null);
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
  });

  const removePhone = useMutation({
    mutationFn: (fingerprint: string) =>
      unwrap(phoneLinkCommands.removePhone(fingerprint)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: PHONES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
  });

  const pairedPhones = phones.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <SettingsPageTitle title={t`Phone`} />
        <p className="text-muted-foreground max-w-[520px] text-sm leading-[21px]">
          {t`Your phone records and sends the audio here over your Wi-Fi. This Mac writes the transcript and summary, then sends them back.`}
        </p>
      </div>

      {pairing ? (
        <PairingCard
          info={pairing}
          onCancel={() => cancelPairing.mutate()}
          onExpired={() => setPairing(null)}
        />
      ) : (
        <section className="bg-card flex items-center justify-between gap-6 rounded-2xl border p-[22px]">
          <p className="text-sm leading-[21px]">
            {t`Show a pairing code here, then scan it with Mirna on your phone.`}
          </p>
          <Button
            className="shrink-0"
            disabled={startPairing.isPending}
            onClick={() => startPairing.mutate()}
          >
            {pairedPhones.length === 0
              ? t`Pair a phone`
              : t`Pair another phone`}
          </Button>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-[15px] leading-5 font-semibold">
          {t`Paired phones`}
        </h3>
        {pairedPhones.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-3.5 text-sm">
            {t`None yet. The phone shows up here once it has scanned the code.`}
          </p>
        ) : (
          <ul className="bg-card flex flex-col divide-y rounded-xl border">
            {pairedPhones.map((phone) => (
              <li
                key={phone.fingerprint}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{phone.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {phone.last_seen_ms
                      ? t`Last seen ${formatDistanceToNow(new Date(phone.last_seen_ms), { addSuffix: true })}`
                      : t`Not seen yet`}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={removePhone.isPending}
                  onClick={() => removePhone.mutate(phone.fingerprint)}
                >
                  {t`Remove`}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="text-muted-foreground flex flex-col gap-1 text-xs leading-[18px]">
        {status.data?.error ? (
          <p className="text-destructive">{status.data.error}</p>
        ) : null}
        <p className="flex items-center gap-2">
          <Shield aria-hidden className="size-[15px] shrink-0" />
          {t`Mirna only listens on your network while a phone is paired or this code is showing.`}
        </p>
      </div>
    </div>
  );
}

function PairingCard({
  info,
  onCancel,
  onExpired,
}: {
  info: PairingInfo;
  onCancel: () => void;
  onExpired: () => void;
}) {
  const { t } = useLingui();
  const [secondsLeft, setSecondsLeft] = useState(info.expires_in_secs);
  const onExpiredRef = useLatestRef(onExpired);

  useEffect(() => {
    const deadline = Date.now() + info.expires_in_secs * 1000;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) {
        clearInterval(timer);
        onExpiredRef.current();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [info, onExpiredRef]);

  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return (
    <section className="bg-card flex items-center gap-7 rounded-2xl border p-[22px]">
      {/* The code carries its own paper-coloured quiet zone, so it stays scannable in dark mode. */}
      <div className="bg-mirna-paper shrink-0 rounded-xl border p-1">
        <img
          alt={t`Pairing code`}
          className="block size-44"
          src={`data:image/svg+xml;utf8,${encodeURIComponent(info.qr_svg)}`}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">
        <h3 className="font-brand text-mirna-wordmark text-xl leading-[26px] font-semibold">
          {t`Scan with Mirna on your phone`}
        </h3>
        <p className="text-sm leading-[21px]">
          <Trans>
            On the phone, open{" "}
            <strong className="font-semibold">Settings › Mac</strong> and tap{" "}
            <strong className="font-semibold">Scan pairing code</strong>. Both
            need to be on the same Wi-Fi.
          </Trans>
        </p>
        <p className="text-muted-foreground font-mono text-[13px] leading-[18px]">
          {t`This code works for ${countdown} and only once.`}
        </p>
        <div className="mt-1 flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void writeText(info.uri).then(() =>
                toast.success(
                  t`Pairing link copied. Paste it in Mirna on your phone.`,
                ),
              );
            }}
          >
            {t`Copy pairing link`}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t`Cancel`}
          </Button>
        </div>
      </div>
    </section>
  );
}
