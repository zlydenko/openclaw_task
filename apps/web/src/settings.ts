import { settingsRequest } from "./api.ts";
import type {
  FileEditor,
  SettingsData,
  SettingsState,
  WorkspaceFile,
  WorkspaceFileName,
} from "./types.ts";

const emptyFile = (): FileEditor => ({
  saved: null,
  draft: "",
  editing: false,
  error: "",
  result: "",
});
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The request could not be confirmed.";

export function chatModelLabel(current: SettingsData | null) {
  if (!current) return "Loading model…";
  const id = current.overrides.chatModel || current.chatModel;
  return current.models.find((model) => model.id === id)?.name || id || "Model unavailable";
}

export class SettingsController {
  private state: SettingsState = {
    saved: null,
    current: null,
    chatModel: "",
    imageModel: "",
    toolChanges: {},
    files: { "USER.md": emptyFile(), "MEMORY.md": emptyFile() },
    pending: "",
    error: "",
    result: "",
    indicator: null,
  };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private polling = false;
  private refreshEpoch = 0;
  snapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private update(value: Partial<SettingsState>) {
    this.state = { ...this.state, ...value };
    for (const fn of this.listeners) fn();
  }

  start() {
    this.stopped = false;
    void this.poll();
    document.addEventListener("visibilitychange", this.wake);
  }

  close() {
    this.stopped = true;
    clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.wake);
  }

  private wake = () => {
    if (!document.hidden) void this.poll();
  };

  setVisible(value: boolean) {
    if (value) {
      void this.refresh();
      for (const name of ["USER.md", "MEMORY.md"] as const)
        if (!this.state.files[name].saved) void this.loadFile(name);
    }
  }

  private async poll() {
    if (this.stopped || this.polling) return;
    this.polling = true;
    clearTimeout(this.timer);
    try {
      if (!document.hidden) {
        const response = await fetch("/ready", {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        const body = await response.json();
        if (body.gateway) this.update({ indicator: body.gateway });
        await this.refresh();
      }
    } catch {
      this.update({
        indicator: {
          tone: "red",
          label: "Gateway unavailable",
          reason: "Backend status is unavailable.",
        },
      });
    } finally {
      this.polling = false;
      if (!this.stopped) this.timer = setTimeout(() => void this.poll(), 3000);
    }
  }

  async refresh() {
    if (this.state.pending === "config") return;
    const epoch = ++this.refreshEpoch;
    try {
      const current = await settingsRequest<SettingsData>("");
      if (epoch !== this.refreshEpoch) return;
      if (!this.state.saved) this.adopt(current);
      else this.update({ current });
    } catch (error) {
      if (epoch !== this.refreshEpoch) return;
      this.update({ error: message(error) });
    }
  }

  private adopt(data: SettingsData) {
    this.update({
      saved: data,
      current: data,
      chatModel: data.chatModel,
      imageModel: data.imageModel,
      toolChanges: {},
      error: "",
    });
  }

  changeModel(slot: "chatModel" | "imageModel", value: string) {
    this.update({ [slot]: value, result: "", error: "" });
  }

  toggle(id: string, value: boolean) {
    const changes = { ...this.state.toolChanges };
    if (this.state.saved?.tools.find((tool) => tool.id === id)?.enabled === value)
      delete changes[id];
    else changes[id] = value;
    this.update({ toolChanges: changes, result: "", error: "" });
  }

  discard() {
    if (this.state.current) this.adopt(this.state.current);
    this.update({ result: "Changes discarded." });
  }

  async apply() {
    const state = this.state;
    if (!state.saved || state.pending || !state.current?.canApply) return;
    this.update({ pending: "config", error: "", result: "" });
    this.refreshEpoch++;
    try {
      const result = await settingsRequest<SettingsData>("", "PATCH", {
        baseHash: state.saved.baseHash,
        ...(state.chatModel !== state.saved.chatModel ? { chatModel: state.chatModel } : {}),
        ...(state.imageModel !== state.saved.imageModel ? { imageModel: state.imageModel } : {}),
        ...(Object.keys(state.toolChanges).length ? { toolChanges: state.toolChanges } : {}),
      });
      this.adopt(result);
      this.update({ result: "Applied. Changes apply to later turns." });
    } catch (error) {
      this.update({ error: message(error) });
    } finally {
      this.update({ pending: "" });
      await this.refresh();
    }
  }

  private editor(name: WorkspaceFileName, patch: Partial<FileEditor>) {
    this.update({
      files: { ...this.state.files, [name]: { ...this.state.files[name], ...patch } },
    });
  }

  editFile(name: WorkspaceFileName, draft?: string) {
    this.editor(name, { editing: true, ...(draft !== undefined ? { draft } : {}), result: "" });
  }

  async loadFile(name: WorkspaceFileName) {
    try {
      const current = await settingsRequest<WorkspaceFile>("/files/" + name);
      const editor = this.state.files[name];
      if (!editor.saved || (!editor.editing && editor.draft === editor.saved.content))
        this.editor(name, {
          saved: current,
          draft: current.content,
          error: "",
          current: undefined,
        });
      else
        this.editor(name, {
          current,
          error:
            "Compare the current saved version below. Your draft and its original revision are retained.",
        });
    } catch (error) {
      this.editor(name, { error: message(error) });
    }
  }

  discardFile(name: WorkspaceFileName) {
    const editor = this.state.files[name];
    const saved = editor.current ?? editor.saved;
    if (saved)
      this.editor(name, {
        saved,
        draft: saved.content,
        editing: false,
        error: "",
        current: undefined,
        result: "Draft discarded.",
      });
  }

  async saveFile(name: WorkspaceFileName) {
    const editor = this.state.files[name];
    const status = this.state.current;
    if (
      !editor.saved ||
      this.state.pending ||
      !status?.canEdit ||
      !status.admission.ready ||
      status.admission.locked ||
      status.admission.activeTurns ||
      new TextEncoder().encode(editor.draft).length > 65536
    )
      return;
    const content = editor.draft;
    this.update({ pending: name });
    this.editor(name, { error: "", result: "" });
    try {
      const saved = await settingsRequest<WorkspaceFile>("/files/" + name, "PUT", {
        content,
        ...(editor.saved.missing ? { expectedMissing: true } : { expectedHash: editor.saved.hash }),
      });
      this.editor(name, {
        saved,
        current: undefined,
        editing: this.state.files[name].draft !== content,
        result: "Saved. Native context rules govern later turns.",
      });
    } catch (error) {
      this.editor(name, { error: message(error) });
    } finally {
      this.update({ pending: "" });
      await this.refresh();
    }
  }
}
