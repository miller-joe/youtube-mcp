# Changelog

All notable changes to youtube-mcp are documented here.

## 0.2.0 — 2026-04-25

### Added
- `--stdio` flag (and `MCP_TRANSPORT=stdio` env var) — speak MCP over stdio instead of HTTP, for use with stdio-first MCP clients (Claude Desktop, mcp-inspector). HTTP remains the default. Sample Claude Desktop config in the README.
- Glama "Card Badge" in the README, linking to the listing.
- Repository topics (`mcp`, `youtube`, `youtube-api`, `oauth2`, `creator-tools`, ...).

### Changed
- Missing OAuth client credentials, missing/unreadable `--client-secret-file`, and missing stored token are now non-fatal warnings instead of fatal startup errors. Server starts and registers tools either way; tool calls still fail clearly at invocation time when auth is incomplete. Lets the server work with stdio-first clients (Claude Desktop, mcp-inspector) that may not have credentials at startup.

### Improved
- All tool descriptions polished. Targets glama.ai's per-tool quality rubric.

## 0.1.x — initial releases

OAuth 2.0 + PKCE auth flow, video / playlist / comment / caption / analytics / shorts tools, plus a ComfyUI bridge for AI thumbnail generation (`generate_and_set_thumbnail`).
