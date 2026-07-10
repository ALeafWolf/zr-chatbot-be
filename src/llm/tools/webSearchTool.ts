import { z } from "zod";
import { env } from "../../config/env";
import type { ToolDef } from "./types";

const Params = z.object({
  query: z.string().min(1),
  max_results: z.number().int().min(1).max(10).default(5),
});

export type WebSearchArgs = z.infer<typeof Params>;

export interface WebSearchResult extends Record<string, unknown> {
  digest: string;
  answer?: string;
  error?: string;
}

async function fetchTavily(
  query: string,
  maxResults: number,
  signal: AbortSignal,
): Promise<WebSearchResult> {
  const key = env.TAVILY_API_KEY;
  if (!key) {
    return {
      digest: "",
      error: "web_search_unavailable",
    };
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });

  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: maxResults,
        search_depth: "basic",
        include_answer: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        digest: "",
        error: `tavily_http_${res.status}`,
        rawBody: text.slice(0, 500),
      } as WebSearchResult;
    }

    const json = (await res.json()) as {
      answer?: string;
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };

    const top = (json.results ?? []).slice(0, 3);
    const lines = top.map((r, i) => {
      const title = r.title ?? "(untitled)";
      const snippet = (r.content ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
      const url = r.url ?? "";
      return `${i + 1}. ${title}\n   ${snippet}\n   ${url}`;
    });

    const digest = [json.answer ? `概要：${json.answer}` : null, lines.join("\n\n")]
      .filter(Boolean)
      .join("\n\n");

    return { digest, answer: json.answer };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      digest: "",
      error: `tavily_fetch_failed:${msg}`,
    };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}

export const webSearchTool: ToolDef<WebSearchArgs, WebSearchResult> = {
  name: "web_search",
  description:
    "Search the public web for real-time facts (weather, news, dates). Use sparingly and prefer in-character relevance.",
  parameters: Params,
  async execute(args, ctx) {
    const parsed = Params.parse(args);
    if (!env.TAVILY_API_KEY) {
      return { digest: "", error: "web_search_unavailable" };
    }
    return fetchTavily(parsed.query, parsed.max_results, ctx.signal);
  },
  summarize(_args, result) {
    if (result.error === "web_search_unavailable") {
      return "Web search is not configured.";
    }
    if (result.error) {
      return `Search failed: ${result.error}`;
    }
    const preview = result.digest.replace(/\s+/g, " ").trim().slice(0, 240);
    return preview.length ? preview : "No useful results.";
  },
};
