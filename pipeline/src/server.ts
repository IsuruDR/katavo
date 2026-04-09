import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import "dotenv/config";

const app = new Hono();

// Global CORS — acceptable for mobile API with JWT auth
app.use("*", cors());

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// TODO: Route registration will be added in Chunk 2 (Tasks 4-8)
// TODO: Crash recovery will be added in Chunk 3 (Task 10)

const port = parseInt(process.env.PORT ?? "3000");
serve({ fetch: app.fetch, port });
console.log(`Server running on port ${port}`);

export { app };
