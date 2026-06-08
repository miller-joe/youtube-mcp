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
      "How many of the most recent uploads to scan (1–200, default 50). Each scanned video is classified as a Short by its duration (≤ 60s) after fetching; raising this scans deeper but costs more read quota.",
    ),
};

const getShortsAnalyticsSchema = {
  start_date: z
    .string()
    .describe("Report start date in YYYY-MM-DD format (inclusive). Required."),
  end_date: z
    .string()
    .describe(
      "Report end date in YYYY-MM-DD format (inclusive). Required. Recent days may be incomplete due to YouTube's analytics finalization delay.",
    ),
  metrics: z
    .string()
    .default("views,estimatedMinutesWatched,averageViewDuration,subscribersGained")
    .describe(
      "Comma-separated YouTube Analytics metric names. Defaults to 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained'.",
    ),
  dimensions: z
    .string()
    .optional()
    .describe(
      "Comma-separated dimensions to group rows by, e.g. 'day' for a time series. Omit (default) for a single Shorts-total row.",
    ),
  sort: z
    .string()
    .optional()
    .describe(
      "Sort spec referencing a requested metric/dimension; prefix '-' for descending, e.g. '-views'. Omit (default) for the API's natural order.",
    ),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe(
      "Cap on the number of returned rows, 1–500. Omit (default) to let the API return all matching rows.",
    ),
};

export function registerShortsTools(
  server: McpServer,
  client: YouTubeClient,
): void {
  server.tool(
    "list_my_shorts",
    "Lists the authenticated channel's recent Shorts by scanning the most recent uploads (up to max_candidates) and keeping videos with a duration ≤ 60s. Read-only; no mutations. Requires OAuth and costs YouTube Data API read units proportional to how many uploads are scanned (it pages through uploads in batches of 50). Returns a text list, one line per Short: video ID, title, duration in seconds, and view count, or a message that no Shorts were found. This is a heuristic (the Data API exposes no direct Shorts filter), so very recent or edge-case Shorts may be missed; use list_my_videos for all videos and get_shorts_analytics for Shorts performance stats.",
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
    "Queries the YouTube Analytics API for the authenticated channel restricted to Shorts, by forcing filters=creatorContentType==SHORTS on top of the supplied start_date/end_date/metrics/dimensions. Read-only; no mutations. Requires OAuth with the yt-analytics.readonly scope and uses YouTube Analytics API quota (separate from the Data API). Returns the raw Analytics response as pretty-printed JSON (column headers plus rows). Use this for Shorts-only performance reporting; use query_channel_analytics for whole-channel or custom-filtered reports, and list_my_shorts to enumerate the Shorts themselves.",
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
