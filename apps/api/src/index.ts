import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";

import { createApp } from "./app.ts";
import { Chat } from "./chat.ts";
import { registerFrontend } from "./frontend.ts";
import { OpenClaw } from "./openclaw.ts";

const gateway = new OpenClaw(
  process.env.API_STATE_DIR ?? "/home/node/.assessment",
  process.env.GATEWAY_TOKEN_FILE ?? "/run/secrets/gateway_token",
);
const chat = new Chat(gateway);
const app = createApp(chat, process.env.APP_ORIGIN, process.env.DEV_ORIGIN);

registerFrontend(app, fileURLToPath(new URL("../../web/dist/", import.meta.url)));

const server = serve(
  {
    fetch: app.fetch,
    hostname: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 3000),
  },
  () => {
    console.log(
      JSON.stringify({ event: "http_listening", port: Number(process.env.PORT ?? 3000) }),
    );
  },
) as Server;

// Body/header deadlines also protect clients that never finish a request.
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;

gateway.start();

let stopping = false;

async function shutdown() {
  if (stopping) return;

  stopping = true;

  chat.close();
  server.close();
  await gateway.stop();
  server.closeAllConnections();
}

process.once("SIGTERM", () => {
  void shutdown();
});

process.once("SIGINT", () => {
  void shutdown();
});
