/**
 * Auth middleware for Hono routes.
 *
 * Three patterns:
 * - userAuth: validates Supabase JWT, sets c.var.user
 * - webhookAuth: checks REVENUCAT_WEBHOOK_SECRET
 * - internalAuth: checks PIPELINE_CALLBACK_SECRET
 */

import { createMiddleware } from "hono/factory";
import { createClient, type User } from "@supabase/supabase-js";

type UserAuthEnv = {
  Variables: {
    user: User;
  };
};

/**
 * Validates Supabase JWT from Authorization header.
 * On success, attaches the authenticated user to `c.var.user`.
 */
export const userAuth = createMiddleware<UserAuthEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("user", user);
  await next();
});

/**
 * Checks Authorization header matches REVENUCAT_WEBHOOK_SECRET.
 */
export const webhookAuth = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (authHeader !== `Bearer ${process.env.REVENUCAT_WEBHOOK_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

/**
 * Checks Authorization header matches PIPELINE_CALLBACK_SECRET.
 */
export const internalAuth = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (authHeader !== `Bearer ${process.env.PIPELINE_CALLBACK_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});
