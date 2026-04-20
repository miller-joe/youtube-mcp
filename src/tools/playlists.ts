import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YouTubeClient } from "../youtube/client.js";

const createPlaylistSchema = {
  title: z.string().min(1),
  description: z.string().optional(),
  privacy_status: z.enum(["public", "unlisted", "private"]).default("private"),
};

const addToPlaylistSchema = {
  playlist_id: z.string().describe("YouTube playlist ID"),
  video_id: z.string().describe("YouTube video ID to add"),
};

export function registerPlaylistTools(server: McpServer, client: YouTubeClient): void {
  server.tool(
    "create_playlist",
    "Create a new playlist on the authenticated channel. Default privacy is 'private'.",
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
    "Add a video to an existing playlist. Both playlist_id and video_id are YouTube IDs (not URLs).",
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
