import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { createDeepAgent } from "deepagents";
import { makeOpenRouterModel } from "../../providers/openrouter.js";
import { makeTavilyTool } from "../../tools/tavilySearch.js";
import { makeExaTool } from "../../tools/exaSearch.js";
import { fetchAndExtract } from "../../tools/webFetch.js";
import {
  RESEARCH_MAX_TOKENS,
  RESEARCH_MODELS,
  RESEARCH_TEMPERATURES,
  SUBAGENT_WALLCLOCK_MS,
  WEB_FETCH_TOP_N,
} from "../../config.js";
import { SUBAGENT_SYSTEM_PROMPT, SUBAGENT_TASK_PROMPT } from "./prompts.js";
import type { SubagentTask, SearchResultKind } from "./types.js";
import { trackEvent } from "../../providers/telemetry.js";

export const FindingV2Schema = z.object({
  claim: z.string(),
  sourceUrls: z.array(z.string()),
  sourceTitles: z.array(z.string()),
});

export const SubagentFindingsV2Schema = z.object({
  taskId: z.string(),
  question: z.string(),
  findings: z.array(FindingV2Schema),
  status: z.enum(["complete", "partial", "failed"]),
  notes: z.string().optional(),
  // Parallel array to sourceUrls collected across all findings — same order, same length
  sourceKinds: z.array(z.string()).optional(),
});
export type SubagentFindingsV2 = z.infer<typeof SubagentFindingsV2Schema>;

export interface SubagentV2Opts {
  maxSearches: number;
  maxReflections: number;
  seenUrlSink?: Set<string>;
  userId?: string;
}

const timeoutAfter = (ms: number, label: string): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms));

async function invokeOnce(
  task: SubagentTask,
  opts: SubagentV2Opts,
  config?: RunnableConfig,
): Promise<SubagentFindingsV2> {
  const tool =
    task.searchProvider === "exa"
      ? makeExaTool({
          taskId: task.id,
          maxSearches: opts.maxSearches,
          seedUrls: task.seedUrls,
          seenUrlSink: opts.seenUrlSink,
        })
      : makeTavilyTool({
          taskId: task.id,
          maxSearches: opts.maxSearches,
          seenUrlSink: opts.seenUrlSink,
        });

  const llm = makeOpenRouterModel(RESEARCH_MODELS.subagent, {
    temperature: RESEARCH_TEMPERATURES.subagent,
    maxTokens: RESEARCH_MAX_TOKENS.subagent,
  });

  const systemPrompt = SUBAGENT_SYSTEM_PROMPT.replace("{maxSearches}", String(opts.maxSearches)).replace(
    "{maxReflections}",
    String(opts.maxReflections),
  );

  const taskMessage = SUBAGENT_TASK_PROMPT.replace("{question}", task.question)
    .replace("{context}", task.context)
    .replace("{searchHints}", task.searchHints.join("; "));

  const agent = createDeepAgent({
    model: llm,
    tools: [tool] as any,
    systemPrompt,
    responseFormat: SubagentFindingsV2Schema as any,
  });

  const initial = (await agent.invoke(
    { messages: [{ role: "user", content: taskMessage }] },
    config,
  )) as { structuredResponse?: SubagentFindingsV2 };

  if (!initial.structuredResponse) {
    throw new Error(`Subagent returned no structuredResponse for task ${task.id}`);
  }

  const findings = initial.structuredResponse;
  const allUrls = findings.findings.flatMap((f) => f.sourceUrls);
  const provider = task.searchProvider;

  if (!task.fetchCitedUrls || allUrls.length === 0) {
    return { ...findings, sourceKinds: allUrls.map(() => `${provider}-snippet` as SearchResultKind) };
  }

  // Pick top-N URLs by citation strength (count across findings)
  const urlCounts = new Map<string, number>();
  for (const url of allUrls) urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1);
  const topUrls = [...urlCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, WEB_FETCH_TOP_N)
    .map(([url]) => url);

  const fetchResults = await Promise.all(topUrls.map((u) => fetchAndExtract(u)));
  const fetchedUrls = new Set<string>();
  const fetchedArticles: string[] = [];
  for (const r of fetchResults) {
    if (opts.userId) {
      trackEvent(
        "research.subagent.fetch",
        { url: r.url, success: r.success, provider, reason: r.success ? null : r.reason },
        opts.userId,
      );
    }
    if (r.success) {
      fetchedUrls.add(r.url);
      fetchedArticles.push(`URL: ${r.url}\n\n${r.content}`);
    }
  }

  // Map every cited URL to its kind for downstream synthesis
  const sourceKinds: SearchResultKind[] = allUrls.map((url) =>
    fetchedUrls.has(url)
      ? (`${provider}-fetched` as SearchResultKind)
      : (`${provider}-snippet` as SearchResultKind),
  );

  // If at least one article was fetched, do a reflection pass to refine findings
  // using full article text rather than search snippets.
  if (fetchedArticles.length === 0) {
    return { ...findings, sourceKinds };
  }

  const reflectionPrompt =
    `${taskMessage}\n\n` +
    `You ran the initial search. Now you have the full text of the top cited articles:\n\n` +
    fetchedArticles.join("\n\n---\n\n") +
    `\n\n` +
    `Refine your findings using the article content above. Keep cited URLs the same — ` +
    `do not invent new sources. Output the same structured response shape.`;

  const refined = (await agent.invoke(
    {
      messages: [
        { role: "user", content: taskMessage },
        { role: "assistant", content: JSON.stringify(findings) },
        { role: "user", content: reflectionPrompt },
      ],
    },
    config,
  )) as { structuredResponse?: SubagentFindingsV2 };

  const finalFindings = refined.structuredResponse ?? findings;
  // Rebuild sourceKinds against the refined URL set
  const refinedUrls = finalFindings.findings.flatMap((f) => f.sourceUrls);
  const refinedKinds: SearchResultKind[] = refinedUrls.map((url) =>
    fetchedUrls.has(url)
      ? (`${provider}-fetched` as SearchResultKind)
      : (`${provider}-snippet` as SearchResultKind),
  );
  return { ...finalFindings, sourceKinds: refinedKinds };
}

export async function runSubagentV2(
  task: SubagentTask,
  opts: SubagentV2Opts,
  config?: RunnableConfig,
): Promise<SubagentFindingsV2> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await Promise.race([
        invokeOnce(task, opts, config),
        timeoutAfter(SUBAGENT_WALLCLOCK_MS, `subagent_wallclock_exceeded_${task.id}`),
      ]);
      if (result.status !== "failed") return result;
      if (attempt === 2) return result;
    } catch (err: any) {
      if (attempt === 2) {
        const message = err?.message ?? String(err);
        return {
          taskId: task.id,
          question: task.question,
          findings: [],
          status: "failed",
          notes: `Subagent threw on retry: ${message}`,
          sourceKinds: [],
        };
      }
    }
  }
  throw new Error("runSubagentV2 fell through retry loop");
}
