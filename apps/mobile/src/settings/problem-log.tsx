import { useMutation } from "@tanstack/react-query";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Alert } from "react-native";

import {
  diagnosticsVersion,
  readDiagnostics,
  shareDiagnostics,
  subscribeDiagnostics,
} from "@/lib/diagnostics";
import { describeEntry, parseDiagnostics } from "@/lib/diagnostics-model";
import { SettingsRow } from "@/settings/components";
import { FieldGroup } from "@/settings/field-group";
import { Button, Text } from "@/settings/fields";

const SHOWN_ENTRIES = 60;

/**
 * The phone's problem log: share it as a file with whoever is helping, or
 * look at the latest lines here.
 */
export function ProblemLog() {
  const [open, setOpen] = useState(false);
  const version = useSyncExternalStore(
    subscribeDiagnostics,
    diagnosticsVersion,
    diagnosticsVersion,
  );
  // `version` changes whenever a line is added, so the list stays current.
  const entries = useMemo(
    () =>
      open && version >= 0
        ? parseDiagnostics(readDiagnostics()).slice(-SHOWN_ENTRIES).reverse()
        : [],
    [open, version],
  );
  const share = useMutation({
    mutationFn: shareDiagnostics,
    onError: (error) =>
      Alert.alert(
        "Couldn’t export the log",
        error instanceof Error ? error.message : String(error),
      ),
  });

  return (
    <FieldGroup.Section title="Logs">
      <Button
        label={share.isPending ? "Exporting…" : "Export log"}
        onPress={() => {
          if (!share.isPending) share.mutate();
        }}
      />
      <Button
        label={open ? "Hide recent log" : "View recent log"}
        onPress={() => setOpen((value) => !value)}
      />
      <FieldGroup.SectionFooter>
        <Text>
          What Mirna did on this phone and any errors, to send to whoever is
          helping you. It doesn’t include your notes, transcripts or recordings.
          Your Mac gets a copy when they sync, and Mirna on the Mac can export
          both in Settings › General.
        </Text>
      </FieldGroup.SectionFooter>
      {open &&
        (entries.length === 0 ? (
          <Text>Nothing logged yet.</Text>
        ) : (
          entries.map((entry, index) => (
            <SettingsRow
              key={`${entry.at}-${index}`}
              title={new Date(entry.at).toLocaleString()}
              description={describeEntry(entry)}
            />
          ))
        ))}
    </FieldGroup.Section>
  );
}
