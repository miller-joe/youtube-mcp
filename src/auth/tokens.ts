import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type {
  GoogleClientSecrets,
  GoogleClientInfo,
  StoredToken,
} from "./types.js";

export function defaultTokenPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg || join(homedir(), ".config");
  return join(base, "youtube-mcp", "token.json");
}

export async function readClientSecrets(
  filePath: string,
): Promise<GoogleClientInfo> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as GoogleClientSecrets;
  const info = parsed.installed ?? parsed.web;
  if (!info) {
    throw new Error(
      `Client secrets JSON is missing "installed" or "web" top-level key (from ${filePath})`,
    );
  }
  if (!info.client_id || !info.client_secret) {
    throw new Error("client_id or client_secret missing from credentials JSON");
  }
  return info;
}

export async function loadStoredToken(
  filePath: string,
): Promise<StoredToken | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as StoredToken;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function saveStoredToken(
  filePath: string,
  token: StoredToken,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(token, null, 2), { mode: 0o600 });
}
