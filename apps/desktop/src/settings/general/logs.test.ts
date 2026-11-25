import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportLogs: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  downloadDir: async () => "/Users/test/Downloads",
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@anlg/plugin-phone-link", () => ({
  commands: { exportLogs: mocks.exportLogs },
}));
vi.mock("@anlg/plugin-opener2", () => ({
  commands: { revealItemInDir: vi.fn() },
}));

import { exportLogsToDownloads, logExportFilename } from "./logs";

describe("exporting logs", () => {
  beforeEach(() => mocks.exportLogs.mockReset());

  it("names the file after the minute it was made", () => {
    expect(logExportFilename(new Date("2026-11-25T09:41:07Z"))).toBe(
      "mirna-logs-2026-11-25-09-41.txt",
    );
  });

  it("writes one file to Downloads", async () => {
    mocks.exportLogs.mockResolvedValue({
      status: "ok",
      data: "/Users/test/Downloads/mirna-logs-2026-11-25-09-41.txt",
    });
    await expect(
      exportLogsToDownloads(new Date("2026-11-25T09:41:07Z")),
    ).resolves.toBe("/Users/test/Downloads/mirna-logs-2026-11-25-09-41.txt");
    expect(mocks.exportLogs).toHaveBeenCalledWith(
      "/Users/test/Downloads/mirna-logs-2026-11-25-09-41.txt",
    );
  });

  it("passes the Mac's error on", async () => {
    mocks.exportLogs.mockResolvedValue({
      status: "error",
      error: "Couldn't write the logs: disk full",
    });
    await expect(exportLogsToDownloads()).rejects.toThrow("disk full");
  });
});
