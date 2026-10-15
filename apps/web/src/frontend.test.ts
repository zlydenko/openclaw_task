import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { expect, it } from "vitest";

import { createApp } from "../../api/src/app.ts";
import type { Chat } from "../../api/src/chat.ts";
import { registerFrontend } from "../../api/src/frontend.ts";

it("serves the frontend through Hono while preserving API errors and origin checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "assessment-web-"));
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep + "assessment-web-")) {
    throw new Error("Unexpected test directory.");
  }

  try {
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), "<!doctype html><title>OpenClaw</title>");
    await writeFile(join(root, "assets/app.js"), "export const ready = true;");
    const app = createApp({} as Chat);
    registerFrontend(app, root);
    const request = (path: string, headers: Record<string, string> = {}) =>
      app.request("http://localhost:3000" + path, {
        headers: { host: "localhost:3000", ...headers },
      });

    const index = await request("/");
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(index.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await index.text()).toContain("OpenClaw");
    expect((await request("/assets/app.js")).status).toBe(200);

    const api = await request("/api/missing");
    expect(api.status).toBe(404);
    expect((await api.json()).error.code).toBe("NOT_FOUND");
    expect((await request("/assets/missing.js")).status).toBe(404);
    expect((await request("/", { origin: "https://untrusted.example" })).status).toBe(400);
    expect((await request("/.local/gateway_token")).status).toBe(404);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
