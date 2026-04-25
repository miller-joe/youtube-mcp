import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { YouTubeClient } from "./youtube/client.js";
import { ComfyUIClient } from "./comfyui/client.js";
import { registerVideoTools } from "./tools/videos.js";
import { registerPlaylistTools } from "./tools/playlists.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerAnalyticsTool } from "./tools/analytics.js";
import { registerCaptionTools } from "./tools/captions.js";
import { registerShortsTools } from "./tools/shorts.js";
import { registerBridgeTools } from "./tools/bridge.js";

export interface ServerConfig {
  host: string;
  port: number;
  clientId: string;
  clientSecret: string;
  tokenFile: string;
  comfyUIUrl?: string;
  comfyUIDefaultCkpt: string;
}

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

function buildContext(config: ServerConfig) {
  const youtube = new YouTubeClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tokenFile: config.tokenFile,
  });
  const comfyui = config.comfyUIUrl
    ? new ComfyUIClient({ baseUrl: config.comfyUIUrl })
    : null;
  const buildServer = () => {
    const s = new McpServer({ name: "youtube-mcp", version: "0.1.0" });
    registerVideoTools(s, youtube);
    registerPlaylistTools(s, youtube);
    registerCommentTools(s, youtube);
    registerAnalyticsTool(s, youtube);
    registerCaptionTools(s, youtube);
    registerShortsTools(s, youtube);
    registerBridgeTools(s, youtube, comfyui, config.comfyUIDefaultCkpt);
    return s;
  };
  return { comfyui, buildServer };
}

export async function startStdioServer(config: ServerConfig): Promise<void> {
  const { buildServer } = buildContext(config);
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export async function startServer(config: ServerConfig): Promise<void> {
  const { comfyui, buildServer } = buildContext(config);
  const sessions = new Map<string, Session>();

  const httpServer = createServer(async (req, res) => {
    try {
      await handleMcpRequest(req, res, sessions, buildServer);
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: (err as Error).message },
            id: null,
          }),
        );
      }
    }
  });

  httpServer.listen(config.port, config.host, () => {
    const bridge = comfyui ? `yes (${config.comfyUIUrl})` : "no";
    process.stdout.write(
      `youtube-mcp listening on http://${config.host}:${config.port} (comfyui: ${bridge}, token: ${config.tokenFile})\n`,
    );
  });

  const shutdown = () => {
    for (const { transport } of sessions.values()) void transport.close();
    httpServer.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Map<string, Session>,
  buildServer: () => McpServer,
): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let body: unknown = undefined;
  if (req.method === "POST") body = await readJsonBody(req);

  let session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session && body !== undefined && isInitializeRequest(body)) {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { server, transport });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    session = { server, transport };
  }

  if (!session) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            "Bad Request: no valid session. Send initialize first or include Mcp-Session-Id header.",
        },
        id: null,
      }),
    );
    return;
  }

  await session.transport.handleRequest(req, res, body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (raw.length === 0) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
