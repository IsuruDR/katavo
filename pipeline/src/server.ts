import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import "dotenv/config";

import { generateQuestionsRoute } from "./routes/generateQuestions.js";

const app = new Hono();

// Global CORS — acceptable for mobile API with JWT auth
app.use("*", cors());

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Routes
app.route("/api/generate-questions", generateQuestionsRoute);

// TODO: Remaining routes (Tasks 5-8)
// TODO: Crash recovery (Task 10)

const port = parseInt(process.env.PORT ?? "3000");
serve({ fetch: app.fetch, port });
console.log(`Server running on port ${port}`);

export { app };
