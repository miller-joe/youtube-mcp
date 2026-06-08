import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YouTubeClient } from "../youtube/client.js";

const listMyVideosSchema = {
  max_results: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(25)
    .describe(
      "Number of videos to return for this page, 1–50. Defaults to 25. To fetch more, pass the returned page_token on a follow-up call.",
    ),
  page_token: z
    .string()
    .optional()
    .describe(
      "Opaque pagination cursor from a previous call's 'next page_token' line. Omit (default) to start from the newest uploads.",
    ),
};

const getVideoSchema = {
  video_id: z
    .string()
    .describe(
      "YouTube video ID — the 11-character id (the part after v= in a watch URL), not a full URL. Required.",
    ),
};

const deleteVideoSchema = {
  video_id: z
    .string()
    .describe("YouTube video ID of the video to delete (the id, not a URL). Required."),
  confirm_video_title: z
    .string()
    .describe(
      "Exact current title of the video, used as a safety guard. Must match the title YouTube currently returns for video_id, or the delete is aborted before any API call. Fetch the current title with get_video or list_my_videos first. Required.",
    ),
};

const updateVideoMetadataSchema = {
  video_id: z
    .string()
    .describe("YouTube video ID of the video to update (the id, not a URL). Required."),
  title: z
    .string()
    .optional()
    .describe(
      "New video title (max 100 characters). Omit to leave the title unchanged.",
    ),
  description: z
    .string()
    .optional()
    .describe(
      "New video description (max 5000 characters). Omit to leave the description unchanged. Passing an empty string clears it.",
    ),
  tags: z
    .array(z.string())
    .optional()
    .describe(
      "Full replacement list of keyword tags (this overwrites all existing tags; it is not additive). Omit to leave tags unchanged.",
    ),
  category_id: z
    .string()
    .optional()
    .describe(
      "YouTube category ID as a numeric string (e.g. '22' = People & Blogs, '27' = Education, '28' = Science & Tech). Omit to keep the current category; if you change the title/description without supplying this, the existing category is fetched and reused automatically.",
    ),
  privacy_status: z
    .enum(["public", "unlisted", "private"])
    .optional()
    .describe(
      "New visibility: 'public', 'unlisted', or 'private'. Omit to leave visibility unchanged.",
    ),
};

export function registerVideoTools(server: McpServer, client: YouTubeClient): void {
  server.tool(
    "list_my_videos",
    "Lists videos on the authenticated channel, newest first (read from the channel's uploads playlist). Read-only; no mutations. Requires OAuth (uses the stored channel-owner token) and costs a few YouTube Data API read units per call (channels.list + playlistItems.list + videos.list). Returns a text list of one line per video: video ID, title, view count, and privacy status, plus a next page_token line for pagination. Use this to discover your own video IDs to feed into get_video, update_video_metadata, delete_video, or playlist/comment tools; use get_video for full details on a single known video, or list_my_shorts to filter to Shorts only.",
    listMyVideosSchema,
    async (args) => {
      const res = await client.listMyUploads(args.max_results, args.page_token);
      const lines = [
        `Found ${res.items.length} video(s):`,
        ...res.items.map((v) => {
          const title = v.snippet?.title ?? "(untitled)";
          const views = v.statistics?.viewCount ?? "0";
          const privacy = v.status?.privacyStatus ?? "?";
          return `  ${v.id} — ${title} [${views} views, ${privacy}]`;
        }),
        res.nextPageToken ? `next page_token: ${res.nextPageToken}` : "(end of results)",
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "get_video",
    "Fetches full details for a single video by ID — snippet (title, description, tags, category), status (privacy), statistics (views/likes/comments), and contentDetails (duration). Read-only; no mutations. Requires OAuth and costs ~1 YouTube Data API read unit. Returns the raw video resource as pretty-printed JSON, or a 'Video not found' message if the ID doesn't resolve. Use this when you already know the video ID and need its current metadata (e.g. before update_video_metadata); use list_my_videos to discover IDs across the channel.",
    getVideoSchema,
    async (args) => {
      const data = await client.getVideo(args.video_id);
      const video = data.items[0];
      if (!video) {
        return { content: [{ type: "text" as const, text: `Video not found: ${args.video_id}` }] };
      }
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(video, null, 2) },
        ],
      };
    },
  );

  server.tool(
    "delete_video",
    "DESTRUCTIVE and IRREVERSIBLE: permanently deletes a video from the channel via the YouTube Data API. Side effects: as a safety guard it first fetches the video and aborts unless confirm_video_title matches the current title exactly; on match it issues videos.delete and the video (and its comments, analytics history, and URL) are gone for good with no undo. Requires OAuth with the youtube.force-ssl scope and consumes write quota (~50 Data API units). Returns a confirmation line with the deleted ID and title. Use only on explicit user request; never as cleanup. To change visibility without deleting, use update_video_metadata with privacy_status='private' instead.",
    deleteVideoSchema,
    async (args) => {
      const current = await client.getVideo(args.video_id);
      const video = current.items[0];
      if (!video) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Video not found: ${args.video_id}`,
            },
          ],
        };
      }
      const actualTitle = video.snippet?.title ?? "";
      if (actualTitle !== args.confirm_video_title) {
        throw new Error(
          `confirm_video_title mismatch. Expected exact title "${actualTitle}", got "${args.confirm_video_title}". Aborting delete.`,
        );
      }
      await client.deleteVideo(args.video_id);
      return {
        content: [
          {
            type: "text" as const,
            text: `Deleted video ${args.video_id} ("${actualTitle}").`,
          },
        ],
      };
    },
  );

  server.tool(
    "update_video_metadata",
    "Updates a video's metadata — title, description, tags, category, and/or privacy — via the YouTube Data API. Write operation (not read-only): it overwrites the supplied fields on the live video (tags are replaced wholesale, not merged); changes are visible publicly and take effect immediately, though they can be edited again. Only pass the fields you want changed; omitted fields are left as-is. Because the API requires title+category on any snippet update, it transparently fetches and reuses the current title/category when you omit them. Requires OAuth with the youtube.force-ssl scope and consumes write quota (~50 Data API units, plus an extra read unit if it has to backfill title/category). Returns a confirmation line listing which parts (snippet/status) were updated. Use get_video first to see current values; use delete_video only to remove a video entirely.",
    updateVideoMetadataSchema,
    async (args) => {
      const patch: Record<string, unknown> = {};
      const snippet: Record<string, unknown> = {};
      const status: Record<string, unknown> = {};

      if (args.title !== undefined) snippet.title = args.title;
      if (args.description !== undefined) snippet.description = args.description;
      if (args.tags !== undefined) snippet.tags = args.tags;
      if (args.category_id !== undefined) snippet.categoryId = args.category_id;
      if (args.privacy_status !== undefined) status.privacyStatus = args.privacy_status;

      if (Object.keys(snippet).length > 0) {
        // Category is required when updating snippet — fetch current if user didn't supply one.
        if (!snippet.categoryId) {
          const current = await client.getVideo(args.video_id);
          const existingCategory = current.items[0]?.snippet?.categoryId;
          if (!existingCategory) {
            throw new Error("Video has no category — pass category_id explicitly");
          }
          snippet.categoryId = existingCategory;
        }
        // Title is required for a snippet update.
        if (!snippet.title) {
          const current = await client.getVideo(args.video_id);
          const existingTitle = current.items[0]?.snippet?.title;
          if (!existingTitle) throw new Error("Cannot update snippet without a title");
          snippet.title = existingTitle;
        }
        patch.snippet = snippet;
      }
      if (Object.keys(status).length > 0) patch.status = status;

      if (Object.keys(patch).length === 0) {
        return { content: [{ type: "text" as const, text: "No fields to update." }] };
      }

      await client.updateVideo(args.video_id, patch);
      return {
        content: [
          {
            type: "text" as const,
            text: `Updated video ${args.video_id} (${Object.keys(patch).join(", ")})`,
          },
        ],
      };
    },
  );
}
