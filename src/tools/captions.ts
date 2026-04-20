import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Buffer } from "node:buffer";
import type { YouTubeClient } from "../youtube/client.js";

const uploadCaptionSchema = {
  video_id: z.string().describe("Video ID the caption belongs to."),
  language: z
    .string()
    .describe(
      "BCP-47 language code, e.g. 'en', 'en-US', 'es', 'ja'. Must match a language the video supports.",
    ),
  name: z
    .string()
    .default("")
    .describe(
      "Caption track name shown in the player's caption menu. Empty string for the default track.",
    ),
  caption_text: z
    .string()
    .describe(
      "Caption content as a string (SRT or WebVTT format). Source this from a file or the model's output.",
    ),
  format: z
    .enum(["srt", "vtt"])
    .default("srt")
    .describe(
      "Content type of caption_text: 'srt' (SubRip, application/x-subrip) or 'vtt' (WebVTT, text/vtt).",
    ),
  is_draft: z
    .boolean()
    .default(false)
    .describe(
      "Draft captions aren't visible to viewers. Useful while reviewing auto-translations.",
    ),
};

const listCaptionsSchema = {
  video_id: z.string().describe("Video ID to list captions for."),
};

const deleteCaptionSchema = {
  caption_id: z.string().describe("Caption track ID to delete."),
};

export function registerCaptionTools(
  server: McpServer,
  client: YouTubeClient,
): void {
  server.tool(
    "list_captions",
    "List caption tracks on a video with their language, name, status, and whether they are drafts.",
    listCaptionsSchema,
    async (args) => {
      const res = await client.listCaptions(args.video_id);
      if (res.items.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Video ${args.video_id} has no caption tracks.`,
            },
          ],
        };
      }
      const lines = [
        `Found ${res.items.length} caption track(s):`,
        ...res.items.map((c) => {
          const s = c.snippet ?? {};
          const draft = s.isDraft ? " [draft]" : "";
          const kind = s.trackKind ? ` (${s.trackKind})` : "";
          return `  ${c.id} — ${s.language ?? "?"} "${s.name ?? ""}"${kind} [${s.status ?? "?"}]${draft}`;
        }),
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "upload_caption",
    "Upload a caption track (SRT or WebVTT) to a video. Creates a new track — use a distinct `name` per language/track, or `is_draft=true` while iterating.",
    uploadCaptionSchema,
    async (args) => {
      const contentType =
        args.format === "vtt" ? "text/vtt" : "application/x-subrip";
      const bytes = new Uint8Array(Buffer.from(args.caption_text, "utf-8"));
      const result = (await client.insertCaption({
        videoId: args.video_id,
        language: args.language,
        name: args.name,
        isDraft: args.is_draft,
        body: bytes,
        captionContentType: contentType,
      })) as {
        id?: string;
        snippet?: { status?: string };
      };
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Uploaded caption track: ${result.id ?? "(unknown id)"}`,
              `  video: ${args.video_id}`,
              `  language: ${args.language}`,
              `  name: "${args.name}"`,
              `  format: ${args.format}`,
              `  status: ${result.snippet?.status ?? "?"}`,
              args.is_draft ? "  (draft — not visible to viewers)" : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      };
    },
  );

  server.tool(
    "delete_caption",
    "Delete a caption track by ID. Use list_captions to find the track ID first.",
    deleteCaptionSchema,
    async (args) => {
      await client.deleteCaption(args.caption_id);
      return {
        content: [
          {
            type: "text" as const,
            text: `Deleted caption track ${args.caption_id}.`,
          },
        ],
      };
    },
  );
}
