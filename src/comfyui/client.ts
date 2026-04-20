import type {
  HistoryEntry,
  ImageRef,
  PromptSubmitResponse,
  Workflow,
} from "./types.js";

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

export interface ComfyUIClientOptions {
  baseUrl: string;
}

export interface GenerateImageParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  checkpoint: string;
}

export interface GenerateImageResult {
  promptId: string;
  imageRefs: ImageRef[];
}

export class ComfyUIClient {
  constructor(private readonly options: ComfyUIClientOptions) {}

  async generate(params: GenerateImageParams): Promise<GenerateImageResult> {
    const workflow = txt2img({
      prompt: params.prompt,
      negativePrompt: params.negativePrompt ?? "",
      width: params.width ?? 1280,
      height: params.height ?? 720,
      steps: params.steps ?? 25,
      cfg: params.cfg ?? 7,
      seed: params.seed ?? Math.floor(Math.random() * 2 ** 32),
      checkpoint: params.checkpoint,
    });

    const submit = await this.submit(workflow);
    const entry = await this.waitForCompletion(submit.prompt_id);
    return {
      promptId: submit.prompt_id,
      imageRefs: extractImageRefs(entry),
    };
  }

  async fetchImageBytes(ref: ImageRef): Promise<{ bytes: Uint8Array; contentType: string }> {
    const params = new URLSearchParams({
      filename: ref.filename,
      subfolder: ref.subfolder,
      type: ref.type,
    });
    const res = await fetch(`${this.options.baseUrl}/view?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`ComfyUI view fetch failed: ${res.status}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "image/png";
    return { bytes: buf, contentType };
  }

  private async submit(workflow: Workflow): Promise<PromptSubmitResponse> {
    const res = await fetch(`${this.options.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
    });
    if (!res.ok) {
      throw new Error(`ComfyUI submit failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as PromptSubmitResponse;
    if (body.node_errors && Object.keys(body.node_errors).length > 0) {
      throw new Error(`ComfyUI workflow errors: ${JSON.stringify(body.node_errors)}`);
    }
    return body;
  }

  private async waitForCompletion(promptId: string): Promise<HistoryEntry> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const res = await fetch(`${this.options.baseUrl}/history/${promptId}`);
      if (res.ok) {
        const body = (await res.json()) as Record<string, HistoryEntry>;
        const entry = body[promptId];
        if (entry?.status?.completed) return entry;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`ComfyUI generation timed out (prompt ${promptId})`);
  }
}

function extractImageRefs(entry: HistoryEntry): ImageRef[] {
  const refs: ImageRef[] = [];
  for (const output of Object.values(entry.outputs)) {
    for (const image of output.images ?? []) {
      refs.push({
        filename: image.filename,
        subfolder: image.subfolder,
        type: image.type,
      });
    }
  }
  return refs;
}

function txt2img(params: {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  checkpoint: string;
}): Workflow {
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: params.seed,
        steps: params.steps,
        cfg: params.cfg,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: params.checkpoint },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width: params.width, height: params.height, batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: params.prompt, clip: ["4", 1] },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: params.negativePrompt, clip: ["4", 1] },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["4", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "youtube-mcp", images: ["8", 0] },
    },
  };
}
