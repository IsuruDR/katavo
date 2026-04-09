import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import "dotenv/config";

import { generateQuestionsRoute } from "./routes/generateQuestions.js";
import { submitPodcastRoute, setJobManager } from "./routes/submitPodcast.js";
import { notifyCompleteRoute } from "./routes/notifyComplete.js";
import { revenuecatWebhookRoute } from "./routes/revenuecatWebhook.js";
import { startDeepDiveRoute } from "./routes/startDeepDive.js";
import { endDeepDiveRoute } from "./routes/endDeepDive.js";

const app = new Hono();

// Global CORS — acceptable for mobile API with JWT auth
app.use("*", cors());

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Routes
app.route("/api/generate-questions", generateQuestionsRoute);
app.route("/api/submit-podcast", submitPodcastRoute);
app.route("/api/notify-complete", notifyCompleteRoute);
app.route("/api/revenucat-webhook", revenuecatWebhookRoute);
app.route("/api/start-deep-dive", startDeepDiveRoute);
app.route("/api/end-deep-dive", endDeepDiveRoute);

// TODO: Wire job manager + crash recovery (Task 10)

const port = parseInt(process.env.PORT ?? "3000");
serve({ fetch: app.fetch, port });
console.log(`Server running on port ${port}`);

export { app };
