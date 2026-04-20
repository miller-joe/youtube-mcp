import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YouTubeClient } from "../youtube/client.js";

const listMyVideosSchema = {
  max_results: z.number().int().min(1).max(50).default(25),
  page_token: z.string().optional(),
};

const getVideoSchema = {
  video_id: z.string().describe("YouTube video ID (the part after v= in the URL)"),
};

const deleteVideoSchema = {
  video_id: z.string().describe("Video ID to delete."),
  confirm_video_title: z
    .string()
    .describe(
      "Exact current title of the video. Must match what YouTube returns to proceed — prevents accidental deletion of the wrong video.",
    ),
};

const updateVideoMetadataSchema = {
  video_id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  category_id: z
    .string()
    .optional()
    .describe(
      "YouTube category ID as a string (e.g. '22' = People & Blogs, '27' = Education, '28' = Science & Tech)",
    ),
  privacy_status: z.enum(["public", "unlisted", "private"]).optional(),
};

export function registerVideoTools(server: McpServer, client: YouTubeClient): void {
  server.tool(
    "list_my_videos",
    "List videos on the authenticated channel (newest first via the uploads playlist). Returns video IDs, titles, view counts, and privacy status.",
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
    "Fetch full details for one video by ID — snippet, status, statistics, duration.",
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
    "Permanently delete a video. Requires confirm_video_title to match the video's current title exactly — guards against deleting the wrong video by ID. Deletion is irreversible.",
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
    "Update a video's metadata — title, description, tags, category, or privacy. Only provide fields you want changed.",
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
