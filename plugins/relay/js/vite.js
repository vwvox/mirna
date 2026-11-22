import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const shimPath = resolve(__dirname, "shim.js");
const defaultRelayPort = 1423;

// Tauri's names for Node's: the dev server runs on the same machine as the app.
const TAURI_ARCH = { arm64: "aarch64", x64: "x86_64", ia32: "x86", arm: "arm" };

function getRelayArch() {
  return TAURI_ARCH[process.arch] ?? process.arch;
}

function getRelayPort() {
  const value = Number.parseInt(process.env.RELAY_PORT || "", 10);
  return Number.isInteger(value) && value > 0 ? value : defaultRelayPort;
}

/** @returns {import('vite').Plugin} */
export function relayShim() {
  return {
    name: "relay-shim",
    configureServer(server) {
      server.middlewares.use("/relay-shim.js", (_req, res) => {
        const content = readFileSync(shimPath, "utf-8")
          .replaceAll("__RELAY_PORT__", String(getRelayPort()))
          .replaceAll("__RELAY_ARCH__", getRelayArch());
        res.setHeader("Content-Type", "application/javascript");
        res.end(content);
      });
    },
    transformIndexHtml(html, ctx) {
      if (!ctx.server) {
        return html.replace(
          /<script\s+src="\/relay-shim\.js"><\/script>\s*/,
          "",
        );
      }
    },
  };
}
