import { tool } from "@langchain/core/tools";
import { tavily } from "@tavily/core";
import { z } from "zod";

const tavilyClient = () => {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set");
  return tavily({ apiKey });
};

export interface TavilyToolOpts {
  taskId: string;
  maxSearches: number;
}

export function makeTavilyTool(opts: TavilyToolOpts) {
  let searchCount = 0;
  const client = tavilyClient();
  return tool(
    async ({ query }: { query: string }) => {
      if (++searchCount > opts.maxSearches) {
        return { error: "search_budget_exceeded", remaining: 0 };
      }
      try {
        const res: any = await client.search(query, {
          searchDepth: "advanced",
          includeRawContent: true,
          maxResults: 5,
        });
        return {
          query,
          results: (res.results ?? []).map((r: any) => ({
            url: r.url,
            title: r.title,
            content: r.raw_content ?? r.rawContent ?? r.content,
          })),
          searchesRemaining: opts.maxSearches - searchCount,
        };
      } catch (err: any) {
        return {
          error: "tavily_error",
          message: err?.message ?? String(err),
          searchesRemaining: opts.maxSearches - searchCount,
        };
      }
    },
    {
      name: "tavily_search",
      description:
        "Search the web for primary sources. Returns up to 5 results per call with full-page content where available.",
      schema: z.object({
        query: z
          .string()
          .describe("Concise search query targeting one specific aspect of the research question."),
      }),
    },
  );
}
