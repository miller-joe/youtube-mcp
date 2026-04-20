import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultTokenPath } from "../src/auth/tokens.js";
import { YOUTUBE_SCOPES } from "../src/auth/types.js";

test("defaultTokenPath: uses ~/.config/youtube-mcp/token.json by default", () => {
  const originalXdg = process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_CONFIG_HOME;
  const p = defaultTokenPath();
  assert.match(p, /\.config[\\/]youtube-mcp[\\/]token\.json$/);
  if (originalXdg !== undefined) process.env.XDG_CONFIG_HOME = originalXdg;
});

test("defaultTokenPath: honours XDG_CONFIG_HOME when set", () => {
  const originalXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/tmp/xdg-test";
  const p = defaultTokenPath();
  assert.equal(p, "/tmp/xdg-test/youtube-mcp/token.json");
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
});

test("YOUTUBE_SCOPES contains the three required scopes", () => {
  assert.ok(YOUTUBE_SCOPES.some((s) => s.endsWith("/youtube.upload")));
  assert.ok(YOUTUBE_SCOPES.some((s) => s.endsWith("/youtube.force-ssl")));
  assert.ok(YOUTUBE_SCOPES.some((s) => s.endsWith("/yt-analytics.readonly")));
  assert.equal(YOUTUBE_SCOPES.length, 3);
});
