import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YouTubeClient } from "../youtube/client.js";
import type { ComfyUIClient } from "../comfyui/client.js";

const generateAndSetThumbnailSchema = {
  video_id: z
    .string()
    .describe("YouTube video ID to set the thumbnail on"),
  prompt: z
    .string()
    .min(1)
    .describe("Image prompt for the thumbnail. Aim for something high-contrast and readable at small sizes."),
  width: z.number().int().min(320).max(2560).default(1280),
  height: z.number().int().min(180).max(1440).default(720),
  steps: z.number().int().min(1).max(150).default(30),
  cfg: z.number().min(1).max(30).default(7),
  seed: z.number().int().optional(),
  checkpoint: z
    .string()
    .optional()
    .describe("ComfyUI checkpoint filename — defaults to COMFYUI_DEFAULT_CKPT env."),
};

export function registerBridgeTools(
  server: McpServer,
  youtube: YouTubeClient,
  comfyui: ComfyUIClient | null,
  defaultCheckpoint: string,
): void {
  if (!comfyui) return;

  server.tool(
    "generate_and_set_thumbnail",
    "Generate a thumbnail image with ComfyUI and set it on a YouTube video. Uses 1280x720 by default (YouTube's recommended aspect). Requires youtube.upload scope. Combines the creator-ops workflow with AI image generation in one call.",
    generateAndSetThumbnailSchema,
    async (args) => {
      const checkpoint = args.checkpoint ?? defaultCheckpoint;
      const gen = await comfyui.generate({
        prompt: args.prompt,
        width: args.width,
        height: args.height,
        steps: args.steps,
        cfg: args.cfg,
        seed: args.seed,
        checkpoint,
      });
      if (gen.imageRefs.length === 0) {
        throw new Error("ComfyUI returned no images");
      }
      const ref = gen.imageRefs[0]!;
      const { bytes, contentType } = await comfyui.fetchImageBytes(ref);
      await youtube.setThumbnail(args.video_id, bytes, contentType);
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Thumbnail set on ${args.video_id}`,
              `  generated: ${ref.filename} (${args.width}x${args.height})`,
              `  comfyui prompt_id: ${gen.promptId}`,
            ].join("\n"),
          },
        ],
      };
    },
  );
}
