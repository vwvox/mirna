import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { downloadDir, join } from "@tauri-apps/api/path";

import { commands as openerCommands } from "@anlg/plugin-opener2";
import { commands as phoneLinkCommands } from "@anlg/plugin-phone-link";
import { Button } from "@anlg/ui/components/ui/button";
import { toast } from "@anlg/ui/components/ui/toast";

import { SettingRow } from "~/settings/setting-row";

export function logExportFilename(now: Date): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `mirna-logs-${stamp}.txt`;
}

/**
 * Saves this Mac's log and the logs paired phones sent into one text file in
 * Downloads, for someone helping with a problem.
 */
export async function exportLogsToDownloads(now = new Date()): Promise<string> {
  const path = await join(await downloadDir(), logExportFilename(now));
  const result = await phoneLinkCommands.exportLogs(path);
  if (result.status === "error") throw new Error(result.error);
  return result.data;
}

export function LogsSettingsView() {
  const { t } = useLingui();
  const exportLogs = useMutation({
    mutationFn: () => exportLogsToDownloads(),
    onSuccess: (path) => {
      void openerCommands.revealItemInDir(path);
      toast.success(t`Logs saved to Downloads`, {
        description: t`Send that file to whoever is helping you.`,
      });
    },
    onError: (error) => {
      toast.error(t`Couldn't export the logs`, {
        description: error.message,
      });
    },
  });

  return (
    <div>
      <h2 className="mb-4 font-sans text-lg font-semibold">
        <Trans>Help</Trans>
      </h2>
      <SettingRow
        title={t`Export logs`}
        description={t`One file with what Mirna did and any errors, from this Mac and your paired phones. It doesn't include your notes, transcripts or recordings.`}
        controlWidth="content"
      >
        {(labelProps) => (
          <Button
            variant="outline"
            size="sm"
            disabled={exportLogs.isPending}
            onClick={() => exportLogs.mutate()}
            {...labelProps}
          >
            {exportLogs.isPending ? t`Exporting…` : t`Export logs`}
          </Button>
        )}
      </SettingRow>
    </div>
  );
}
