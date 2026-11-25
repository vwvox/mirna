import { readdirSync, readFileSync, watch } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";

// Mirna's release notes, one Markdown file per version, bundled into the app
// so the What's new page never fetches anything.
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const releasesDir = resolve(
  __dirname,
  "../../../packages/changelog/content/mirna",
);

const VIRTUAL_ID = "virtual:changelog";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const RELEASE_FILE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\.md$/;

function readReleases(): { version: string; raw: string }[] {
  try {
    return readdirSync(releasesDir)
      .filter((file) => RELEASE_FILE.test(file))
      .map((file) => ({
        version: file.slice(0, -".md".length),
        raw: readFileSync(resolve(releasesDir, file), "utf-8"),
      }));
  } catch {
    return [];
  }
}

function buildModule(): string {
  return `export const releases = ${JSON.stringify(readReleases())};`;
}

export function changelog(): Plugin {
  return {
    name: "changelog",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id === RESOLVED_ID) return buildModule();
    },
    configureServer(server: ViteDevServer) {
      if (process.env.NODE_ENV === "test" || process.env.VITEST) {
        return;
      }

      try {
        watch(releasesDir, () => {
          const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
          if (mod) {
            server.moduleGraph.invalidateModule(mod);
            server.ws.send({ type: "full-reload" });
          }
        });
      } catch {}
    },
  };
}
