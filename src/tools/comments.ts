import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YouTubeClient } from "../youtube/client.js";

const listCommentsSchema = {
  video_id: z
    .string()
    .describe(
      "YouTube video ID whose comment threads to list (the id, not a URL). Required.",
    ),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe(
      "Number of top-level comment threads to return, 1–100. Defaults to 20. This tool does not paginate, so this is the hard cap per call.",
    ),
};

const replySchema = {
  parent_id: z
    .string()
    .describe(
      "ID of the top-level comment to reply to — the comment id printed by list_comments (a YouTube comment ID, not a video ID or URL). Required.",
    ),
  text: z
    .string()
    .min(1)
    .describe(
      "Reply body text (plain text, min 1 character). Posted publicly under the authenticated channel's identity. Required.",
    ),
};

const moderateSchema = {
  comment_id: z
    .string()
    .describe(
      "ID of the comment to moderate (a YouTube comment ID from list_comments, not a video ID). Required.",
    ),
  moderation_status: z
    .enum(["heldForReview", "published", "rejected"])
    .describe(
      "Target status: 'heldForReview' hides the comment pending your approval, 'published' makes/keeps it publicly visible (approve), 'rejected' removes it from public view (reject/delete). Required.",
    ),
};

export function registerCommentTools(server: McpServer, client: YouTubeClient): void {
  server.tool(
    "list_comments",
    "Lists top-level comment threads on a video, newest first. Read-only; no mutations. Requires OAuth and costs ~1 YouTube Data API read unit. Returns a text list, one line per thread: comment ID, author display name, like count, reply count, and a truncated (~160 char) preview of the comment text. Use the returned comment IDs as parent_id for reply_to_comment or comment_id for moderate_comment. Note: this returns only the top-level comment of each thread, not nested replies, and does not paginate beyond max_results.",
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
    "Posts a public reply to an existing top-level YouTube comment via the Data API. Side effects: creates a publicly visible comment under the authenticated channel's identity (not idempotent — calling twice posts two replies and there is no built-in undo). Requires OAuth with the youtube.force-ssl scope and consumes write quota (~50 Data API units). Returns a confirmation line referencing the parent comment ID. Use list_comments first to get a valid parent_id; this tool replies within an existing thread only (it cannot start a new top-level comment, and parent_id must be a top-level comment, not another reply).",
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
    "Sets the moderation status of a comment on the authenticated channel's videos via the Data API. Write/moderation operation that changes the comment's public visibility: 'heldForReview' hides it pending approval, 'published' approves/restores it, 'rejected' removes it from public view (effectively a soft delete — reversibility via the API is not guaranteed). Requires OAuth with the youtube.force-ssl scope and consumes write quota (~50 Data API units). Returns a confirmation line with the comment ID and new status. Use list_comments to find comment IDs; use this to approve/hide/reject viewer comments rather than to reply (use reply_to_comment for replies).",
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
