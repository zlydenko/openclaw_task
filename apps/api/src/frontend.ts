import { existsSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";

import type { ApiApp } from "./types.ts";

export function registerFrontend(app: ApiApp, root: string) {
  if (!existsSync(join(root, "index.html"))) return;

  app.use("*", async (c, next) => {
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    c.header("Referrer-Policy", "no-referrer");

    await next();
  });

  app.get("/", serveStatic({ path: join(root, "index.html") }));
  app.get("/index.html", serveStatic({ path: join(root, "index.html") }));
  app.get("/theme.js", serveStatic({ root }));
  app.get("/assets/*", serveStatic({ root }));
}
