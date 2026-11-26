import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useMemo, useRef, useState } from "react";

import type { EventParticipant } from "@anlg/store";
import { MagnifyingGlass, Plus } from "@anlg/ui/components/icons";
import { Checkbox } from "@anlg/ui/components/ui/checkbox";
import {
  AppFloatingPanel,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@anlg/ui/components/ui/popover";
import { toast } from "@anlg/ui/components/ui/toast";
import { cn } from "@anlg/utils";

import { preserveScrollPosition } from "./viewport-hooks";

import { trackAnalyticsEvent } from "~/analytics";
import { useSessionEventParticipants } from "~/calendar/queries";
import { ContactImage } from "~/contacts/contact-avatar";
import { createHuman, updateHuman, useHumans } from "~/contacts/queries";
import { ContactFacehash } from "~/contacts/shared";
import {
  hasRememberedVoice,
  rememberSpeakerVoice,
} from "~/services/voiceprint";
import {
  addSessionParticipant,
  useSession,
  useSessionParticipants,
} from "~/session/queries";
import { useConfigValue } from "~/shared/config";
import { useOwnerUserId } from "~/shared/owner-user";
import type { Segment } from "~/stt/live-segment";
import {
  assignSessionTranscriptSpeaker,
  assignTranscriptSpeaker,
  type NamedSpeakerVoice,
} from "~/stt/queries";

export type AssignmentMode = "all" | "segment";

export function SpeakerAssignPopover({
  segment,
  transcriptId,
  sessionId,
  color,
  label,
  className,
  onAssigned,
}: {
  segment: Segment;
  transcriptId: string;
  sessionId?: string;
  color: string;
  label: string;
  className?: string;
  onAssigned?: (humanId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const handleNamedVoice = useRememberNamedVoice(sessionId);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
  }, []);

  const handleAssign = useCallback(
    (humanId: string, assignmentMode: AssignmentMode, name: string) => {
      if (segment.words.length === 0) return;
      const anchorWordId = getAssignmentAnchorWordId(segment);
      if (!anchorWordId) return;
      const scrollContainer =
        triggerRef.current?.closest<HTMLElement>(
          "[data-transcript-container]",
        ) ?? null;
      const assign = () =>
        assignmentMode === "all" && sessionId
          ? assignSessionTranscriptSpeaker({
              sessionId,
              transcriptId,
              segmentKey: segment.key,
              humanId,
              anchorWordId,
              wordIds: getAssignmentWordIds(segment),
            })
          : assignTranscriptSpeaker({
              transcriptId,
              segmentKey: segment.key,
              humanId,
              anchorWordId,
              mode: assignmentMode,
              wordIds: getAssignmentWordIds(segment),
            });
      void preserveScrollPosition(scrollContainer, assign)
        .then((voice) => {
          trackAnalyticsEvent("participant_assigned", {
            assignment_scope: assignmentMode,
            word_count: segment.words.length,
          });
          onAssigned?.(humanId);
          handleOpenChange(false);
          handleNamedVoice(voice, name);
        })
        .catch((error) => {
          console.error("[transcript] failed to assign speaker", error);
        });
    },
    [
      handleNamedVoice,
      handleOpenChange,
      onAssigned,
      sessionId,
      transcriptId,
      segment,
    ],
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          data-transcript-speaker-assign
          className={cn([
            "-my-0.5 cursor-pointer rounded-full py-0.5 pr-2",
            "underline-offset-2 hover:underline focus-visible:underline",
            open ? "underline" : null,
            className,
          ])}
          style={{ color }}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        variant="app"
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className="w-80"
      >
        <SpeakerParticipantPicker
          sessionId={sessionId}
          onSelect={handleAssign}
          showAssignmentScope={Number.isInteger(segment.key.speaker_index)}
        />
      </PopoverContent>
    </Popover>
  );
}

// Naming a speaker never keeps their voice on its own. With "Remember speakers"
// on, or once the user agreed for this person, the voice is kept silently;
// otherwise Mirna asks first, since a voiceprint identifies someone.
function useRememberNamedVoice(sessionId: string | undefined) {
  const { t } = useLingui();
  const rememberSpeakers = useConfigValue("remember_speakers") === true;
  const ownerUserId = useOwnerUserId();

  return useCallback(
    (voice: NamedSpeakerVoice | null | void, name: string) => {
      if (!voice || !sessionId) return;
      const isSelf = voice.humanId === ownerUserId;
      const displayName = name.trim();

      const remember = async (announce: boolean) => {
        const stored = await rememberSpeakerVoice(sessionId, voice);
        if (!announce) return;
        if (stored) {
          toast.success(
            isSelf
              ? t`Mirna will recognize you in future meetings.`
              : t`Mirna will recognize ${displayName} in future meetings.`,
          );
        } else {
          toast.info(
            t`There wasn't enough clear speech to remember this voice.`,
          );
        }
      };

      void (async () => {
        if (rememberSpeakers || (await hasRememberedVoice(voice.humanId))) {
          await remember(false);
          return;
        }
        const toastId = `remember-voice-${voice.transcriptId}-${voice.humanId}`;
        toast(
          isSelf
            ? t`Remember your voice?`
            : t`Remember ${displayName}'s voice?`,
          {
            id: toastId,
            description: isSelf
              ? t`Mirna can recognize you in future meetings. Your voiceprint stays on this device.`
              : t`Mirna can recognize ${displayName} in future meetings. The voiceprint stays on this device. Only do this if ${displayName} is happy with it.`,
            duration: 30_000,
            closeButton: true,
            action: {
              label: t`Remember`,
              onClick: () => {
                toast.dismiss(toastId);
                void remember(true);
              },
            },
            secondaryAction: {
              label: t`Not now`,
              onClick: () => toast.dismiss(toastId),
            },
          },
        );
      })().catch((error) => {
        console.error("[voiceprint] remember prompt failed", error);
      });
    },
    [ownerUserId, rememberSpeakers, sessionId, t],
  );
}

export function getAssignmentAnchorWordId(
  segment: Segment,
): string | undefined {
  const word = segment.words.find(
    (word) => typeof word.id === "string" && word.id.length > 0,
  );
  return typeof word?.id === "string" ? word.id : undefined;
}

export function getAssignmentWordIds(segment: Segment): string[] {
  return segment.words
    .map((word) => word.id)
    .filter(
      (wordId): wordId is string =>
        typeof wordId === "string" && wordId.length > 0,
    );
}

export type SpeakerParticipantOption = {
  id: string;
  name: string;
  email?: string;
  additionalEmails?: string[];
  avatarDataUrl?: string;
  isSessionParticipant: boolean;
  isNew?: boolean;
  isCreateOption?: boolean;
  /** The person using Mirna. */
  isSelf?: boolean;
  /** Typed while you have no name yet: saves it as your name. */
  claimsName?: boolean;
};

/**
 * "You" at the top of the picker, and, while you have no name yet, an option
 * to take a typed name as yours instead of creating someone new.
 */
export function buildSelfSpeakerOptions({
  selfId,
  selfName,
  query,
  youLabel,
  youWithNameLabel,
}: {
  selfId: string | null;
  selfName: string;
  query: string;
  youLabel: string;
  youWithNameLabel: (name: string) => string;
}): SpeakerParticipantOption[] {
  if (!selfId) return [];
  const typed = query.trim();
  const normalized = typed.toLowerCase();
  const name = selfName.trim();
  const you: SpeakerParticipantOption = {
    id: selfId,
    name: name ? youWithNameLabel(name) : youLabel,
    isSessionParticipant: true,
    isSelf: true,
  };
  const matchesYou =
    !normalized ||
    ["you", "me", "myself", youLabel.toLowerCase()].some((word) =>
      word.startsWith(normalized),
    ) ||
    (name && name.toLowerCase().includes(normalized));
  const options = matchesYou ? [you] : [];
  if (!name && typed) {
    options.push({
      id: selfId,
      name: typed,
      isSessionParticipant: true,
      isSelf: true,
      claimsName: true,
    });
  }
  return options;
}

export function buildSpeakerParticipantGroups({
  sessionParticipants,
  eventParticipants = [],
  contacts,
  query,
}: {
  sessionParticipants: SpeakerParticipantOption[];
  eventParticipants?: SpeakerParticipantOption[];
  contacts: SpeakerParticipantOption[];
  query: string;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (option: SpeakerParticipantOption) => {
    if (!normalizedQuery) {
      return true;
    }

    return [
      option.name,
      option.email ?? "",
      ...(option.additionalEmails ?? []),
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  };

  const participantKeys = new Set<string>();
  const participantOptions = [...sessionParticipants, ...eventParticipants]
    .filter((option) => {
      const keys = getSpeakerParticipantDedupeKeys(option);
      if (keys.some((key) => participantKeys.has(key))) {
        return false;
      }

      keys.forEach((key) => participantKeys.add(key));
      return true;
    })
    .filter(matches);
  const matchingContacts = contacts
    .filter((option) =>
      getSpeakerParticipantDedupeKeys(option).every(
        (key) => !participantKeys.has(key),
      ),
    )
    .filter(matches);

  return [
    ...(participantOptions.length > 0
      ? [
          {
            title: "Participants",
            options: participantOptions,
          },
        ]
      : []),
    ...(matchingContacts.length > 0
      ? [
          {
            title: "People",
            options: matchingContacts,
          },
        ]
      : []),
  ];
}

export function buildCreateSpeakerParticipantOption({
  query,
  existingOptions,
}: {
  query: string;
  existingOptions: SpeakerParticipantOption[];
}): SpeakerParticipantOption | null {
  const name = query.trim();
  if (!name) {
    return null;
  }

  const normalizedName = name.toLowerCase();
  const alreadyExists = existingOptions.some((option) =>
    [option.name, option.email ?? "", ...(option.additionalEmails ?? [])].some(
      (value) => value.toLowerCase() === normalizedName,
    ),
  );
  if (alreadyExists) {
    return null;
  }

  return {
    id: "new",
    name,
    isSessionParticipant: false,
    isNew: true,
    isCreateOption: true,
  };
}

export function buildEventSpeakerParticipantOptions({
  eventParticipants,
  contacts,
}: {
  eventParticipants: EventParticipant[];
  contacts: SpeakerParticipantOption[];
}): SpeakerParticipantOption[] {
  const contactByEmail = new Map(
    contacts.flatMap((contact) =>
      [contact.email, ...(contact.additionalEmails ?? [])]
        .filter((email): email is string => Boolean(email))
        .map((email) => [email.toLowerCase(), contact] as const),
    ),
  );
  const contactByName = new Map(
    contacts.map((contact) => [contact.name.toLowerCase(), contact]),
  );

  return eventParticipants
    .map((participant, index): SpeakerParticipantOption | null => {
      const name = (participant.name ?? "").trim();
      const email = (participant.email ?? "").trim();
      if (!name && !email) {
        return null;
      }

      const contact = email
        ? contactByEmail.get(email.toLowerCase())
        : name
          ? contactByName.get(name.toLowerCase())
          : undefined;

      if (contact) {
        return {
          ...contact,
          name: name || contact.name,
          email: email || contact.email,
          isSessionParticipant: true,
        };
      }

      const pendingId = email ? `event:${email}` : `event:${name}:${index}`;

      return {
        id: pendingId,
        name: name || email,
        email: email || undefined,
        isSessionParticipant: true,
        isNew: true,
      };
    })
    .filter((option): option is SpeakerParticipantOption => option !== null);
}

export function SpeakerParticipantPicker({
  sessionId,
  onSelect,
  showAssignmentScope = true,
}: {
  sessionId: string | undefined;
  onSelect: (
    humanId: string,
    mode: AssignmentMode,
    name: string,
  ) => void | Promise<void>;
  showAssignmentScope?: boolean;
}) {
  const { t } = useLingui();
  const session = useSession(sessionId ?? "");
  const participantRecords = useSessionParticipants(sessionId ?? "");
  const humanRecords = useHumans();
  const attachedEventParticipants = useSessionEventParticipants(
    sessionId ?? "",
  );

  const selfId = useOwnerUserId();
  const selfName =
    humanRecords.find((human) => human.id === selfId)?.name.trim() ?? "";
  const [query, setQuery] = useState("");
  const [selectedOption, setSelectedOption] =
    useState<SpeakerParticipantOption | null>(null);
  const [applyToAllMatching, setApplyToAllMatching] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const avatarByHumanId = useMemo(
    () =>
      new Map(
        humanRecords.map((human) => [human.id, human.avatarDataUrl] as const),
      ),
    [humanRecords],
  );
  const participants = useMemo(
    () =>
      participantRecords
        .map((participant): SpeakerParticipantOption | null => {
          if (!participant.humanId) return null;
          const name = participant.name.trim();
          const email = participant.email.trim();
          return {
            id: participant.humanId,
            name: name || email || t`Unknown`,
            email: email || undefined,
            avatarDataUrl:
              avatarByHumanId.get(participant.humanId) ?? undefined,
            isSessionParticipant: true,
          };
        })
        .filter((participant): participant is SpeakerParticipantOption =>
          Boolean(participant),
        ),
    [avatarByHumanId, participantRecords, t],
  );

  const contacts = useMemo(
    () =>
      humanRecords
        .map((human): SpeakerParticipantOption | null => {
          const name = human.name.trim();
          const email = human.email.trim();
          if (!name && !email) return null;

          return {
            id: human.id,
            name: name || email,
            email: email || undefined,
            additionalEmails: human.additionalEmails,
            avatarDataUrl: human.avatarDataUrl ?? undefined,
            isSessionParticipant: false,
          };
        })
        .filter((contact): contact is SpeakerParticipantOption =>
          Boolean(contact),
        ),
    [humanRecords],
  );

  const eventParticipants = useMemo(
    () =>
      buildEventSpeakerParticipantOptions({
        eventParticipants: attachedEventParticipants,
        contacts,
      }),
    [attachedEventParticipants, contacts],
  );

  const participantIds = useMemo(
    () => new Set(participants.map((participant) => participant.id)),
    [participants],
  );

  const selfOptions = useMemo(
    () =>
      buildSelfSpeakerOptions({
        selfId,
        selfName,
        query,
        youLabel: t`You`,
        youWithNameLabel: (name) => t`${name} (you)`,
      }),
    [query, selfId, selfName, t],
  );

  const groups = useMemo(
    () =>
      buildSpeakerParticipantGroups({
        sessionParticipants: participants.filter(
          (option) => option.id !== selfId,
        ),
        eventParticipants,
        contacts: contacts.filter((option) => option.id !== selfId),
        query,
      }),
    [contacts, eventParticipants, participants, query, selfId],
  );

  const createOption = useMemo(
    () =>
      buildCreateSpeakerParticipantOption({
        query,
        existingOptions: [
          ...participants,
          ...eventParticipants,
          ...contacts,
          ...(selfName && selfId
            ? [{ id: selfId, name: selfName, isSessionParticipant: true }]
            : []),
        ],
      }),
    [contacts, eventParticipants, participants, query, selfId, selfName],
  );
  const hasPeopleGroup = groups.some((group) => group.title === "People");

  const linkHumanToSession = useCallback(
    async (humanId: string) => {
      if (!sessionId || participantIds.has(humanId)) {
        return;
      }

      await addSessionParticipant(sessionId, humanId);
    },
    [participantIds, sessionId],
  );

  const handleSelect = useCallback((option: SpeakerParticipantOption) => {
    setSelectedOption(option);
  }, []);

  const getCurrentHumanId = useCallback(
    async (option: SpeakerParticipantOption) => {
      if (option.claimsName) {
        await updateHuman(option.id, { name: option.name.trim() });
        return option.id;
      }
      if (!option.isNew) {
        return option.id;
      }

      const email = option.email?.trim().toLowerCase();
      const name = option.name.trim().toLowerCase();
      const existingContact = email
        ? contacts.find((contact) =>
            [contact.email, ...(contact.additionalEmails ?? [])].some(
              (value) => value?.trim().toLowerCase() === email,
            ),
          )
        : contacts.find(
            (contact) => contact.name.trim().toLowerCase() === name,
          );

      if (existingContact) return existingContact.id;
      if (!session?.user_id) return null;

      return createHuman({
        ownerUserId: session.user_id,
        name: option.name,
        email: option.email,
        entryPoint: "speaker_assignment",
      });
    },
    [contacts, session?.user_id],
  );

  const handleConfirm = useCallback(() => {
    if (!selectedOption) {
      return;
    }

    setAssigning(true);
    void getCurrentHumanId(selectedOption)
      .then(async (humanId) => {
        if (!humanId) return;
        await linkHumanToSession(humanId);
        await onSelect(
          humanId,
          showAssignmentScope && applyToAllMatching ? "all" : "segment",
          selectedOption.name,
        );
      })
      .catch((error) => {
        console.error("[transcript] failed to prepare speaker", error);
      })
      .finally(() => setAssigning(false));
  }, [
    applyToAllMatching,
    getCurrentHumanId,
    linkHumanToSession,
    onSelect,
    selectedOption,
    showAssignmentScope,
  ]);

  return (
    <div className="flex max-h-[min(var(--radix-popover-content-available-height,calc(100vh-1rem)),28rem)] min-h-0 flex-col gap-1 overflow-hidden">
      <AppFloatingPanel className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="border-border border-b py-1">
          <div className="flex h-8 items-center gap-2 px-3">
            <MagnifyingGlass
              size={16}
              className="text-muted-foreground shrink-0"
            />
            <input
              ref={searchInputRef}
              autoFocus
              type="search"
              className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-hidden"
              placeholder={t`Select or type to add speaker`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedOption(null);
              }}
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="py-1 pb-3">
            {selfOptions.length > 0 && (
              <div>
                {selfOptions.map((option) => (
                  <ParticipantOptionButton
                    key={option.claimsName ? "claim" : "you"}
                    option={option}
                    selected={selectedOption === option}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            )}
            {groups.map((group) => (
              <div key={group.title}>
                <div className="text-muted-foreground px-3 pt-2 pb-1 text-[11px] font-medium uppercase">
                  {group.title === "Participants" ? (
                    <Trans>Participants</Trans>
                  ) : (
                    <Trans>People</Trans>
                  )}
                </div>
                {group.options.map((option) => (
                  <ParticipantOptionButton
                    key={option.id}
                    option={option}
                    selected={selectedOption === option}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            ))}

            {createOption && (
              <div>
                {!hasPeopleGroup && (
                  <div className="text-muted-foreground px-3 pt-2 pb-1 text-[11px] font-medium uppercase">
                    <Trans>People</Trans>
                  </div>
                )}
                <ParticipantOptionButton
                  option={createOption}
                  selected={selectedOption === createOption}
                  onSelect={handleSelect}
                />
              </div>
            )}

            {!createOption &&
              groups.length === 0 &&
              selfOptions.length === 0 && (
                <p className="text-muted-foreground px-3 py-2 text-xs">
                  {query.trim() ? (
                    <Trans>No matching people</Trans>
                  ) : (
                    <Trans>No people</Trans>
                  )}
                </p>
              )}

            {!query.trim() && (
              <button
                type="button"
                className="hover:bg-accent flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm"
                onClick={() => searchInputRef.current?.focus()}
              >
                <Plus className="size-4" />
                <Trans>Create new speaker</Trans>
              </button>
            )}
          </div>
        </div>
      </AppFloatingPanel>
      <div className="flex shrink-0 items-center justify-end gap-3 py-1 pl-2">
        {showAssignmentScope && (
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
            <Checkbox
              checked={applyToAllMatching}
              onCheckedChange={(value) => setApplyToAllMatching(value === true)}
            />
            <span className="text-muted-foreground text-sm whitespace-nowrap">
              <Trans>Apply to all</Trans>
            </span>
          </label>
        )}
        <button
          type="button"
          className={cn([
            "bg-primary text-primary-foreground h-8 rounded-full px-3 text-xs font-medium",
            "hover:bg-primary/90",
            "disabled:pointer-events-none disabled:opacity-50",
          ])}
          disabled={!selectedOption || assigning}
          onClick={handleConfirm}
        >
          <Trans>Confirm</Trans>
        </button>
      </div>
    </div>
  );
}

function getSpeakerParticipantDedupeKeys(
  option: SpeakerParticipantOption,
): string[] {
  return [
    `id:${option.id}`,
    option.email ? `email:${option.email.toLowerCase()}` : null,
  ].filter((key): key is string => key !== null);
}

function ParticipantOptionButton({
  option,
  selected,
  onSelect,
}: {
  option: SpeakerParticipantOption;
  selected: boolean;
  onSelect: (option: SpeakerParticipantOption) => void;
}) {
  const { t } = useLingui();
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn([
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent",
      ])}
      onClick={() => onSelect(option)}
    >
      {option.isCreateOption ? (
        <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full border">
          <Plus className="size-3.5" aria-hidden="true" />
        </span>
      ) : option.avatarDataUrl ? (
        <ContactImage src={option.avatarDataUrl} size={28} />
      ) : (
        <ContactFacehash
          name={option.name || option.email || option.id}
          size={28}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {option.isCreateOption
            ? t`Add "${option.name}"`
            : option.claimsName
              ? t`"${option.name}" is me`
              : option.name}
        </span>
        {option.claimsName && (
          <span className="text-muted-foreground block truncate text-xs">
            {t`Saved as your name`}
          </span>
        )}
        {option.email && (
          <span className="text-muted-foreground block truncate text-xs">
            {option.email}
          </span>
        )}
      </span>
    </button>
  );
}
