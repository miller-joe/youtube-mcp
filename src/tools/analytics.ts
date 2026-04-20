import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YouTubeClient } from "../youtube/client.js";

const analyticsSchema = {
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("YYYY-MM-DD (inclusive)"),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD (inclusive)"),
  metrics: z
    .string()
    .default("views,estimatedMinutesWatched,averageViewDuration,subscribersGained")
    .describe(
      "Comma-separated metric names (see YouTube Analytics API). Defaults cover the most common creator-dashboard stats.",
    ),
  dimensions: z
    .string()
    .optional()
    .describe(
      "Comma-separated dimensions, e.g. 'day', 'video', 'country'. Omit for channel totals.",
    ),
  filters: z
    .string()
    .optional()
    .describe(
      "Filter expression, e.g. 'video==VIDEO_ID' to scope to one video, or 'country==US'.",
    ),
  sort: z
    .string()
    .optional()
    .describe("Sort spec, e.g. '-views' for descending by views"),
  max_results: z.number().int().min(1).max(200).optional(),
};

export function registerAnalyticsTool(server: McpServer, client: YouTubeClient): void {
  server.tool(
    "query_channel_analytics",
    "Query YouTube Analytics for the authenticated channel. Returns tabular data — useful for views/watch-time/retention/traffic-source reports. Date-ranged and optionally grouped by dimensions.",
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
