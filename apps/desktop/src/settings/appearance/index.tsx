import { Trans } from "@lingui/react/macro";

import { AppIconSelector } from "./app-icon";
import { SidebarItemFieldsSettings } from "./sidebar-item-fields";
import { ThemeSelector } from "./theme";
import { TimeFormatSettings } from "./time-format";

import { SettingsPageTitle } from "~/settings/page-title";
import { APP_ICON_CHOICE_ENABLED } from "~/shared/theme/icon";

export function SettingsAppearance() {
  return (
    <div className="flex max-w-5xl flex-col gap-10">
      <SettingsPageTitle title={<Trans>Appearance</Trans>} />
      <ThemeSelector />
      <TimeFormatSettings />
      {APP_ICON_CHOICE_ENABLED ? <AppIconSelector /> : null}
      <SidebarItemFieldsSettings />
    </div>
  );
}
