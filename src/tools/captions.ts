import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Buffer } from "node:buffer";
import type { YouTubeClient } from "../youtube/client.js";

const uploadCaptionSchema = {
  video_id: z
    .string()
    .describe(
      "YouTube video ID the caption track belongs to (the id, not a URL). Required.",
    ),
  language: z
    .string()
    .describe(
      "BCP-47 language code of the caption track, e.g. 'en', 'en-US', 'es', 'ja'. Required.",
    ),
  name: z
    .string()
    .default("")
    .describe(
      "Track name shown in the player's caption menu (used to distinguish multiple tracks in the same language). Defaults to an empty string, which YouTube treats as the default/unnamed track.",
    ),
  caption_text: z
    .string()
    .describe(
      "The caption file contents as a UTF-8 string, in the format given by 'format' (SubRip or WebVTT). Provide the full track text, not a file path. Required.",
    ),
  format: z
    .enum(["srt", "vtt"])
    .default("srt")
    .describe(
      "Format/content type of caption_text: 'srt' (SubRip, sent as application/x-subrip) or 'vtt' (WebVTT, sent as text/vtt). Defaults to 'srt'.",
    ),
  is_draft: z
    .boolean()
    .default(false)
    .describe(
      "If true, the track is uploaded as a draft that is not shown to viewers (useful while reviewing/translating). Defaults to false (publishes the track to viewers).",
    ),
};

const listCaptionsSchema = {
  video_id: z
    .string()
    .describe(
      "YouTube video ID whose caption tracks to list (the id, not a URL). Required.",
    ),
};

const deleteCaptionSchema = {
  caption_id: z
    .string()
    .describe(
      "Caption track ID to delete (the caption track id from list_captions, not a video ID). Required.",
    ),
};

export function registerCaptionTools(
  server: McpServer,
  client: YouTubeClient,
): void {
  server.tool(
    "list_captions",
    "Lists the caption tracks on a video with their language, name, track kind, status, and draft flag. Read-only; no mutations. Requires OAuth and costs ~50 YouTube Data API units (captions.list). Returns a text list, one line per track: caption track ID, language, name, kind, status, and a [draft] marker, or a message that the video has no caption tracks. Use this to get a caption track ID before delete_caption, or to check existing tracks before upload_caption.",
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
    "Uploads a new caption/subtitle track (SubRip SRT or WebVTT) to a video via the YouTube Data API. Write operation: it always inserts a new track (not idempotent — it does not replace an existing same-language track, so repeated calls create duplicates; use a distinct name per track or is_draft=true while iterating, and delete_caption to remove extras). Newly uploaded non-draft tracks become visible to viewers. Requires OAuth with the youtube.force-ssl scope and consumes heavy write quota (~400 YouTube Data API units). Returns confirmation lines with the new caption track ID, video ID, language, name, format, and status. Use list_captions first to check what already exists; use delete_caption to remove a track.",
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
    "DESTRUCTIVE and IRREVERSIBLE: permanently deletes a caption track by ID via the YouTube Data API (captions.delete). The track is removed from the video for viewers with no undo; re-adding requires uploading it again. Requires OAuth with the youtube.force-ssl scope and consumes write quota (~50 Data API units). Returns a confirmation line with the deleted track ID. Use list_captions first to find the correct caption_id; note caption_id is a caption track ID, not a video ID.",
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
