import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YouTubeClient } from "../youtube/client.js";

const listCommentsSchema = {
  video_id: z.string().describe("Video ID to list comments from"),
  max_results: z.number().int().min(1).max(100).default(20),
};

const replySchema = {
  parent_id: z
    .string()
    .describe("Comment ID to reply to (top-level comment.id from list_comments)"),
  text: z.string().min(1),
};

const moderateSchema = {
  comment_id: z.string(),
  moderation_status: z.enum(["heldForReview", "published", "rejected"]).describe(
    "heldForReview hides until approved, published approves, rejected deletes.",
  ),
};

export function registerCommentTools(server: McpServer, client: YouTubeClient): void {
  server.tool(
    "list_comments",
    "List top-level comment threads on a video (newest first). Returns comment IDs, authors, text, and like counts.",
    listCommentsSchema,
    async (args) => {
      const data = await client.listComments(args.video_id, args.max_results);
      const lines = [
        `Found ${data.items.length} comment thread(s) on ${args.video_id}:`,
        ...data.items.map((thread) => {
          const top = thread.snippet?.topLevelComment?.snippet;
          const id = thread.snippet?.topLevelComment?.id ?? "?";
          const author = top?.authorDisplayName ?? "?";
          const text = (top?.textOriginal ?? "").replace(/\s+/g, " ").slice(0, 160);
          const likes = top?.likeCount ?? 0;
          const replies = thread.snippet?.totalReplyCount ?? 0;
          return `  ${id} — ${author} (${likes}❤, ${replies}↩): ${text}`;
        }),
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "reply_to_comment",
    "Reply to a top-level comment. Requires youtube.force-ssl scope.",
    replySchema,
    async (args) => {
      await client.replyToComment(args.parent_id, args.text);
      return {
        content: [
          {
            type: "text" as const,
            text: `Reply posted to ${args.parent_id}`,
          },
        ],
      };
    },
  );

  server.tool(
    "moderate_comment",
    "Change the moderation status of a comment: heldForReview (hide pending approval), published (approve), or rejected (delete).",
    moderateSchema,
    async (args) => {
      await client.moderateComment(args.comment_id, args.moderation_status);
      return {
        content: [
          {
            type: "text" as const,
            text: `Set moderation status of ${args.comment_id} to ${args.moderation_status}`,
          },
        ],
      };
    },
  );
}
