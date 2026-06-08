import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YouTubeClient } from "../youtube/client.js";

const analyticsSchema = {
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe(
      "Report start date in YYYY-MM-DD format (inclusive). Required. Must be on or before end_date.",
    ),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe(
      "Report end date in YYYY-MM-DD format (inclusive). Required. Recent days may be incomplete as YouTube finalizes analytics with a delay.",
    ),
  metrics: z
    .string()
    .default("views,estimatedMinutesWatched,averageViewDuration,subscribersGained")
    .describe(
      "Comma-separated YouTube Analytics metric names (e.g. 'views,likes,estimatedMinutesWatched'). Defaults to 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained', the common creator-dashboard stats.",
    ),
  dimensions: z
    .string()
    .optional()
    .describe(
      "Comma-separated dimensions to group rows by, e.g. 'day', 'video', 'country'. Omit (default) for a single channel-total row.",
    ),
  filters: z
    .string()
    .optional()
    .describe(
      "YouTube Analytics filter expression, e.g. 'video==VIDEO_ID' to scope to one video or 'country==US'. Combine with ';'. Omit (default) for the whole channel.",
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
    .max(200)
    .optional()
    .describe(
      "Cap on the number of returned rows, 1–200. Omit (default) to let the API return all matching rows.",
    ),
};

export function registerAnalyticsTool(server: McpServer, client: YouTubeClient): void {
  server.tool(
    "query_channel_analytics",
    "Queries the YouTube Analytics API (reports endpoint, ids=channel==MINE) for the authenticated channel over a date range. Read-only; no mutations. Requires OAuth with the yt-analytics.readonly scope; uses YouTube Analytics API quota (separate from the Data API). Returns a plain-text table: a header row of column names followed by one row per result, '|'-separated, scoped by the supplied metrics/dimensions/filters. Use this for views/watch-time/retention/subscriber/traffic-source reporting across the channel; pass filters='video==VIDEO_ID' to scope to one video, or use get_shorts_analytics to report on Shorts only.",
    analyticsSchema,
    async (args) => {
      const res = await client.analyticsQuery({
        startDate: args.start_date,
        endDate: args.end_date,
        metrics: args.metrics,
        dimensions: args.dimensions,
        filters: args.filters,
        sort: args.sort,
        maxResults: args.max_results,
      });
      const header = res.columnHeaders.map((c) => c.name).join(" | ");
      const rows = res.rows.map((r) => r.join(" | "));
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Analytics ${args.start_date} → ${args.end_date}:`,
              "",
              header,
              "-".repeat(Math.max(10, header.length)),
              ...rows,
            ].join("\n"),
          },
        ],
      };
    },
  );
}
