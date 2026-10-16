import { GatewayClientRequestError } from "@openclaw/gateway-client";

import type { Chat } from "./chat.ts";
import { ApiError } from "./errors.ts";
import type { OpenClaw } from "./openclaw.ts";
import { models } from "./settings/catalog.ts";
import { mainAgent, primary, selected, toolRows } from "./settings/projection.ts";
import type {
  ConfigSnapshot,
  FileInput,
  JsonRecord,
  SettingsInput,
  SettingsPhase,
  WorkspaceFile,
  WorkspaceFileName,
} from "./types.ts";
import { record } from "./validation.ts";

export class Settings {
  phase: SettingsPhase = "idle";
  private pendingHash: string | null = null;
  private pendingRevision: string | null = null;
  private expectedConfig: {
    baseHash: string;
    choices: { chatModel: string; imageModel: string };
    deny?: unknown[];
  } | null = null;
  private pendingFile: { name: WorkspaceFileName; content: string } | null = null;

  constructor(
    private gateway: OpenClaw,
    private chat: Chat,
  ) {}

  indicator() {
    if (this.phase === "failed")
      return {
        tone: "red",
        label: "Reload failed",
        reason: "Use native maintenance to inspect the gateway.",
      };
    if (this.gateway.restarting) return { tone: "amber", label: "Reloading agent…" };
    if (!this.gateway.authenticated)
      return this.gateway.reason === "RECONNECTING"
        ? { tone: "amber", label: "Reconnecting…" }
        : { tone: "red", label: "Gateway unavailable" };
    if (!this.chat.ready) return { tone: "amber", label: "Recovering…" };
    if (this.phase === "applying") return { tone: "amber", label: "Updating settings…" };
    if (this.phase === "unconfirmed")
      return {
        tone: "amber",
        label: "Settings unconfirmed",
        reason: "Check native application state before new submissions.",
      };
    return { tone: "green", label: "Connected" };
  }

  private requireAdmin() {
    if (!this.gateway.settingsAdmin)
      throw new ApiError(
        403,
        "SETTINGS_PERMISSION",
        "Settings access is unavailable for this backend device.",
      );
  }

  private async snapshot() {
    const snapshot = await this.gateway.settingsConfig();
    if (
      !snapshot.valid ||
      typeof snapshot.hash !== "string" ||
      !snapshot.config ||
      snapshot.writeError
    )
      throw new ApiError(503, "SETTINGS_UNAVAILABLE", "Native configuration needs maintenance.");
    return snapshot;
  }

  private async tools(config: JsonRecord) {
    const catalog = await this.gateway.settingsTools();
    const effective =
      typeof this.gateway.settingsEffective === "function"
        ? await this.gateway.settingsEffective().catch(() => ({}))
        : {};
    return toolRows(config, catalog, effective);
  }

  private matchesExpected(snapshot: ConfigSnapshot) {
    return (
      this.expectedConfig !== null &&
      JSON.stringify(selected(snapshot)) === JSON.stringify(this.expectedConfig.choices) &&
      (this.expectedConfig.deny === undefined ||
        JSON.stringify(record(snapshot.config.tools).deny) ===
          JSON.stringify(this.expectedConfig.deny))
    );
  }

  private async reconcile(snapshot: ConfigSnapshot) {
    if (this.phase !== "unconfirmed" && this.phase !== "failed") return;
    const pendingFile = this.pendingFile;
    if (pendingFile) {
      const saved = await this.file(pendingFile.name);
      if (
        this.pendingFile === pendingFile &&
        !saved.missing &&
        saved.content === pendingFile.content &&
        saved.hash
      ) {
        this.pendingFile = null;
        this.phase = "idle";
        this.chat.releaseSettings();
      }
    } else if (
      this.pendingHash &&
      (this.expectedConfig === null || this.matchesExpected(snapshot)) &&
      snapshot.hash === this.pendingHash &&
      snapshot.configRevisionHash &&
      snapshot.configRevisionHash === this.pendingRevision &&
      snapshot.appliedConfigHash === this.pendingRevision &&
      this.chat.ready
    ) {
      this.phase = "idle";
      this.pendingHash = null;
      this.pendingRevision = null;
      this.expectedConfig = null;
      this.chat.releaseSettings();
    }
    if (
      this.phase === "unconfirmed" &&
      this.expectedConfig &&
      snapshot.hash !== this.expectedConfig.baseHash &&
      JSON.stringify(selected(snapshot)) === JSON.stringify(this.expectedConfig.choices) &&
      (this.expectedConfig.deny === undefined ||
        JSON.stringify(record(snapshot.config.tools).deny) ===
          JSON.stringify(this.expectedConfig.deny)) &&
      snapshot.configRevisionHash &&
      snapshot.appliedConfigHash === snapshot.configRevisionHash &&
      this.chat.ready
    ) {
      this.phase = "idle";
      this.expectedConfig = null;
      this.pendingHash = null;
      this.pendingRevision = null;
      this.chat.releaseSettings();
    }
  }

  async recoverNative() {
    if (typeof this.gateway.settingsConfig !== "function") return;
    const snapshot = await this.snapshot();
    if (
      !snapshot.configRevisionHash ||
      snapshot.configRevisionHash !== snapshot.appliedConfigHash
    ) {
      this.phase = "unconfirmed";
      this.chat.holdSettings();
      this.pendingHash = snapshot.hash;
      this.pendingRevision = snapshot.configRevisionHash ?? null;
    }
    await this.reconcile(snapshot);
  }

  async read() {
    const snapshot = await this.snapshot();
    if (
      this.phase === "idle" &&
      (!snapshot.configRevisionHash || snapshot.configRevisionHash !== snapshot.appliedConfigHash)
    ) {
      this.phase = "unconfirmed";
      this.chat.holdSettings();
      this.pendingHash = snapshot.hash;
      this.pendingRevision = snapshot.configRevisionHash ?? null;
    }
    await this.reconcile(snapshot);
    return this.project(snapshot);
  }

  private async project(snapshot: ConfigSnapshot) {
    const config = snapshot.config;
    const gateway = record(config.gateway);
    const reloadMode = String(record(gateway.reload).mode ?? "hybrid");
    const tools = await this.tools(config);
    const admission = this.chat.settingsAdmission();
    const agent = mainAgent(config);
    return {
      ...selected(snapshot),
      baseHash: snapshot.hash,
      phase: this.phase,
      admission,
      canEdit: this.gateway.settingsAdmin === true,
      canApply:
        this.gateway.settingsAdmin === true &&
        reloadMode === "hybrid" &&
        admission.ready &&
        !admission.locked &&
        !admission.activeTurns,
      models,
      tools,
      overrides: {
        chatModel: primary(agent.model),
        imageModel: primary(agent.imageModel),
        notice:
          "Agent and conversation overrides take precedence. Existing sessions are not rewritten.",
      },
      gateway: {
        version: this.gateway.version ?? "2026.10.3",
        reloadMode,
        bind: typeof gateway.bind === "string" ? gateway.bind : "loopback",
        port: typeof gateway.port === "number" ? gateway.port : 18789,
        authenticationEnabled: record(gateway.auth).mode !== "none",
        ...this.indicator(),
      },
    };
  }

  private async checkSchema(paths: string[]) {
    for (const path of paths) {
      const schema = await this.gateway.settingsSchema(path);
      if (!schema.schema || schema.reloadKind === "restart")
        throw new ApiError(
          503,
          "SETTINGS_SCHEMA",
          "This installed schema needs native maintenance for the selected change.",
        );
    }
  }

  async apply(input: SettingsInput) {
    this.requireAdmin();
    this.chat.acquireSettings();
    let sent = false;
    try {
      const snapshot = await this.snapshot();
      if (snapshot.hash !== input.baseHash)
        throw new ApiError(
          409,
          "SETTINGS_STALE",
          "Settings changed. Load current values and compare with your draft.",
        );
      const config = snapshot.config;
      if ((record(record(config.gateway).reload).mode ?? "hybrid") !== "hybrid")
        throw new ApiError(
          409,
          "RELOAD_MODE",
          "Config writes require hybrid reload mode. Use native maintenance; your draft is retained.",
        );
      const patch: JsonRecord = {};
      const paths: string[] = [];
      const defaults = record(record(config.agents).defaults);
      const changedDefaults: JsonRecord = {};
      const additions: JsonRecord[] = [];
      const provider = record(record(record(config.models).providers).openrouter);
      if (!Object.keys(provider).length)
        throw new ApiError(
          409,
          "PROVIDER_UNAVAILABLE",
          "The configured OpenRouter provider is required.",
        );
      for (const [field, slot] of [
        ["chatModel", "model"],
        ["imageModel", "imageModel"],
      ] as const) {
        const id = input[field];
        if (id === undefined || id === primary(defaults[slot])) continue;
        const model = models.find(
          (row) => row.id === id && (field !== "imageModel" || row.input.includes("image")),
        );
        if (!model)
          throw new ApiError(400, "INVALID_MODEL", "Select a reviewed model for this slot.");
        changedDefaults[slot] = { ...record(defaults[slot]), primary: id };
        paths.push(`agents.defaults.${slot}`);
        const nativeId = id.slice("openrouter/".length);
        const existingModel = record(
          (Array.isArray(provider.models) ? provider.models : []).find(
            (row) => record(row).id === nativeId,
          ),
        );
        if (
          !(Array.isArray(provider.models) ? provider.models : []).some(
            (row) => record(row).id === nativeId,
          ) &&
          !additions.some((row) => row.id === nativeId)
        ) {
          additions.push({
            id: nativeId,
            name: model.name,
            api: model.api,
            input: model.input,
            reasoning: true,
            contextWindow: model.contextWindow,
            maxTokens: 4096,
            cost: { input: model.inputPrice, output: model.outputPrice },
          });
        }
        if (
          Object.keys(existingModel).length &&
          (!Number.isFinite(existingModel.maxTokens) || Number(existingModel.maxTokens) > 4096) &&
          !additions.some((row) => row.id === nativeId)
        ) {
          additions.push({ id: nativeId, maxTokens: 4096 });
        }
        if (defaults.models !== undefined && !Object.hasOwn(record(defaults.models), id)) {
          changedDefaults.models = { ...record(changedDefaults.models), [id]: {} };
        }
      }
      if (Object.keys(changedDefaults).length) patch.agents = { defaults: changedDefaults };
      if (changedDefaults.models) paths.push("agents.defaults.models");
      if (additions.length) {
        patch.models = { providers: { openrouter: { models: additions } } };
        paths.push("models.providers.openrouter.models");
      }
      const replacePaths: string[] = [];
      if (input.toolChanges) {
        const rows = await this.tools(config);
        const tools = record(config.tools);
        let deny = Array.isArray(tools.deny) ? [...tools.deny] : [];
        for (const [id, enabled] of Object.entries(input.toolChanges)) {
          const row = rows.find((tool) => tool.id === id);
          if (!row || !row.editable)
            throw new ApiError(400, "INVALID_TOOL", "Select an editable exact catalog tool ID.");
          if (enabled) deny = deny.filter((entry) => entry !== id);
          else if (!deny.includes(id)) deny.push(id);
        }
        if (JSON.stringify(deny) !== JSON.stringify(tools.deny ?? [])) {
          patch.tools = { deny };
          paths.push("tools.deny");
          replacePaths.push("tools.deny");
        }
      }
      if (!paths.length) throw new ApiError(400, "NO_CHANGE", "Select at least one change.");
      await this.checkSchema(paths);
      this.requireAdmin();
      const admission = this.chat.settingsAdmission();
      if (!admission.ready || admission.activeTurns)
        throw new ApiError(
          409,
          "SETTINGS_BUSY",
          "Gateway admission changed. Read current status before saving.",
        );
      this.expectedConfig = {
        baseHash: snapshot.hash,
        choices: {
          chatModel: input.chatModel ?? selected(snapshot).chatModel,
          imageModel: input.imageModel ?? selected(snapshot).imageModel,
        },
        ...(patch.tools ? { deny: record(patch.tools).deny as unknown[] } : {}),
      };
      this.phase = "applying";
      const result = await this.gateway.settingsPatch(patch, snapshot.hash, replacePaths, () => {
        sent = true;
      });
      const saved = await this.snapshot();
      this.pendingHash = typeof result.hash === "string" ? result.hash : saved.hash;
      this.pendingRevision = saved.configRevisionHash ?? null;
      if (
        result.ok !== true ||
        !this.matchesExpected(saved) ||
        saved.hash !== this.pendingHash ||
        !saved.configRevisionHash ||
        saved.appliedConfigHash !== saved.configRevisionHash ||
        !this.chat.ready
      )
        throw new Error("Application unconfirmed");
      const projection = await this.project(saved);
      this.phase = "idle";
      this.pendingHash = null;
      this.pendingRevision = null;
      this.expectedConfig = null;
      this.chat.releaseSettings();
      console.log(JSON.stringify({ event: "settings_applied", fields: paths }));
      const updatedAdmission = this.chat.settingsAdmission();
      return {
        ...projection,
        phase: this.phase,
        admission: updatedAdmission,
        canApply:
          this.gateway.settingsAdmin &&
          projection.gateway.reloadMode === "hybrid" &&
          updatedAdmission.ready &&
          !updatedAdmission.locked &&
          !updatedAdmission.activeTurns,
        gateway: { ...projection.gateway, ...this.indicator() },
      };
    } catch (error) {
      if (!sent) {
        this.phase = "idle";
        this.chat.releaseSettings();
      } else {
        // A correlated validation/conflict rejection is safe only without a persistence receipt.
        const details = record(record(error).details);
        if (
          error instanceof GatewayClientRequestError &&
          error.gatewayCode === "INVALID_REQUEST" &&
          !details.persistedConfig &&
          !details.publication
        ) {
          this.phase = "idle";
          this.chat.releaseSettings();
          throw new ApiError(
            409,
            "SETTINGS_REJECTED",
            "The gateway rejected the change. Reload current settings and compare.",
          );
        }
        this.phase =
          error instanceof GatewayClientRequestError &&
          /not applied.*\(failed\)/.test(error.message)
            ? "failed"
            : "unconfirmed";
        try {
          const saved = await this.snapshot();
          const persisted = record(details.persistedConfig);
          if (typeof persisted.hash === "string") this.pendingHash = persisted.hash;
          if (this.pendingHash === saved.hash)
            this.pendingRevision = saved.configRevisionHash ?? null;
        } catch {
          /* Keep the mutation gate until native evidence resolves it. */
        }
      }
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        "SETTINGS_UNCONFIRMED",
        "Application is unconfirmed. Use read-only status checks or native maintenance. Do not repeat the write.",
      );
    }
  }

  async file(name: WorkspaceFileName): Promise<WorkspaceFile> {
    const result = await this.gateway.settingsFile(name);
    const file = record(result.file);
    if (file.name !== name || typeof file.missing !== "boolean")
      throw new ApiError(503, "FILE_UNAVAILABLE", "The native file response is unavailable.");
    if (Number(file.size ?? 0) > 65536 || Buffer.byteLength(String(file.content ?? "")) > 65536)
      throw new ApiError(
        413,
        "FILE_LIMIT",
        "This file exceeds 64 KiB. Edit it through native maintenance; no truncated editor is available.",
      );
    if (!file.missing && (typeof file.content !== "string" || typeof file.hash !== "string"))
      throw new ApiError(503, "FILE_UNAVAILABLE", "The saved file revision is unavailable.");
    return {
      name,
      content: file.missing ? "" : String(file.content),
      missing: file.missing,
      size: Number(file.size ?? 0),
      hash: typeof file.hash === "string" ? file.hash : null,
    };
  }

  async saveFile(name: WorkspaceFileName, input: FileInput) {
    this.requireAdmin();
    this.chat.acquireSettings();
    let sent = false;
    try {
      const current = await this.file(name);
      if (
        (input.expectedMissing === true && !current.missing) ||
        (input.expectedHash !== undefined &&
          (current.missing || current.hash !== input.expectedHash))
      )
        throw new ApiError(
          409,
          "FILE_CONFLICT",
          "The file changed. Reload its saved version and compare with your draft.",
        );
      this.phase = "saving";
      this.requireAdmin();
      const admission = this.chat.settingsAdmission();
      if (!admission.ready || admission.activeTurns)
        throw new ApiError(
          409,
          "SETTINGS_BUSY",
          "Gateway admission changed. Read current status before saving.",
        );
      try {
        await this.gateway.settingsSaveFile(name, input, () => {
          sent = true;
        });
      } catch (error) {
        if (error instanceof GatewayClientRequestError && error.gatewayCode === "INVALID_REQUEST")
          throw new ApiError(
            409,
            "FILE_CONFLICT",
            "The native file guard rejected the save. Reload and compare.",
          );
        if (!sent) throw error;
        // Lost acknowledgement: one read, never another write.
      }
      const saved = await this.file(name);
      if (saved.missing || saved.content !== input.content || !saved.hash)
        throw new Error("File unconfirmed");
      this.phase = "idle";
      this.chat.releaseSettings();
      console.log(JSON.stringify({ event: "workspace_file_saved", name }));
      return saved;
    } catch (error) {
      if (!sent || (error instanceof ApiError && error.status === 409)) {
        this.phase = "idle";
        this.chat.releaseSettings();
      } else {
        this.phase = "unconfirmed";
        this.pendingFile = { name, content: input.content };
      }
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        "FILE_UNCONFIRMED",
        "The save is unconfirmed. Read and compare before another explicit save.",
      );
    }
  }
}
