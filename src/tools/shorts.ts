import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YouTubeClient } from "../youtube/client.js";
import type { Video } from "../youtube/types.js";

/** Parse an ISO 8601 duration (e.g. PT1M30S, PT58S) into total seconds. */
function parseIsoDurationSeconds(duration: string | undefined): number | null {
  if (!duration) return null;
  const m = duration.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return null;
  const days = Number(m[1] ?? 0);
  const hours = Number(m[2] ?? 0);
  const minutes = Number(m[3] ?? 0);
  const seconds = Number(m[4] ?? 0);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

const SHORTS_THRESHOLD_SECONDS = 60;

const listMyShortsSchema = {
  max_candidates: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe(
      "How many of the most recent uploads to scan. Shorts are detected by duration ≤ 60s after fetching.",
    ),
};

const getShortsAnalyticsSchema = {
  start_date: z
    .string()
    .describe("YYYY-MM-DD start date (inclusive)."),
  end_date: z
    .string()
    .describe("YYYY-MM-DD end date (inclusive)."),
  metrics: z
    .string()
    .default("views,estimatedMinutesWatched,averageViewDuration,subscribersGained")
    .describe("Comma-separated YouTube Analytics metrics."),
  dimensions: z
    .string()
    .optional()
    .describe("Optional dimensions, e.g. 'day' for a time series."),
  sort: z.string().optional(),
  max_results: z.number().int().min(1).max(500).optional(),
};

export function registerShortsTools(
  server: McpServer,
  client: YouTubeClient,
): void {
  server.tool(
    "list_my_shorts",
    "List your recent Shorts — scans the most recent uploads and filters to videos ≤60s. Useful when the Data API doesn't expose a direct Shorts filter.",
    listMyShortsSchema,
    async (args) => {
      const collected: Array<{ video: Video; seconds: number }> = [];
      let pageToken: string | undefined;
      let scanned = 0;
      while (scanned < args.max_candidates) {
        const batch = Math.min(50, args.max_candidates - scanned);
        const res = await client.listMyUploads(batch, pageToken);
        for (const v of res.items) {
          const s = parseIsoDurationSeconds(v.contentDetails?.duration);
          if (s !== null && s <= SHORTS_THRESHOLD_SECONDS) {
            collected.push({ video: v, seconds: s });
          }
        }
        scanned += res.items.length;
        if (!res.nextPageToken || res.items.length === 0) break;
        pageToken = res.nextPageToken;
      }
      if (collected.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No Shorts found in the most recent ${scanned} upload(s).`,
            },
          ],
        };
      }
      const lines = [
        `Found ${collected.length} Short(s) in the most recent ${scanned} upload(s):`,
        ...collected.map(({ video, seconds }) => {
          const title = video.snippet?.title ?? "(untitled)";
          const views = video.statistics?.viewCount ?? "0";
          return `  ${video.id} — ${title} [${seconds}s, ${views} views]`;
        }),
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "get_shorts_analytics",
    "Query YouTube Analytics restricted to Shorts for the authenticated channel. Applies filters=creatorContentType==SHORTS on top of the usual start_date/end_date/metrics/dimensions knobs.",
    getShortsAnalyticsSchema,
    async (args) => {
      const res = await client.analyticsQuery({
        startDate: args.start_date,
        endDate: args.end_date,
        metrics: args.metrics,
        dimensions: args.dimensions,
        filters: "creatorContentType==SHORTS",
        sort: args.sort,
        maxResults: args.max_results,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    },
  );
}
