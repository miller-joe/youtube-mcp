import { createServer, type Server, type ServerResponse } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import type { StoredToken } from "./types.js";

export interface OAuthFlowParams {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  openBrowser?: (url: string) => void | Promise<void>;
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Run the OAuth 2.0 Authorization Code + PKCE flow for an installed (desktop) app.
 * Uses a loopback HTTP server on 127.0.0.1 with an OS-assigned port.
 */
export async function runOAuthFlow(params: OAuthFlowParams): Promise<StoredToken> {
  const { clientId, clientSecret, scopes } = params;
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const stateExpected = randomBytes(16).toString("hex");

  let server: Server | undefined;
  try {
    const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>(
      (resolve, reject) => {
        const s = createServer(async (req, res) => {
          try {
            const url = new URL(req.url ?? "/", "http://127.0.0.1");
            if (url.pathname !== "/callback") {
              res.writeHead(404).end();
              return;
            }
            const code = url.searchParams.get("code");
            const state = url.searchParams.get("state");
            const error = url.searchParams.get("error");
            if (error) {
              respondHtml(res, 400, `<h1>OAuth error</h1><p>${escapeHtml(error)}</p>`);
              reject(new Error(`OAuth error: ${error}`));
              return;
            }
            if (!code || state !== stateExpected) {
              respondHtml(res, 400, "<h1>Invalid OAuth callback</h1>");
              reject(new Error("Invalid OAuth callback (missing code or bad state)"));
              return;
            }
            respondHtml(
              res,
              200,
              "<h1>Authorization complete</h1><p>You can close this tab and return to your terminal.</p>",
            );
            const addr = s.address() as import("node:net").AddressInfo;
            resolve({
              code,
              redirectUri: `http://127.0.0.1:${addr.port}/callback`,
            });
          } catch (err) {
            reject(err as Error);
          }
        });
        server = s;
        s.on("error", reject);
        s.listen(0, "127.0.0.1", () => {
          const addr = s.address() as import("node:net").AddressInfo;
          const redirectUri = `http://127.0.0.1:${addr.port}/callback`;
          const authUrl = buildAuthUrl({
            clientId,
            scopes,
            redirectUri,
            state: stateExpected,
            codeChallenge,
          });
          process.stdout.write(
            `\nOpen this URL in your browser to authorize:\n\n  ${authUrl}\n\nWaiting for callback on ${redirectUri} ...\n`,
          );
          if (params.openBrowser) {
            Promise.resolve(params.openBrowser(authUrl)).catch(() => {
              /* ignore open failures; user has the URL */
            });
          }
        });
      },
    );

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`OAuth token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
    }
    const body = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
      scope: string;
    };
    if (!body.refresh_token) {
      throw new Error(
        "No refresh_token in response. This usually means Google was asked for consent you've already granted — revoke access at https://myaccount.google.com/permissions and re-run --auth to force a fresh consent.",
      );
    }
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: Date.now() + body.expires_in * 1000,
      token_type: body.token_type,
      scope: body.scope,
    };
  } finally {
    if (server) {
      await closeServer(server);
    }
  }
}

/** Exchange a refresh token for a fresh access token. */
export async function refreshAccessToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ access_token: string; expires_at: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      refresh_token: params.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Refresh token exchange failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  return {
    access_token: body.access_token,
    expires_at: Date.now() + body.expires_in * 1000,
  };
}

function buildAuthUrl(params: {
  clientId: string;
  scopes: string[];
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", params.scopes.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("access_type", "offline");
  // `select_account consent` forces Google to show the account picker first,
  // then force a fresh consent prompt. Without `select_account`, browsers
  // signed into the "wrong" Google account sometimes silently fail with a
  // misleading "response_type missing" error.
  url.searchParams.set("prompt", "select_account consent");
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(
    createHash("sha256").update(codeVerifier).digest(),
  );
  return { codeVerifier, codeChallenge };
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function respondHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>youtube-mcp</title>${html}`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Close a node http server gracefully: first force-close any lingering
 * keep-alive sockets (fixes the Windows libuv assertion on process exit
 * when the browser's HTTP session is still open), then await server close.
 */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    // Node 18.2+ has closeAllConnections; optional chain so older runtimes still compile.
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}
