import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { GatewayClient, GatewayClientRequestError } from "@openclaw/gateway-client";
import { afterEach, expect, it, vi } from "vitest";

import { createApp } from "../../api/src/app.ts";
import { Chat } from "../../api/src/chat.ts";
import { OpenClaw } from "../../api/src/openclaw.ts";
import { sessionKey } from "../../api/src/gateway/messages.ts";
import type { ConfigSnapshot, JsonRecord } from "../../api/src/types.ts";
import { SettingsController } from "./settings.ts";

const disposals: (() => void | Promise<void>)[] = [];
const hash = (content: string) => createHash("sha256").update(content).digest("hex");
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fixture(scopes?: string[]) {
  const directory = await mkdtemp(join(tmpdir(), "assessment-settings-"));
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + "assessment-settings-"))
    throw new Error("Unexpected test directory");
  await writeFile(join(directory, "bootstrap"), "fixture-secret");
  if (scopes)
    await writeFile(
      join(directory, "token.json"),
      JSON.stringify({ token: "saved-chat-token", scopes }),
    );
  const gateway = new OpenClaw(directory, join(directory, "bootstrap"));
  gateway.authenticated = true;
  gateway.settingsAdmin = true;
  const snapshot: ConfigSnapshot = {
    valid: true,
    hash: "base-1",
    configRevisionHash: "revision-1",
    appliedConfigHash: "revision-1",
    config: {
      gateway: {
        reload: { mode: "hybrid" },
        bind: "lan",
        port: 18789,
        auth: { mode: "token", token: "fixture-secret" },
      },
      agents: {
        entries: { main: {} },
        defaults: {
          model: {
            primary: "openrouter/moonshotai/kimi-k2-thinking",
            fallbacks: ["keep-fallback"],
          },
          imageModel: "openrouter/google/gemini-2.5-flash-lite",
          models: { "openrouter/moonshotai/kimi-k2-thinking": { custom: "retain" } },
        },
      },
      models: {
        providers: {
          openrouter: {
            apiKey: "fixture-secret",
            models: [
              {
                id: "moonshotai/kimi-k2-thinking",
                api: "custom-transport",
                custom: "retain",
                maxTokens: 4096,
              },
            ],
          },
        },
      },
      tools: {
        profile: "full",
        toolSearch: true,
        deny: ["unknown-future-tool"],
        codeMode: { enabled: "auto", executor: "quickjs" },
        elevated: { enabled: false },
      },
      browser: { enabled: true },
      cron: { enabled: false },
    },
  };
  const files = new Map<string, string>([
    ["USER.md", "# User\n"],
    ["MEMORY.md", "# Memory\n"],
  ]);
  let patchBehavior: ((input: JsonRecord) => Promise<unknown>) | null = null;
  let fileBehavior: ((input: JsonRecord) => Promise<unknown>) | null = null;
  const request = vi
    .spyOn(GatewayClient.prototype, "request")
    .mockImplementation(async (method, params, options) => {
      const input = params as JsonRecord;
      if (method === "config.get") return structuredClone(snapshot) as never;
      if (method === "config.schema.lookup")
        return { schema: { type: "object" }, reloadKind: "hot" } as never;
      if (method === "tools.catalog")
        return {
          groups: [
            {
              tools: [
                { id: "read", label: "Read", description: "Read files" },
                { id: "write", label: "Write" },
                { id: "image", label: "Image" },
                { id: "cron", label: "Scheduler" },
              ],
            },
          ],
        } as never;
      if (method === "sessions.list") return { sessions: [] } as never;
      if (method === "config.patch") {
        options?.onSent?.("request");
        if (patchBehavior) return (await patchBehavior(input)) as never;
        return { ok: true, hash: snapshot.hash } as never;
      }
      if (method === "agents.files.get") {
        const content = files.get(String(input.name));
        return {
          file: {
            name: input.name,
            missing: content === undefined,
            ...(content === undefined
              ? {}
              : { content, hash: hash(content), size: Buffer.byteLength(content) }),
          },
        } as never;
      }
      if (method === "agents.files.set") {
        options?.onSent?.("request");
        if (fileBehavior) return (await fileBehavior(input)) as never;
        files.set(String(input.name), String(input.content));
        return { ok: true } as never;
      }
      if (method === "sessions.messages.subscribe" || method === "sessions.messages.unsubscribe")
        return {} as never;
      if (method === "chat.send") {
        options?.onSent?.("request");
        return { runId: "active-fixture-run" } as never;
      }
      return {} as never;
    });
  const chat = new Chat(gateway);
  chat.ready = true;
  const app = createApp(chat);
  const http = (
    path: string,
    method = "GET",
    body?: object,
    headers: Record<string, string> = {},
  ) =>
    app.request("http://localhost:3000" + path, {
      method,
      headers: {
        host: "localhost:3000",
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const count = (method: string) => request.mock.calls.filter(([name]) => name === method).length;
  vi.stubGlobal("fetch", (url: string, options?: RequestInit) =>
    app.request("http://localhost:3000" + url, {
      ...options,
      headers: { ...options?.headers, host: "localhost:3000" },
    }),
  );
  disposals.push(async () => {
    chat.close();
    await gateway.stop();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    chat,
    gateway,
    snapshot,
    files,
    request,
    http,
    count,
    patch: (fn: typeof patchBehavior) => {
      patchBehavior = fn;
    },
    file: (fn: typeof fileBehavior) => {
      fileBehavior = fn;
    },
  };
}

it("projects safe settings, enforces permissions and payload limits, and keeps chat available without admin", async () => {
  const f = await fixture();
  f.gateway.settingsAdmin = false;
  const response = await f.http("/api/settings");
  const data = await response.json();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(JSON.stringify(data)).not.toContain("fixture-secret");
  expect(JSON.stringify(data)).not.toContain("apiKey");
  expect(data.canEdit).toBe(false);
  expect(
    (await f.http("/api/settings", "PATCH", { baseHash: "base-1", toolChanges: { read: false } }))
      .status,
  ).toBe(403);
  expect((await f.http("/ready")).status).toBe(200);
  expect((await f.http("/api/conversations", "POST", {})).status).toBe(201);
  expect(
    (await f.http("/api/settings", "PATCH", { baseHash: "base-1", raw: "forbidden" })).status,
  ).toBe(400);
  expect(
    (
      await f.http("/api/settings", "PATCH", {
        baseHash: "base-1",
        toolChanges: Object.fromEntries(Array.from({ length: 129 }, (_, i) => ["tool" + i, false])),
      })
    ).status,
  ).toBe(400);
  expect(
    (await f.http("/api/settings", "PATCH", { baseHash: "base-1", extra: "x".repeat(17000) }))
      .status,
  ).toBe(413);
  expect(
    (
      await f.http(
        "/api/settings",
        "PATCH",
        { baseHash: "base-1" },
        { origin: "https://untrusted.example" },
      )
    ).status,
  ).toBe(400);
  expect(f.count("config.patch")).toBe(0);
});

it("serializes model/tool application with chat admission and preserves unrelated config and exact denies", async () => {
  const f = await fixture();
  const id = f.chat.create().id;
  let finish!: () => void;
  f.patch(async (input) => {
    const patch = JSON.parse(String(input.raw));
    expect(patch.tools.deny).toEqual(["unknown-future-tool", "read"]);
    expect(input.replacePaths).toEqual(["tools.deny"]);
    expect(patch.agents.defaults.model).toEqual({
      primary: "openrouter/qwen/qwen3.7-flash",
      fallbacks: ["keep-fallback"],
    });
    expect(patch.models.providers.openrouter.models[0]).toMatchObject({
      id: "qwen/qwen3.7-flash",
      api: "openai-completions",
      maxTokens: 4096,
    });
    expect(patch.models.providers.openrouter.apiKey).toBeUndefined();
    await new Promise<void>((done) => {
      finish = done;
    });
    const defaults = (f.snapshot.config.agents as JsonRecord).defaults as JsonRecord;
    defaults.model = patch.agents.defaults.model;
    (f.snapshot.config.tools as JsonRecord).deny = patch.tools.deny;
    f.snapshot.hash = "base-2";
    f.snapshot.configRevisionHash = "revision-2";
    f.snapshot.appliedConfigHash = "revision-2";
    return { ok: true, hash: "base-2" };
  });
  const applying = f.http("/api/settings", "PATCH", {
    baseHash: "base-1",
    chatModel: "openrouter/qwen/qwen3.7-flash",
    toolChanges: { read: false },
  });
  await vi.waitFor(() => expect(f.count("config.patch")).toBe(1));
  expect((await (await f.http("/ready")).json()).gateway).toMatchObject({
    tone: "amber",
    label: "Updating settings…",
  });
  await expect(f.chat.send(id, crypto.randomUUID(), "Must wait")).rejects.toMatchObject({
    code: "SETTINGS_BUSY",
  });
  expect(
    (
      await f.http("/api/settings/files/USER.md", "PUT", {
        content: "no",
        expectedHash: hash("# User\n"),
      })
    ).status,
  ).toBe(409);
  expect(f.count("chat.send")).toBe(0);
  finish();
  expect((await applying).status).toBe(200);
  expect((await (await f.http("/ready")).json()).gateway.tone).toBe("green");
  expect(
    (await f.http("/api/settings", "PATCH", { baseHash: "base-1", toolChanges: { read: true } }))
      .status,
  ).toBe(409);
  expect(f.count("config.patch")).toBe(1);
  f.patch(async (input) => {
    const patch = JSON.parse(String(input.raw));
    expect(patch).toEqual({ tools: { deny: ["unknown-future-tool"] } });
    (f.snapshot.config.tools as JsonRecord).deny = patch.tools.deny;
    f.snapshot.hash = "base-3";
    f.snapshot.configRevisionHash = "revision-3";
    f.snapshot.appliedConfigHash = "revision-3";
    return { ok: true, hash: "base-3" };
  });
  await f.http("/api/settings", "PATCH", { baseHash: "base-2", toolChanges: { read: true } });
  expect(f.count("config.patch")).toBe(2);
});

it("waits for pending and active application turns, preserves drafts, and never applies when a turn finishes", async () => {
  const f = await fixture();
  const browser = new SettingsController();
  await browser.refresh();
  browser.changeModel("chatModel", "openrouter/qwen/qwen3.7-flash");
  const id = f.chat.create().id;
  await f.chat.send(id, crypto.randomUUID(), "Active turn");
  await browser.refresh();
  expect(browser.snapshot().current?.admission.activeTurns).toBe(1);
  await browser.apply();
  expect(f.count("config.patch")).toBe(0);
  expect(
    (await f.http("/api/settings", "PATCH", { baseHash: "base-1", toolChanges: { read: false } }))
      .status,
  ).toBe(409);
  expect(browser.snapshot().chatModel).toBe("openrouter/qwen/qwen3.7-flash");
  expect((await (await f.http("/ready")).json()).gateway.tone).toBe("green");
  const client = Reflect.get(f.gateway, "client");
  client.opts.onEvent({
    event: "chat",
    payload: {
      sessionKey: sessionKey(id),
      runId: "active-fixture-run",
      seq: 1,
      state: "final",
      message: { role: "assistant", content: "Finished" },
    },
  });
  await browser.refresh();
  expect(browser.snapshot().current?.admission.activeTurns).toBe(0);
  expect(browser.snapshot().current?.canApply).toBe(true);
  expect(browser.snapshot().chatModel).toBe("openrouter/qwen/qwen3.7-flash");
  expect(f.count("config.patch")).toBe(0);
});

it("keeps uncertain application locked until native active revision evidence resolves it without a write retry", async () => {
  const f = await fixture();
  f.patch(async () => {
    (f.snapshot.config.tools as JsonRecord).deny = ["unknown-future-tool", "read"];
    f.snapshot.hash = "base-2";
    f.snapshot.configRevisionHash = "revision-2";
    throw new Error("Lost acknowledgement with private upstream detail");
  });
  expect(
    (await f.http("/api/settings", "PATCH", { baseHash: "base-1", toolChanges: { read: false } }))
      .status,
  ).toBe(503);
  let status = await (await f.http("/api/settings")).json();
  expect(status.gateway).toMatchObject({ tone: "amber", label: "Settings unconfirmed" });
  expect(status.canApply).toBe(false);
  expect((await f.http("/ready")).status).toBe(503);
  f.snapshot.appliedConfigHash = "revision-2";
  status = await (await f.http("/api/settings")).json();
  expect(status.gateway.tone).toBe("green");
  expect((await f.http("/ready")).status).toBe(200);
  expect(f.count("config.patch")).toBe(1);
  f.gateway.restarting = true;
  expect(f.chat.settings.indicator()).toMatchObject({ tone: "amber", label: "Reloading agent…" });
  f.gateway.restarting = false;
  f.gateway.authenticated = false;
  expect(f.chat.settings.indicator().tone).toBe("red");
  f.gateway.authenticated = true;
  f.chat.ready = false;
  expect(f.chat.settings.indicator().label).toBe("Recovering…");
});

it("uses native whole-file guards, accepts empty content, rejects arbitrary files and oversized bytes, and reconciles a lost save acknowledgement", async () => {
  const f = await fixture();
  const original = await (await f.http("/api/settings/files/USER.md")).json();
  expect(original).toEqual({
    name: "USER.md",
    content: "# User\n",
    size: 7,
    hash: hash("# User\n"),
    missing: false,
  });
  expect(
    (
      await f.http("/api/settings/files/USER.md", "PUT", {
        content: "",
        expectedHash: original.hash,
      })
    ).status,
  ).toBe(200);
  expect(f.files.get("USER.md")).toBe("");
  expect(
    (
      await f.http("/api/settings/files/USER.md", "PUT", {
        content: "stale",
        expectedHash: original.hash,
      })
    ).status,
  ).toBe(409);
  expect((await f.http("/api/settings/files/OTHER.md")).status).toBe(404);
  expect((await f.http("/api/settings/files/USER.md", "PUT", { content: "no guard" })).status).toBe(
    400,
  );
  expect(
    (
      await f.http("/api/settings/files/USER.md", "PUT", {
        content: "é".repeat(33000),
        expectedHash: hash(""),
      })
    ).status,
  ).toBe(413);
  f.files.set("MEMORY.md", "x".repeat(65537));
  expect((await f.http("/api/settings/files/MEMORY.md")).status).toBe(413);
  f.files.delete("MEMORY.md");
  expect((await (await f.http("/api/settings/files/MEMORY.md")).json()).missing).toBe(true);
  expect(f.files.has("MEMORY.md")).toBe(false);
  f.file(async (input) => {
    f.files.set(String(input.name), String(input.content));
    throw new Error("Lost acknowledgement");
  });
  const saved = await f.http("/api/settings/files/MEMORY.md", "PUT", {
    content: "# Private memory\n",
    expectedMissing: true,
  });
  expect(saved.status).toBe(200);
  expect((await saved.json()).hash).toBe(hash("# Private memory\n"));
  expect(f.count("agents.files.set")).toBe(2);
  expect(f.chat.settings.indicator().tone).toBe("green");
});

it("preserves both file drafts during navigation and conflict comparison without retrying writes", async () => {
  const f = await fixture();
  const browser = new SettingsController();
  await browser.refresh();
  await browser.loadFile("USER.md");
  await browser.loadFile("MEMORY.md");
  browser.editFile("USER.md", "Owner draft");
  browser.editFile("MEMORY.md", "Memory draft");
  f.files.set("USER.md", "Changed by agent");
  await browser.saveFile("USER.md");
  expect(browser.snapshot().files["USER.md"].draft).toBe("Owner draft");
  await browser.loadFile("USER.md");
  expect(browser.snapshot().files["USER.md"].current?.content).toBe("Changed by agent");
  browser.setVisible(false);
  await browser.refresh();
  expect(browser.snapshot().files["MEMORY.md"].draft).toBe("Memory draft");
  expect(f.count("agents.files.set")).toBe(0);
  browser.discardFile("USER.md");
  expect(browser.snapshot().files["USER.md"].draft).toBe("Changed by agent");
});

it("rejects service restrictions, broad policies, unreviewed models, and native conflicts without enabling services", async () => {
  const f = await fixture();
  for (const change of [
    { toolChanges: { cron: true } },
    { toolChanges: { nonexistent: false } },
    { chatModel: "openrouter/unknown" },
    { imageModel: "openrouter/moonshotai/kimi-k2-thinking" },
  ])
    expect((await f.http("/api/settings", "PATCH", { baseHash: "base-1", ...change })).status).toBe(
      400,
    );
  (f.snapshot.config.tools as JsonRecord).deny = ["group:fs", "unknown-future-tool"];
  expect(
    (await f.http("/api/settings", "PATCH", { baseHash: "base-1", toolChanges: { read: true } }))
      .status,
  ).toBe(400);
  expect(f.count("config.patch")).toBe(0);
  f.patch(async () => {
    throw new GatewayClientRequestError({
      code: "INVALID_REQUEST",
      message: "private native conflict",
    });
  });
  const response = await f.http("/api/settings", "PATCH", {
    baseHash: "base-1",
    chatModel: "openrouter/qwen/qwen3.7-flash",
  });
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain("private native conflict");
  expect((await f.http("/ready")).status).toBe(200);
});

it("creates missing startup files independently, preserves empty files, and refuses unsafe workspace paths", async () => {
  const modulePath = pathToFileURL(resolve("../../docker/initialize-workspace.mjs")).href;
  const { initializeWorkspace } = await import(/* @vite-ignore */ modulePath);
  const directory = await mkdtemp(join(tmpdir(), "assessment-settings-startup-"));
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + "assessment-settings-startup-"))
    throw new Error("Unexpected test directory");
  disposals.push(() => rm(directory, { recursive: true, force: true }));
  const workspace = join(directory, "workspace");
  await writeFile(
    join(directory, "openclaw.json"),
    JSON.stringify({ agents: { entries: { main: { workspace } } } }),
  );
  await initializeWorkspace(directory);
  expect(await readFile(join(workspace, "USER.md"), "utf8")).toBe("# User\n");
  await writeFile(join(workspace, "USER.md"), "");
  await rm(join(workspace, "MEMORY.md"));
  await initializeWorkspace(directory);
  expect(await readFile(join(workspace, "USER.md"), "utf8")).toBe("");
  expect(await readFile(join(workspace, "MEMORY.md"), "utf8")).toBe("# Memory\n");
  await writeFile(
    join(directory, "openclaw.json"),
    JSON.stringify({ agents: { entries: { main: { workspace: dirnameOutside(directory) } } } }),
  );
  await expect(initializeWorkspace(directory)).rejects.toThrow("unsafe target");
});

const dirnameOutside = (directory: string) => resolve(directory, "..");

it("does not claim application from an acknowledgement and healthy revision when requested values do not match", async () => {
  const f = await fixture();
  expect(
    (await f.http("/api/settings", "PATCH", { baseHash: "base-1", toolChanges: { read: false } }))
      .status,
  ).toBe(503);
  expect((await (await f.http("/api/settings")).json()).phase).toBe("unconfirmed");
  expect((await f.http("/ready")).status).toBe(503);
  expect(f.count("config.patch")).toBe(1);
});

it("exposes unresolved submission state without declaring the run active or permitting settings writes", async () => {
  const f = await fixture();
  const id = f.chat.create().id;
  vi.spyOn(f.gateway, "send").mockImplementation(async (_id, _request, _text, sent) => {
    sent();
    throw new Error("Lost send acknowledgement");
  });
  await expect(f.chat.send(id, crypto.randomUUID(), "Uncertain turn")).rejects.toMatchObject({
    code: "SUBMISSION_UNKNOWN",
  });
  const data = await (await f.http("/api/settings")).json();
  expect(data.admission.unresolved).toBe(true);
  expect(data.canApply).toBe(false);
  expect(
    (await f.http("/api/settings", "PATCH", { baseHash: "base-1", toolChanges: { read: false } }))
      .status,
  ).toBe(409);
  expect(f.count("config.patch")).toBe(0);
});

it("blocks settings and file saves across three active application conversations", async () => {
  const f = await fixture();
  const ids = Array.from({ length: 3 }, () => f.chat.create().id);
  for (const id of ids) await f.chat.send(id, crypto.randomUUID(), "Active turn");
  const data = await (await f.http("/api/settings")).json();
  expect(data.admission.activeTurns).toBe(3);
  expect(data.canApply).toBe(false);
  expect(
    (
      await f.http("/api/settings/files/USER.md", "PUT", {
        content: "Wait",
        expectedHash: hash("# User\n"),
      })
    ).status,
  ).toBe(409);
  expect(f.count("agents.files.set")).toBe(0);
  f.chat.close();
});

it("keeps a confirmed native application failure red and blocks sends until active-revision recovery passes", async () => {
  const f = await fixture();
  f.patch(async () => {
    (f.snapshot.config.tools as JsonRecord).deny = ["unknown-future-tool", "read"];
    f.snapshot.hash = "base-2";
    f.snapshot.configRevisionHash = "revision-2";
    throw new GatewayClientRequestError({
      code: "UNAVAILABLE",
      message: "config.patch persisted but was not applied to the active Gateway (failed)",
      details: { persistedConfig: { hash: "base-2" } },
    });
  });
  expect(
    (await f.http("/api/settings", "PATCH", { baseHash: "base-1", toolChanges: { read: false } }))
      .status,
  ).toBe(503);
  f.gateway.restarting = true;
  expect(f.chat.settings.indicator()).toMatchObject({ tone: "red", label: "Reload failed" });
  f.gateway.restarting = false;
  expect((await f.http("/ready")).status).toBe(503);
  expect((await (await f.http("/api/settings")).json()).phase).toBe("failed");
  f.snapshot.appliedConfigHash = "revision-2";
  expect((await (await f.http("/api/settings")).json()).gateway.tone).toBe("green");
  expect(f.count("config.patch")).toBe(1);
});

it("retains the gate after an unconfirmed file save and reconciles by reading without repeating the write", async () => {
  const f = await fixture();
  f.file(async () => {
    throw new Error("Write acknowledgement lost");
  });
  expect(
    (
      await f.http("/api/settings/files/USER.md", "PUT", {
        content: "Intended bytes",
        expectedHash: hash("# User\n"),
      })
    ).status,
  ).toBe(503);
  expect((await (await f.http("/api/settings")).json()).phase).toBe("unconfirmed");
  expect((await f.http("/ready")).status).toBe(503);
  f.files.set("USER.md", "Intended bytes");
  expect((await (await f.http("/api/settings")).json()).phase).toBe("idle");
  expect(f.count("agents.files.set")).toBe(1);
});

it("requests the optional admin scope on the same device and falls back to its saved chat token after refusal", async () => {
  const scopes = ["operator.read", "operator.write"];
  const f = await fixture(scopes);
  const identity = await readFile(join(f.directory, "identity.json"), "utf8");
  const connections: { scopes: string[]; token: string }[] = [];
  vi.spyOn(GatewayClient.prototype, "start").mockImplementation(function (this: GatewayClient) {
    const options = Reflect.get(this, "opts");
    connections.push({ scopes: options.scopes, token: options.token });
    if (connections.length === 1)
      options.onConnectError(
        new GatewayClientRequestError({
          code: "INVALID_REQUEST",
          message: "Scope upgrade requires approval",
        }),
      );
    else options.onHelloOk({ server: { version: "2026.10.3" }, auth: { scopes } });
  });
  vi.spyOn(GatewayClient.prototype, "stopAndWait").mockResolvedValue(undefined);
  f.gateway.start();
  await vi.waitFor(() => expect(connections).toHaveLength(2));
  expect(connections[0]).toEqual({
    scopes: [...scopes, "operator.admin"],
    token: "fixture-secret",
  });
  expect(connections[1]).toEqual({ scopes, token: "saved-chat-token" });
  expect(await readFile(join(f.directory, "identity.json"), "utf8")).toBe(identity);
  expect(JSON.parse(await readFile(join(f.directory, "token.json"), "utf8"))).toEqual({
    token: "saved-chat-token",
    scopes,
  });
  expect(f.gateway.settingsAdmin).toBe(false);
  await vi.waitFor(async () => expect((await f.http("/ready")).status).toBe(200));
});
