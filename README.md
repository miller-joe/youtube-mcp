# youtube-mcp

MCP server for YouTube — creator-ops (video metadata, playlists, comments, analytics) plus a **ComfyUI thumbnail bridge** that generates AI thumbnails and uploads them in one call.

Part of the [MCP Server Series](https://github.com/miller-joe).

[![GitHub Sponsors](https://img.shields.io/github/sponsors/miller-joe?style=social&logo=github)](https://github.com/sponsors/miller-joe)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=kofi&logoColor=white)](https://ko-fi.com/indivisionjoe)

## The pitch

Most existing YouTube MCPs are read-only transcript wrappers. This one does the actual work: update your videos' metadata, reply to comments, moderate spam, query analytics, and — the hero tool — **generate a thumbnail via ComfyUI and push it to YouTube in a single MCP call**.

```
Claude, use generate_and_set_thumbnail on video abc123:
  prompt: "cyberpunk hacker at keyboard, neon blue and pink, high contrast"
```

→ ComfyUI renders 1280×720 → youtube-mcp fetches the bytes → POSTs to `thumbnails.set`. Done.

## Install

```bash
# npx — no install
npx @miller-joe/youtube-mcp --help

# Docker
docker run -p 9120:9120 \
  -e YOUTUBE_CLIENT_ID=... \
  -e YOUTUBE_CLIENT_SECRET=... \
  -e YOUTUBE_TOKEN_FILE=/token/token.json \
  -v $PWD/token:/token \
  ghcr.io/miller-joe/youtube-mcp:latest
```

## Setup — Google Cloud one-time (~10 min)

1. **Google account + YouTube channel** — use a personal account, not a workspace one you might lose.
2. **Google Cloud project** at https://console.cloud.google.com — call it whatever (e.g. `youtube-mcp`).
3. **Enable APIs:**
   - YouTube Data API v3
   - YouTube Analytics API
4. **OAuth consent screen** — External, App name, support email; in Scopes add:
   - `youtube.upload`
   - `youtube.force-ssl`
   - `yt-analytics.readonly`
5. Stay in **Testing** mode. Add yourself as a **test user** (required). As the project owner, your refresh token won't expire.
6. **Create OAuth Client ID:** Application type = **Desktop app**. Download the JSON.
7. **Run the interactive auth flow:**

   ```bash
   npx @miller-joe/youtube-mcp --auth --client-secret-file ./client_secret.json
   ```

   A browser opens → you log in to the Google account tied to your YouTube channel → grant the requested scopes. On success, a refresh token is saved to `~/.config/youtube-mcp/token.json`.

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
| `--client-secret-file` | `YOUTUBE_CLIENT_SECRET_FILE` | — | Path to Google OAuth JSON |
| `--client-id` | `YOUTUBE_CLIENT_ID` | — | Alternative to the secret file |
| `--client-secret` | `YOUTUBE_CLIENT_SECRET` | — | Alternative to the secret file |
| `--token-file` | `YOUTUBE_TOKEN_FILE` | `~/.config/youtube-mcp/token.json` | Refresh token storage |
| `--host` | `MCP_HOST` | `0.0.0.0` | Bind host |
| `--port` | `MCP_PORT` | `9120` | Bind port |
| `--comfyui-url` | `COMFYUI_URL` | *(unset — bridge disabled)* | ComfyUI HTTP URL for bridge tools |
| — | `COMFYUI_DEFAULT_CKPT` | `sd_xl_base_1.0.safetensors` | Default checkpoint for bridge tool |

## Tools

### Videos
- `list_my_videos` — paginated list of authenticated channel's uploads
- `get_video` — full detail for one video
- `update_video_metadata` — title / description / tags / category / privacy

### Playlists
- `create_playlist` — create a playlist (default private)
- `add_to_playlist` — add a video to an existing playlist

### Comments
- `list_comments` — top-level comment threads on a video
- `reply_to_comment` — reply to a top-level comment
- `moderate_comment` — hold / approve / reject a comment

### Analytics
- `query_channel_analytics` — date-ranged metrics with optional dimensions and filters

### Bridge (when `COMFYUI_URL` is configured)
- `generate_and_set_thumbnail` — generate thumbnail via ComfyUI and set it on a video in one call

## Quota notes

YouTube Data API free tier = 10,000 units/day. Key operation costs:

- `videos.list`, `commentThreads.list` — 1 unit each
- `videos.update`, `comments.insert`, `thumbnails.set` — 50 units each
- **`videos.insert` (upload)** — 1,600 units → ~6 uploads/day on free tier

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

OAuth refresh tokens are cached locally and refreshed just-in-time before expiry. The bridge tool downloads image bytes from ComfyUI internally — ComfyUI does not need to be publicly reachable.

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

- [x] Video list / get / update metadata
- [x] Playlist create + add-to
- [x] Comments list / reply / moderate
- [x] Channel analytics query
- [x] ComfyUI thumbnail bridge (`generate_and_set_thumbnail`)
- [ ] Video upload (`video_upload`) — resumable upload support
- [ ] Caption upload
- [ ] Video delete (held until there's a safe confirm pattern)
- [ ] Reporting API for bulk historical data exports
- [ ] Shorts-specific ergonomics (vertical workflow, pinned comments)

## License

MIT © Joe Miller

## Support

If this saves you time, consider supporting development:

[![GitHub Sponsors](https://img.shields.io/github/sponsors/miller-joe?style=social&logo=github)](https://github.com/sponsors/miller-joe)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=kofi&logoColor=white)](https://ko-fi.com/indivisionjoe)
