# youtube-mcp

OAuth-authenticated YouTube MCP for channel owners. Edit video metadata, reply to and moderate comments, manage playlists, query channel analytics, and generate or set AI thumbnails via a ComfyUI bridge. Goes beyond the read-only Data API v3 wrappers that dominate this space.

[![youtube-mcp MCP server](https://glama.ai/mcp/servers/miller-joe/youtube-mcp/badges/card.svg)](https://glama.ai/mcp/servers/miller-joe/youtube-mcp)

[![GitHub Sponsors](https://img.shields.io/github/sponsors/miller-joe?style=social&logo=github)](https://github.com/sponsors/miller-joe)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=kofi&logoColor=white)](https://ko-fi.com/indivisionjoe)

## The pitch

Most existing YouTube MCPs use an API key against Data API v3. Search videos, fetch public metadata, read-only. This one uses OAuth 2.0 (Authorization Code + PKCE) so it can actually write to your channel: update video titles, descriptions and tags, reply to comments, moderate spam, manage playlists. It also hits the separate YouTube Analytics API for channel stats, and generates a thumbnail via ComfyUI and pushes it to YouTube in a single MCP call.

```
Claude, use generate_and_set_thumbnail on video abc123:
  prompt: "cyberpunk hacker at keyboard, neon blue and pink, high contrast"
```

ComfyUI renders 1280×720, youtube-mcp fetches the bytes, and POSTs to `thumbnails.set`. Done.

## Install

```bash
# npx, no install
npx @miller-joe/youtube-mcp --help

# Docker
docker run -p 9120:9120 \
  -e YOUTUBE_CLIENT_ID=... \
  -e YOUTUBE_CLIENT_SECRET=... \
  -e YOUTUBE_TOKEN_FILE=/token/token.json \
  -v $PWD/token:/token \
  ghcr.io/miller-joe/youtube-mcp:latest
```

## Setup: Google Cloud one-time (~10 min)

1. **Google account plus YouTube channel.** Use a personal account, not a workspace one you might lose.
2. **Google Cloud project** at https://console.cloud.google.com. Call it whatever you want (e.g. `youtube-mcp`).
3. **Enable APIs:**
   - YouTube Data API v3
   - YouTube Analytics API
4. **OAuth consent screen:** External, App name, support email. In Scopes, add:
   - `youtube.upload`
   - `youtube.force-ssl`
   - `yt-analytics.readonly`
5. Stay in **Testing** mode. Add yourself as a **test user** (required). As the project owner, your refresh token won't expire.
6. **Create OAuth Client ID:** Application type = **Desktop app**. Download the JSON.
7. **Run the interactive auth flow:**

   ```bash
   npx @miller-joe/youtube-mcp --auth --client-secret-file ./client_secret.json
   ```

   A browser opens, you log in to the Google account tied to your YouTube channel, and grant the requested scopes. On success, a refresh token is saved to `~/.config/youtube-mcp/token.json`.

8. **Start the server:**

   ```bash
   npx @miller-joe/youtube-mcp --client-secret-file ./client_secret.json
   ```

   Or provide the client credentials via env: `YOUTUBE_CLIENT_SECRET_FILE`, or `YOUTUBE_CLIENT_ID` + `YOUTUBE_CLIENT_SECRET`.

## Connect an MCP client

```bash
claude mcp add --transport http youtube http://localhost:9120/mcp
```

Or point your MCP gateway at the Streamable HTTP endpoint.

## Configuration

| CLI flag | Env var | Default | Notes |
|---|---|---|---|
| `--client-secret-file` | `YOUTUBE_CLIENT_SECRET_FILE` | (none) | Path to Google OAuth JSON |
| `--client-id` | `YOUTUBE_CLIENT_ID` | (none) | Alternative to the secret file |
| `--client-secret` | `YOUTUBE_CLIENT_SECRET` | (none) | Alternative to the secret file |
| `--token-file` | `YOUTUBE_TOKEN_FILE` | `~/.config/youtube-mcp/token.json` | Refresh token storage |
| `--host` | `MCP_HOST` | `0.0.0.0` | Bind host (HTTP mode only) |
| `--port` | `MCP_PORT` | `9120` | Bind port (HTTP mode only) |
| `--stdio` | `MCP_TRANSPORT=stdio` | (unset) | Speak MCP over stdio instead of HTTP. Use when launched as a subprocess by a stdio-first MCP client (Claude Desktop, mcp-inspector). |
| `--comfyui-url` | `COMFYUI_URL` | *(unset, bridge disabled)* | ComfyUI HTTP URL for bridge tools |
| (no flag) | `COMFYUI_DEFAULT_CKPT` | `sd_xl_base_1.0.safetensors` | Default checkpoint for bridge tool |

### Transports

The server speaks streamable HTTP by default (great for Claude Code, MetaMCP, raw `fetch`). Pass `--stdio` (or set `MCP_TRANSPORT=stdio`) to switch into stdio mode, which is what stdio-first clients like Claude Desktop and the MCP Inspector expect:

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "youtube": {
      "command": "npx",
      "args": ["-y", "@miller-joe/youtube-mcp", "--stdio"],
      "env": {
        "YOUTUBE_CLIENT_SECRET_FILE": "/path/to/client_secret.json",
        "YOUTUBE_TOKEN_FILE": "/path/to/token.json"
      }
    }
  }
}
```

Stdio mode skips the OAuth-token preflight check — the server boots even without a stored token and surfaces auth errors at tool-call time. Run `youtube-mcp --auth --client-secret-file <path>` once in HTTP mode to seed the refresh token before pointing Claude Desktop at it.

## Tools

### Videos

- `list_my_videos`: paginated list of the authenticated channel's uploads.
- `get_video`: full detail for one video.
- `update_video_metadata`: title, description, tags, category, privacy.
- `delete_video`: permanently delete a video. Requires `confirm_video_title` to match the current title exactly, as a guard against deleting the wrong video.

### Captions

- `list_captions`: list caption tracks on a video (language, name, status, draft flag).
- `upload_caption`: upload an SRT or WebVTT caption track to a video.
- `delete_caption`: delete a caption track.

### Shorts

- `list_my_shorts`: find Shorts in recent uploads (filters by duration ≤60s).
- `get_shorts_analytics`: YouTube Analytics query restricted to Shorts (`creatorContentType==SHORTS`).

### Playlists

- `create_playlist`: create a playlist (default private).
- `add_to_playlist`: add a video to an existing playlist.

### Comments

- `list_comments`: top-level comment threads on a video.
- `reply_to_comment`: reply to a top-level comment.
- `moderate_comment`: hold, approve, or reject a comment.

### Analytics

- `query_channel_analytics`: date-ranged metrics with optional dimensions and filters.

### Bridge (when `COMFYUI_URL` is configured)

- `generate_and_set_thumbnail`: generate a thumbnail via ComfyUI and set it on a video in one call.

## Quota notes

YouTube Data API free tier = 10,000 units/day. Key operation costs:

- `videos.list`, `commentThreads.list`: 1 unit each.
- `videos.update`, `comments.insert`, `thumbnails.set`: 50 units each.
- `videos.insert` (upload): 1,600 units, so about 6 uploads per day on the free tier.

Most creator-ops workflows stay well under the free cap.

## Architecture

```
┌────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  MCP client    │────▶│  youtube-mcp     │────▶│  YouTube APIs   │
│  (Claude etc.) │◀────│  (this server)   │◀────│  (Data/Analytics)│
└────────────────┘     └────────┬─────────┘     └─────────────────┘
                                │
                                │ (bridge tools only)
                                ▼
                       ┌──────────────────┐
                       │  ComfyUI         │
                       │  (txt2img)       │
                       └──────────────────┘
```

OAuth refresh tokens are cached locally and refreshed just-in-time before expiry. The bridge tool downloads image bytes from ComfyUI internally, so ComfyUI does not need to be publicly reachable.

## Development

```bash
git clone https://github.com/miller-joe/youtube-mcp
cd youtube-mcp
npm install
npm run dev
npm run build
npm test
```

Requires Node 20+.

## Roadmap

Shipped:

- Videos: list, get, update metadata, delete with title-match confirm guard.
- Captions: upload, list, delete.
- Shorts: `list_my_shorts` (duration filter) and `get_shorts_analytics` (creatorContentType==SHORTS).
- Playlists: create, add-to.
- Comments: list, reply, moderate.
- Analytics: channel analytics query.
- ComfyUI thumbnail bridge: `generate_and_set_thumbnail`.

Planned:

- Video upload (`video_upload`) with resumable-upload support.
- Reporting API for bulk historical data exports.

## License

MIT © Joe Miller

## Support

If this saves you time, consider supporting development:

[![GitHub Sponsors](https://img.shields.io/github/sponsors/miller-joe?style=social&logo=github)](https://github.com/sponsors/miller-joe)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=kofi&logoColor=white)](https://ko-fi.com/indivisionjoe)
