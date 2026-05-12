/**
 * POST /api/cron/expansion-prompts
 *
 * Internal endpoint to invoke the expansion-prompts scan. Used for:
 *   - Manual testing (curl with PIPELINE_CALLBACK_SECRET)
 *   - Future pg_cron migration target (when we scale beyond 1 Railway instance)
 *
 * Auth: internalAuth middleware (PIPELINE_CALLBACK_SECRET)
 */
import { Hono } from "hono";
import { internalAuth } from "../middleware/auth.js";
import { runExpansionPromptsScan } from "../jobs/expansionPromptsScan.js";

const route = new Hono();

route.post("/", internalAuth, async (c) => {
  try {
    const result = await runExpansionPromptsScan();
    return c.json(result);
  } catch (err) {
    console.error("[cron-expansion-prompts] scan failed:", err);
    return c.json({ error: "Scan failed" }, 500);
  }
});

export { route as cronExpansionPromptsRoute };
