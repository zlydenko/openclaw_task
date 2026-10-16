import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const startup = () =>
  import(/* @vite-ignore */ pathToFileURL(resolve("../../scripts/start.mjs")).href);
const scopes = ["operator.read", "operator.write", "operator.admin"];
const device = (id: string) => ({
  deviceId: id,
  displayName: "Assessment Hono backend",
  clientId: "gateway-client",
  clientMode: "backend",
  scopes,
});

it.each(["a".repeat(64), "b".repeat(64)])(
  "pairs the installation's own backend %s and leaves unrelated devices untouched",
  async (id) => {
    const { provisionBackend } = await startup();
    const ownRequest = "11111111-1111-4111-8111-111111111111";
    const otherRequest = "22222222-2222-4222-8222-222222222222";
    const other = { ...device("c".repeat(64)), requestId: otherRequest };
    const state = {
      pending: [other, { ...device(id), requestId: ownRequest }],
      paired: [] as ReturnType<typeof device>[],
    };
    const mutations: string[][] = [];
    const run = (args: string[]) => {
      if (args[0] === "exec" && args[2] === "api") return JSON.stringify({ deviceId: id, scopes });
      if (args.includes("list")) return JSON.stringify(state);
      mutations.push(args);
      if (args.includes("approve")) {
        expect(args.at(-1)).toBe(ownRequest);
        state.pending = [other];
        state.paired.push(device(id));
      }
      return "";
    };
    expect(provisionBackend(run)).toEqual({ paired: true, deviceId: id });
    expect(state.pending).toEqual([other]);
    expect(mutations.filter((args) => args.includes("approve"))).toHaveLength(1);
    expect(mutations.at(-1)).toEqual(["restart", "api"]);
  },
);

it("reuses an already paired backend without another approval or API restart", async () => {
  const { provisionBackend } = await startup();
  const id = "d".repeat(64);
  const mutations: string[][] = [];
  const run = (args: string[]) => {
    if (args[0] === "exec" && args[2] === "api") return JSON.stringify({ deviceId: id, scopes });
    if (args.includes("list")) return JSON.stringify({ paired: [device(id)], pending: [] });
    mutations.push(args);
    return "";
  };
  expect(provisionBackend(run)).toEqual({ paired: false, deviceId: id });
  expect(mutations).toEqual([]);
});

it("recovers approved access after an interrupted token refresh without another approval", async () => {
  const { provisionBackend } = await startup();
  const id = "d".repeat(64);
  const mutations: string[][] = [];
  const run = (args: string[]) => {
    if (args[0] === "exec" && args[2] === "api")
      return JSON.stringify({ deviceId: id, scopes: ["operator.read", "operator.write"] });
    if (args.includes("list")) return JSON.stringify({ paired: [device(id)], pending: [] });
    mutations.push(args);
    return "";
  };
  expect(provisionBackend(run)).toEqual({ paired: false, reconnected: true, deviceId: id });
  expect(mutations).toEqual([["restart", "api"]]);
});

it("refuses an unrelated or broader permission request instead of approving the latest device", async () => {
  const { provisionBackend } = await startup();
  const id = "e".repeat(64);
  const mutations: string[][] = [];
  for (const pending of [
    [{ ...device("f".repeat(64)), requestId: "11111111-1111-4111-8111-111111111111" }],
    [
      {
        ...device(id),
        scopes: [...scopes, "operator.pairing"],
        requestId: "11111111-1111-4111-8111-111111111111",
      },
    ],
  ]) {
    const run = (args: string[]) => {
      if (args[0] === "exec" && args[2] === "api") return JSON.stringify({ deviceId: id, scopes });
      if (args.includes("list")) return JSON.stringify({ pending, paired: [] });
      mutations.push(args);
      return "";
    };
    expect(() => provisionBackend(run)).toThrow("no matching");
  }
  expect(mutations).toEqual([]);
});

it.each([true, false])(
  "reconciles a lost approval acknowledgement with native reads; confirmed=%s",
  async (confirmed) => {
    const { provisionBackend } = await startup();
    const id = "f".repeat(64);
    let approved = false;
    let writes = 0;
    let restarts = 0;
    const run = (args: string[]) => {
      if (args[0] === "exec" && args[2] === "api") return JSON.stringify({ deviceId: id, scopes });
      if (args.includes("list"))
        return JSON.stringify({
          paired: approved && confirmed ? [device(id)] : [],
          pending: [{ ...device(id), requestId: "11111111-1111-4111-8111-111111111111" }],
        });
      if (args.includes("approve")) {
        writes++;
        approved = true;
        throw new Error("Lost acknowledgement");
      }
      if (args[0] === "restart") restarts++;
      return "";
    };
    if (confirmed) expect(provisionBackend(run)).toEqual({ paired: true, deviceId: id });
    else expect(() => provisionBackend(run)).toThrow("outcome is unknown");
    expect(writes).toBe(1);
    expect(restarts).toBe(confirmed ? 1 : 0);
  },
);
