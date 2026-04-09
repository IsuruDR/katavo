import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import "dotenv/config";

import { generateQuestionsRoute } from "./routes/generateQuestions.js";
import { submitPodcastRoute, setJobManager } from "./routes/submitPodcast.js";

const app = new Hono();

// Global CORS — acceptable for mobile API with JWT auth
app.use("*", cors());

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Routes
app.route("/api/generate-questions", generateQuestionsRoute);
app.route("/api/submit-podcast", submitPodcastRoute);

// TODO: Remaining routes (Tasks 6-8)
// TODO: Wire job manager + crash recovery (Task 10)

const port = parseInt(process.env.PORT ?? "3000");
serve({ fetch: app.fetch, port });
console.log(`Server running on port ${port}`);

export { app };
