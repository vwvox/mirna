// The phone's problem log: what Mirna did and what went wrong, kept in a small
// file on the phone. It is sent to the paired Mac with each sync and can be
// shared from Settings › About. It never holds titles, notes, transcripts or
// audio, and nothing here talks to the network.
import Constants from "expo-constants";
import * as Device from "expo-device";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import {
  DIAGNOSTICS_KEEP_LINES,
  DIAGNOSTICS_MAX_BYTES,
  type DiagnosticDetail,
  type DiagnosticLevel,
  diagnosticLine,
  errorDetail,
  exportText,
  keepRecentLines,
} from "./diagnostics-model";

export type { DiagnosticDetail, DiagnosticLevel } from "./diagnostics-model";

const listeners = new Set<() => void>();
let version = 0;

function logFile(): File {
  const directory = new Directory(Paths.document, "diagnostics");
  directory.create({ intermediates: true, idempotent: true });
  return new File(directory, "mirna-phone.log");
}

function trimIfLarge(file: File) {
  if ((file.size ?? 0) <= DIAGNOSTICS_MAX_BYTES) return;
  file.write(keepRecentLines(file.textSync(), DIAGNOSTICS_KEEP_LINES));
}

/**
 * Adds a line to the log. Never throws: a log that can't be written must not
 * break what it describes.
 */
export function logDiagnostic(
  event: string,
  detail?: DiagnosticDetail,
  level: DiagnosticLevel = "info",
) {
  try {
    const file = logFile();
    if (!file.exists) file.create();
    file.write(diagnosticLine(event, level, detail, new Date()), {
      append: true,
    });
    trimIfLarge(file);
    version += 1;
    for (const listener of listeners) listener();
  } catch {
    // Nowhere left to report it.
  }
}

/** Logs a failure with its error message and code. */
export function logDiagnosticError(
  event: string,
  error: unknown,
  detail?: DiagnosticDetail,
  level: DiagnosticLevel = "error",
) {
  logDiagnostic(event, { ...detail, ...errorDetail(error) }, level);
}

/** Where the log is kept, for sending it to the Mac. */
export function diagnosticsFileUri(): string {
  return logFile().uri;
}

export function readDiagnostics(): string {
  try {
    const file = logFile();
    return file.exists ? file.textSync() : "";
  } catch {
    return "";
  }
}

/** Changes whenever a line is added, for screens that show the log. */
export function diagnosticsVersion() {
  return version;
}

export function subscribeDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function diagnosticsHeader(): Record<string, string> {
  return {
    app: "Mirna for Android",
    version: Constants.expoConfig?.version ?? "unknown",
    device: [Device.manufacturer, Device.modelName].filter(Boolean).join(" "),
    system: `${Platform.OS} ${Device.osVersion ?? String(Platform.Version)}`,
    exported: new Date().toISOString(),
  };
}

/** Writes the log, with a header saying where it came from, to share. */
export async function shareDiagnostics(): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is not available on this phone.");
  }
  const directory = new Directory(Paths.cache, "diagnostics-export");
  directory.create({ intermediates: true, idempotent: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const file = new File(directory, `mirna-phone-log-${stamp}.txt`);
  if (file.exists) file.delete();
  file.create();
  file.write(
    exportText({ header: diagnosticsHeader(), log: readDiagnostics() }),
  );
  logDiagnostic("log_exported");
  await Sharing.shareAsync(file.uri, {
    dialogTitle: "Share Mirna's log",
    mimeType: "text/plain",
  });
}
