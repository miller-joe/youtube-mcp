import { Buffer } from "node:buffer";
import { refreshAccessToken } from "../auth/oauth.js";
import { loadStoredToken, saveStoredToken } from "../auth/tokens.js";
import type { StoredToken } from "../auth/types.js";
import type {
  AnalyticsResponse,
  Channel,
  CommentThread,
  Playlist,
  Video,
  VideoListResponse,
} from "./types.js";

const DATA_API = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2";
const UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3";

export interface YouTubeClientOptions {
  clientId: string;
  clientSecret: string;
  tokenFile: string;
}

export class YouTubeClient {
  private token: StoredToken | null = null;

  constructor(private readonly options: YouTubeClientOptions) {}

  async ensureAccessToken(): Promise<string> {
    if (!this.token) {
      this.token = await loadStoredToken(this.options.tokenFile);
      if (!this.token) {
        throw new Error(
          `No stored OAuth token at ${this.options.tokenFile}. Run 'youtube-mcp --auth --client-secret-file <path>' first.`,
        );
      }
    }
    // Refresh a minute before expiry to avoid edge-case racy expirations.
    if (Date.now() > this.token.expires_at - 60_000) {
      const fresh = await refreshAccessToken({
        clientId: this.options.clientId,
        clientSecret: this.options.clientSecret,
        refreshToken: this.token.refresh_token,
      });
      this.token = { ...this.token, ...fresh };
      await saveStoredToken(this.options.tokenFile, this.token);
    }
    return this.token.access_token;
  }

  async dataGet<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
    const url = new URL(`${DATA_API}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
    return this.request<T>(url.toString(), { method: "GET" });
  }

  async dataPost<T>(
    path: string,
    query: Record<string, string | undefined>,
    body: unknown,
  ): Promise<T> {
    const url = new URL(`${DATA_API}${path}`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
    return this.request<T>(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async dataPut<T>(
    path: string,
    query: Record<string, string | undefined>,
    body: unknown,
  ): Promise<T> {
    const url = new URL(`${DATA_API}${path}`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
    return this.request<T>(url.toString(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async analyticsGet<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
    const url = new URL(`${ANALYTICS_API}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
    return this.request<T>(url.toString(), { method: "GET" });
  }

  /** Upload image bytes as a video thumbnail (MIME type image/png or image/jpeg). */
  async setThumbnail(
    videoId: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<unknown> {
    const url = new URL(`${UPLOAD_API}/thumbnails/set`);
    url.searchParams.set("videoId", videoId);
    const token = await this.ensureAccessToken();
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
        "Content-Length": String(bytes.length),
      },
      body: Buffer.from(bytes),
    });
    if (!res.ok) {
      throw new Error(`YouTube thumbnail upload failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  // Typed helpers for specific endpoints.

  listMyUploads(maxResults = 25, pageToken?: string): Promise<VideoListResponse> {
    return this.listMyVideoIdsViaUploadsPlaylist(maxResults, pageToken);
  }

  private async listMyVideoIdsViaUploadsPlaylist(
    maxResults: number,
    pageToken?: string,
  ): Promise<VideoListResponse> {
    const channels = await this.dataGet<{ items: Channel[] }>("/channels", {
      part: "contentDetails",
      mine: "true",
    });
    const uploadsPlaylist =
      channels.items[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylist) {
      return { items: [] };
    }
    const playlistItems = await this.dataGet<{
      items: Array<{ contentDetails: { videoId: string } }>;
      nextPageToken?: string;
    }>("/playlistItems", {
      part: "contentDetails",
      playlistId: uploadsPlaylist,
      maxResults: String(maxResults),
      pageToken,
    });
    const ids = playlistItems.items.map((i) => i.contentDetails.videoId);
    if (ids.length === 0) return { items: [], nextPageToken: playlistItems.nextPageToken };
    const videos = await this.dataGet<{ items: Video[] }>("/videos", {
      part: "snippet,status,statistics,contentDetails",
      id: ids.join(","),
    });
    return { items: videos.items, nextPageToken: playlistItems.nextPageToken };
  }

  getVideo(videoId: string): Promise<{ items: Video[] }> {
    return this.dataGet("/videos", {
      part: "snippet,status,statistics,contentDetails",
      id: videoId,
    });
  }

  updateVideo(videoId: string, patch: Partial<Video>): Promise<Video> {
    const body = { id: videoId, ...patch };
    return this.dataPut<Video>("/videos", { part: Object.keys(patch).join(",") }, body);
  }

  deleteVideo(videoId: string): Promise<void> {
    const url = new URL(`${DATA_API}/videos`);
    url.searchParams.set("id", videoId);
    return this.request<void>(url.toString(), { method: "DELETE" });
  }

  createPlaylist(input: {
    title: string;
    description?: string;
    privacyStatus: "public" | "unlisted" | "private";
  }): Promise<Playlist> {
    return this.dataPost<Playlist>(
      "/playlists",
      { part: "snippet,status" },
      {
        snippet: { title: input.title, description: input.description ?? "" },
        status: { privacyStatus: input.privacyStatus },
      },
    );
  }

  addToPlaylist(input: { playlistId: string; videoId: string }): Promise<unknown> {
    return this.dataPost(
      "/playlistItems",
      { part: "snippet" },
      {
        snippet: {
          playlistId: input.playlistId,
          resourceId: { kind: "youtube#video", videoId: input.videoId },
        },
      },
    );
  }

  listComments(videoId: string, maxResults = 20): Promise<{ items: CommentThread[] }> {
    return this.dataGet("/commentThreads", {
      part: "snippet,replies",
      videoId,
      maxResults: String(maxResults),
      order: "time",
    });
  }

  replyToComment(parentId: string, text: string): Promise<unknown> {
    return this.dataPost(
      "/comments",
      { part: "snippet" },
      { snippet: { parentId, textOriginal: text } },
    );
  }

  moderateComment(commentId: string, moderationStatus: "heldForReview" | "published" | "rejected"): Promise<void> {
    const url = new URL(`${DATA_API}/comments/setModerationStatus`);
    url.searchParams.set("id", commentId);
    url.searchParams.set("moderationStatus", moderationStatus);
    return this.request<void>(url.toString(), { method: "POST" });
  }

  /** Upload a caption track for a video. Body is typically SRT or WebVTT text. */
  async insertCaption(params: {
    videoId: string;
    language: string;
    name: string;
    isDraft: boolean;
    body: Uint8Array;
    captionContentType: string;
  }): Promise<unknown> {
    const boundary = `youtube-mcp-${Date.now().toString(16)}`;
    const metadata = JSON.stringify({
      snippet: {
        videoId: params.videoId,
        language: params.language,
        name: params.name,
        isDraft: params.isDraft,
      },
    });
    const opening = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${params.captionContentType}\r\n\r\n`,
      "utf-8",
    );
    const closing = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
    const body = Buffer.concat([opening, Buffer.from(params.body), closing]);

    const url = new URL(`${UPLOAD_API}/captions`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("uploadType", "multipart");
    const token = await this.ensureAccessToken();
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    });
    if (!res.ok) {
      throw new Error(
        `YouTube caption insert failed: ${res.status} ${await res.text()}`,
      );
    }
    return res.json();
  }

  listCaptions(videoId: string): Promise<{
    items: Array<{
      id: string;
      snippet?: {
        name?: string;
        language?: string;
        status?: string;
        isDraft?: boolean;
        lastUpdated?: string;
        trackKind?: string;
      };
    }>;
  }> {
    return this.dataGet("/captions", { part: "snippet", videoId });
  }

  deleteCaption(captionId: string): Promise<void> {
    const url = new URL(`${DATA_API}/captions`);
    url.searchParams.set("id", captionId);
    return this.request<void>(url.toString(), { method: "DELETE" });
  }

  async analyticsQuery(params: {
    startDate: string;
    endDate: string;
    metrics: string;
    dimensions?: string;
    filters?: string;
    sort?: string;
    maxResults?: number;
  }): Promise<AnalyticsResponse> {
    return this.analyticsGet<AnalyticsResponse>("/reports", {
      ids: "channel==MINE",
      "start-date": params.startDate,
      "end-date": params.endDate,
      metrics: params.metrics,
      dimensions: params.dimensions,
      filters: params.filters,
      sort: params.sort,
      maxResults: params.maxResults ? String(params.maxResults) : undefined,
    });
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const token = await this.ensureAccessToken();
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`YouTube API ${res.status}: ${text || res.statusText}`);
    }
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }
}
