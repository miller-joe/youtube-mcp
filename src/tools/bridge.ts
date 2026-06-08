import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YouTubeClient } from "../youtube/client.js";
import type { ComfyUIClient } from "../comfyui/client.js";

const generateAndSetThumbnailSchema = {
  video_id: z
    .string()
    .describe(
      "YouTube video ID to set the generated thumbnail on (the id, not a URL). Required.",
    ),
  prompt: z
    .string()
    .min(1)
    .describe(
      "Text-to-image prompt for the thumbnail (min 1 character). Aim for high-contrast subjects that stay readable at small sizes. Required.",
    ),
  width: z
    .number()
    .int()
    .min(320)
    .max(2560)
    .default(1280)
    .describe(
      "Generated image width in pixels (320–2560). Defaults to 1280, which with the default height matches YouTube's recommended 16:9 thumbnail.",
    ),
  height: z
    .number()
    .int()
    .min(180)
    .max(1440)
    .default(720)
    .describe(
      "Generated image height in pixels (180–1440). Defaults to 720 (16:9 with the default width).",
    ),
  steps: z
    .number()
    .int()
    .min(1)
    .max(150)
    .default(30)
    .describe(
      "Number of diffusion sampling steps (1–150). Higher is slower but can be more detailed. Defaults to 30.",
    ),
  cfg: z
    .number()
    .min(1)
    .max(30)
    .default(7)
    .describe(
      "Classifier-free guidance scale (1–30): how strongly the image follows the prompt. Higher is more literal but can over-saturate. Defaults to 7.",
    ),
  seed: z
    .number()
    .int()
    .optional()
    .describe(
      "Optional RNG seed for reproducible generation. Omit (default) to use a random seed each call.",
    ),
  checkpoint: z
    .string()
    .optional()
    .describe(
      "ComfyUI model checkpoint filename (e.g. 'sd_xl_base_1.0.safetensors') to load on the ComfyUI server. Omit (default) to use the server's COMFYUI_DEFAULT_CKPT.",
    ),
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
    "Generates a thumbnail image from a text prompt on the configured ComfyUI server, then uploads it as the video's custom thumbnail via the YouTube Data API. Two side effects: (1) it runs a text-to-image generation job on ComfyUI (this tool is only registered when a ComfyUI URL is configured; the call can take many seconds to minutes and may time out after ~10 minutes), and (2) it overwrites the video's current custom thumbnail — a write operation that replaces any existing thumbnail immediately and publicly (the prior thumbnail is not preserved). Requires OAuth with the youtube.upload scope and consumes YouTube Data API write quota (~50 units for thumbnails.set), plus the video must have custom-thumbnail privileges (verified channel). Defaults to 1280x720 (YouTube's recommended 16:9). Returns confirmation lines with the video ID, generated filename/dimensions, and the ComfyUI prompt_id. Use this to create-and-apply a thumbnail in one step; there is no separate upload-only thumbnail tool here.",
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
