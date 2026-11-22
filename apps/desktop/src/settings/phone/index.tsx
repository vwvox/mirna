import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useEffect, useState } from "react";

import {
  commands as phoneLinkCommands,
  events as phoneLinkEvents,
  type PairingInfo,
} from "@anlg/plugin-phone-link";
import { Button } from "@anlg/ui/components/ui/button";
import { toast } from "@anlg/ui/components/ui/toast";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";
import { formatDistanceToNow } from "@anlg/utils";

import { SettingsPageTitle } from "~/settings/page-title";
import { useLatestRef } from "~/shared/hooks/useLatestRef";

const PHONES_QUERY_KEY = ["phone-link", "phones"] as const;
const STATUS_QUERY_KEY = ["phone-link", "status"] as const;

async function unwrap<T>(
  result: Promise<{ status: "ok"; data: T } | { status: "error"; error: string }>,
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
    <div className="flex flex-col gap-8">
      <SettingsPageTitle title={t`Phone`} />

      <p className="text-muted-foreground max-w-prose text-sm">
        {t`Record on your Android phone when you're away from this Mac. When both are on the same Wi-Fi, the phone sends its recordings here, encrypted from end to end. Mirna transcribes and summarizes them on this Mac, like any other recording.`}
      </p>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t`Paired phones`}</h3>
        {pairedPhones.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t`No phone is paired yet.`}
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {pairedPhones.map((phone) => (
              <li
                key={phone.fingerprint}
                className="flex items-center justify-between gap-4 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{phone.name}</p>
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

      <section className="flex flex-col gap-3">
        {pairing ? (
          <PairingCard
            info={pairing}
            onCancel={() => cancelPairing.mutate()}
            onExpired={() => setPairing(null)}
          />
        ) : (
          <div>
            <Button
              disabled={startPairing.isPending}
              onClick={() => startPairing.mutate()}
            >
              {pairedPhones.length === 0
                ? t`Pair a phone`
                : t`Pair another phone`}
            </Button>
          </div>
        )}
      </section>

      <section className="text-muted-foreground flex flex-col gap-1 text-xs">
        {status.data?.error ? (
          <p className="text-destructive">{status.data.error}</p>
        ) : status.data?.listening ? (
          <p>
            {t`Listening for your phone at ${status.data.addresses.join(", ") || "this Mac"}.`}
          </p>
        ) : (
          <p>{t`Not listening: no phone is paired.`}</p>
        )}
        <p>
          {t`Mirna needs to be open on this Mac to receive recordings. Nothing goes through a server.`}
        </p>
      </section>
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

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="bg-card flex max-w-md flex-col items-center gap-4 rounded-lg border p-6">
      <img
        alt={t`Pairing code`}
        className="size-60"
        src={`data:image/svg+xml;utf8,${encodeURIComponent(info.qr_svg)}`}
      />
      <div className="flex flex-col gap-1 text-center">
        <p className="text-sm font-medium">
          {t`Open Mirna on your phone and scan this code`}
        </p>
        <p className="text-muted-foreground text-xs">
          {t`It works once and expires in ${minutes}:${seconds}. Your phone must be on the same Wi-Fi as this Mac.`}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void writeText(info.uri).then(() =>
              toast.success(t`Pairing link copied. Paste it in Mirna on your phone.`),
            );
          }}
        >
          {t`Copy pairing link`}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t`Cancel`}
        </Button>
      </div>
    </div>
  );
}
