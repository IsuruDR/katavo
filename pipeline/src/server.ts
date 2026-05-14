import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { setMaxListeners } from "node:events";
import "dotenv/config";

// Bounded-parallel TTS workers + LangGraph + Gemini SDK each attach abort
// listeners on shared signals during concurrent operations. The default
// Node ceiling of 10 trips MaxListenersExceededWarning even though no
// real leak exists. Bump it once at boot; functional limit was never
// the actual concern here.
setMaxListeners(20);

import { generateQuestionsRoute } from "./routes/generateQuestions.js";
import { issueShareTokenRoute } from "./routes/issueShareToken.js";
import { submitPodcastRoute, setJobManager } from "./routes/submitPodcast.js";
import { notifyCompleteRoute } from "./routes/notifyComplete.js";
import { revenuecatWebhookRoute } from "./routes/revenuecatWebhook.js";
import { startDeepDiveRoute } from "./routes/startDeepDive.js";
import { endDeepDiveRoute } from "./routes/endDeepDive.js";
import { cronExpansionPromptsRoute } from "./routes/cronExpansionPrompts.js";
import { createJobManager } from "./jobs/jobManager.js";
import { runExpansionPromptsScan } from "./jobs/expansionPromptsScan.js";

const app = new Hono();

// Global CORS — acceptable for mobile API with JWT auth
app.use("*", cors());

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Routes
app.route("/api/generate-questions", generateQuestionsRoute);
app.route("/api/share-podcast", issueShareTokenRoute);
app.route("/api/submit-podcast", submitPodcastRoute);
app.route("/api/notify-complete", notifyCompleteRoute);
app.route("/api/revenucat-webhook", revenuecatWebhookRoute);
app.route("/api/start-deep-dive", startDeepDiveRoute);
app.route("/api/end-deep-dive", endDeepDiveRoute);
app.route("/api/cron/expansion-prompts", cronExpansionPromptsRoute);

// Job manager — in-process pipeline execution with retry + backoff
const jobManager = createJobManager();
setJobManager(jobManager);

// Crash recovery — re-enqueue stuck podcasts after a short startup delay
const RECOVERY_DELAY_MS = 5_000;
setTimeout(async () => {
  try {
    const recovered = await jobManager.recoverStuckJobs();
    if (recovered > 0) {
      console.log(`Crash recovery: re-enqueued ${recovered} stuck job(s)`);
    }
  } catch (err) {
    console.error("Crash recovery failed:", err);
  }
}, RECOVERY_DELAY_MS);

const port = parseInt(process.env.PORT ?? "3000");
serve({ fetch: app.fetch, port });
console.log(`Server running on port ${port}`);

const HOUR_MS = 60 * 60 * 1000;
setInterval(async () => {
  try {
    const result = await runExpansionPromptsScan();
    if (result.sent > 0 || result.skipped > 0) {
      console.log(`[expansion-prompts cron] sent=${result.sent} skipped=${result.skipped}`);
    }
  } catch (err) {
    console.error("[expansion-prompts cron] failed:", err);
  }
}, HOUR_MS);

export { app };
