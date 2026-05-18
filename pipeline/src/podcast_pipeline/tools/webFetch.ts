import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import {
  WEB_FETCH_MAX_CHARS_PER_URL,
  WEB_FETCH_MIN_EXTRACT_CHARS,
  WEB_FETCH_TIMEOUT_MS,
} from "../config.js";

export type FetchResult =
  | { success: true; url: string; content: string }
  | {
      success: false;
      url: string;
      reason: "http_error" | "timeout" | "paywall_or_thin" | "parse_error";
      detail?: string;
    };

export async function fetchAndExtract(url: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Some sites 403 default fetch agents; an honest UA usually clears it.
        "User-Agent":
          "Mozilla/5.0 (compatible; KatavoBot/1.0; +https://katavoapp.com/bot)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { success: false, url, reason: "http_error", detail: `status ${res.status}` };
    }
    const html = await res.text();
    let extracted: string;
    try {
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document as any);
      const article = reader.parse();
      extracted = article?.textContent?.trim() ?? "";
    } catch (err: any) {
      return { success: false, url, reason: "parse_error", detail: err?.message };
    }
    if (extracted.length < WEB_FETCH_MIN_EXTRACT_CHARS) {
      return { success: false, url, reason: "paywall_or_thin", detail: `${extracted.length} chars` };
    }
    return {
      success: true,
      url,
      content: extracted.slice(0, WEB_FETCH_MAX_CHARS_PER_URL),
    };
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === "AbortError") {
      return { success: false, url, reason: "timeout" };
    }
    return { success: false, url, reason: "http_error", detail: err?.message ?? String(err) };
  }
}
