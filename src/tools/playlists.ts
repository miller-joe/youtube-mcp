import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YouTubeClient } from "../youtube/client.js";

const createPlaylistSchema = {
  title: z
    .string()
    .min(1)
    .describe(
      "Playlist title (min 1 character, max 150 characters). Required.",
    ),
  description: z
    .string()
    .optional()
    .describe(
      "Optional playlist description (max 5000 characters). Defaults to an empty string when omitted.",
    ),
  privacy_status: z
    .enum(["public", "unlisted", "private"])
    .default("private")
    .describe(
      "Visibility of the new playlist: 'public', 'unlisted', or 'private'. Defaults to 'private'.",
    ),
};

const addToPlaylistSchema = {
  playlist_id: z
    .string()
    .describe(
      "YouTube playlist ID to add the video to — the playlist id (often starting 'PL...'), not a URL. Use the id returned by create_playlist. Required.",
    ),
  video_id: z
    .string()
    .describe(
      "YouTube video ID to add to the playlist (the id, not a URL). Required.",
    ),
};

export function registerPlaylistTools(server: McpServer, client: YouTubeClient): void {
  server.tool(
    "create_playlist",
    "Creates a new (empty) playlist on the authenticated channel via the YouTube Data API. Write operation: it inserts a new playlist resource owned by the authenticated channel (not idempotent — each call creates a separate playlist, even with identical titles; there is no delete-playlist tool here, so cleanup must be done manually in YouTube Studio). Defaults to 'private' visibility. Requires OAuth with the youtube.force-ssl scope and consumes write quota (~50 Data API units). Returns a confirmation line with the new playlist's title and ID — capture that ID to pass to add_to_playlist. Use this to start a new playlist, then add_to_playlist to populate it.",
    createPlaylistSchema,
    async (args) => {
      const playlist = await client.createPlaylist({
        title: args.title,
        description: args.description,
        privacyStatus: args.privacy_status,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Created ${args.privacy_status} playlist: ${playlist.snippet?.title ?? args.title} (${playlist.id})`,
          },
        ],
      };
    },
  );

  server.tool(
    "add_to_playlist",
    "Appends a video to an existing playlist via the YouTube Data API. Write operation: it inserts a playlistItem (not idempotent — calling it twice adds the same video twice). Requires OAuth with the youtube.force-ssl scope and consumes write quota (~50 Data API units). Returns a confirmation line with the video and playlist IDs. Use create_playlist first (or an existing playlist ID) to get playlist_id, and list_my_videos/get_video to get video_id; both arguments are YouTube IDs, not URLs.",
    addToPlaylistSchema,
    async (args) => {
      await client.addToPlaylist({
        playlistId: args.playlist_id,
        videoId: args.video_id,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Added video ${args.video_id} to playlist ${args.playlist_id}`,
          },
        ],
      };
    },
  );
}
