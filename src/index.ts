#!/usr/bin/env node
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { startServer } from "./server.js";
import { runOAuthFlow } from "./auth/oauth.js";
import {
  defaultTokenPath,
  loadStoredToken,
  readClientSecrets,
  saveStoredToken,
} from "./auth/tokens.js";
import { YOUTUBE_SCOPES } from "./auth/types.js";

const { values } = parseArgs({
  options: {
    auth: { type: "boolean" },
    host: { type: "string" },
    port: { type: "string" },
    "client-secret-file": { type: "string" },
    "client-id": { type: "string" },
    "client-secret": { type: "string" },
    "token-file": { type: "string" },
    "comfyui-url": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  printHelp();
  process.exit(0);
}

const tokenFile =
  values["token-file"] ?? process.env.YOUTUBE_TOKEN_FILE ?? defaultTokenPath();

const { clientId, clientSecret } = await resolveClientCredentials();

if (values.auth) {
  const token = await runOAuthFlow({
    clientId,
    clientSecret,
    scopes: YOUTUBE_SCOPES,
    openBrowser,
  });
  await saveStoredToken(tokenFile, token);
  process.stdout.write(
    `\nSaved refresh token to ${tokenFile}. You can now run without --auth.\n`,
  );
  process.exit(0);
}

const stored = await loadStoredToken(tokenFile);
if (!stored) {
  process.stderr.write(
    `Error: no stored token at ${tokenFile}.\nRun 'youtube-mcp --auth --client-secret-file <path>' first.\n`,
  );
  process.exit(1);
}

const host = values.host ?? process.env.MCP_HOST ?? "0.0.0.0";
const port = Number(values.port ?? process.env.MCP_PORT ?? "9120");
const comfyUIUrl = values["comfyui-url"] ?? process.env.COMFYUI_URL;
const comfyUIDefaultCkpt =
  process.env.COMFYUI_DEFAULT_CKPT ?? "sd_xl_base_1.0.safetensors";

await startServer({
  host,
  port,
  clientId,
  clientSecret,
  tokenFile,
  comfyUIUrl,
  comfyUIDefaultCkpt,
});

async function resolveClientCredentials(): Promise<{
  clientId: string;
  clientSecret: string;
}> {
  // Priority: explicit flags → file → env vars
  if (values["client-id"] && values["client-secret"]) {
    return {
      clientId: values["client-id"] as string,
      clientSecret: values["client-secret"] as string,
    };
  }
  const secretFile =
    values["client-secret-file"] ?? process.env.YOUTUBE_CLIENT_SECRET_FILE;
  if (secretFile) {
    const info = await readClientSecrets(secretFile);
    return { clientId: info.client_id, clientSecret: info.client_secret };
  }
  const envId = process.env.YOUTUBE_CLIENT_ID;
  const envSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret };
  }
  process.stderr.write(
    [
      "Error: OAuth client credentials not provided.",
      "Supply them via one of:",
      "  --client-secret-file <path>  (recommended — downloaded from Google Cloud)",
      "  --client-id <id> --client-secret <secret>",
      "  YOUTUBE_CLIENT_SECRET_FILE=<path>",
      "  YOUTUBE_CLIENT_ID=<id> YOUTUBE_CLIENT_SECRET=<secret>",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

function openBrowser(url: string): void {
  const cmd =
    platform() === "darwin"
      ? "open"
      : platform() === "win32"
        ? "cmd"
        : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // fall through; the URL is already printed to stdout
  }
}

function printHelp(): void {
  process.stdout.write(
    [
      "youtube-mcp — MCP server for YouTube + ComfyUI thumbnail bridge",
      "",
      "Usage:",
      "  youtube-mcp --auth --client-secret-file <path>      one-time OAuth setup",
      "  youtube-mcp [options]                                 run the MCP server",
      "",
      "Auth flags:",
      "  --auth                         Run the interactive browser OAuth flow and save the refresh token.",
      "  --client-secret-file <path>    Path to Google OAuth client JSON (downloaded from Google Cloud).",
      "  --client-id <id>               OAuth client ID (alternative to --client-secret-file).",
      "  --client-secret <secret>       OAuth client secret (alternative to --client-secret-file).",
      "  --token-file <path>            Where the refresh token is stored. Default: ~/.config/youtube-mcp/token.json",
      "                                 (env: YOUTUBE_TOKEN_FILE)",
      "",
      "Server flags:",
      "  --host <host>                  Bind host (default: 0.0.0.0, env: MCP_HOST)",
      "  --port <port>                  Bind port (default: 9120, env: MCP_PORT)",
      "  --comfyui-url <url>            ComfyUI HTTP URL for the thumbnail bridge tool.",
      "                                 When unset, generate_and_set_thumbnail is disabled. (env: COMFYUI_URL)",
      "",
      "Other env:",
      "  YOUTUBE_CLIENT_SECRET_FILE      Alternative to --client-secret-file",
      "  YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET",
      "  COMFYUI_DEFAULT_CKPT           ComfyUI checkpoint for bridge tool (default: sd_xl_base_1.0.safetensors)",
      "",
    ].join("\n"),
  );
}
