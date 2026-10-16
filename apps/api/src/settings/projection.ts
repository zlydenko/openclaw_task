import { record } from "../validation.ts";
import type { ConfigSnapshot, JsonRecord, SettingsTool } from "../types.ts";

export const primary = (value: unknown) =>
  typeof value === "string"
    ? value
    : typeof record(value).primary === "string"
      ? String(record(value).primary)
      : "";

export function mainAgent(config: JsonRecord) {
  const agents = record(config.agents);
  if (Array.isArray(agents.list))
    return record(agents.list.find((row) => record(row).id === "main"));
  return record(record(agents.entries).main);
}

export function selected(snapshot: ConfigSnapshot) {
  const defaults = record(record(snapshot.config.agents).defaults);
  return { chatModel: primary(defaults.model), imageModel: primary(defaults.imageModel) };
}

export function toolRows(
  config: JsonRecord,
  catalog: JsonRecord,
  effective: JsonRecord = {},
): SettingsTool[] {
  const policy = record(config.tools);
  const agentPolicy = record(mainAgent(config).tools);
  const deny = Array.isArray(policy.deny) ? policy.deny : [];
  // Only exact global denies can be removed by this UI. Unsupported policy layers stay read-only.
  const complex =
    Object.keys(agentPolicy).length > 0 ||
    Object.keys(record(policy.byProvider)).length > 0 ||
    policy.allow !== undefined ||
    policy.alsoAllow !== undefined ||
    (policy.profile !== undefined && policy.profile !== "full") ||
    deny.some(
      (entry) => typeof entry !== "string" || entry.includes("*") || entry.startsWith("group:"),
    );
  const groups = Array.isArray(catalog.groups) ? catalog.groups : [];
  const plugins = record(config.plugins);
  return groups
    .flatMap((group) => {
      const g = record(group);
      return (Array.isArray(g.tools) ? g.tools : []).flatMap((value) => {
        const tool = record(value);
        if (typeof tool.id !== "string" || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(tool.id)) return [];
        const id = tool.id;
        const pluginId = String(tool.pluginId ?? g.pluginId ?? "");
        const serviceOff =
          (id === "browser" && record(config.browser).enabled === false) ||
          (id === "cron" && record(config.cron).enabled === false) ||
          (id.startsWith("memory_") && record(record(config.memory).search).enabled === false) ||
          (pluginId &&
            (record(record(plugins.entries)[pluginId]).enabled === false ||
              (Array.isArray(plugins.allow) && !plugins.allow.includes(pluginId))));
        const unavailable = !!serviceOff || tool.optional === true;
        const access = record(effective.toolAccess);
        const diagnostic = record(
          (Array.isArray(access.tools) ? access.tools : []).find((row) => record(row).id === id),
        );
        const restricted =
          diagnostic.status === "unavailable" ||
          (diagnostic.status === "excluded" && !deny.includes(id));
        const editable = !complex && !unavailable && !restricted;
        return [
          {
            id,
            label: String(tool.label ?? id).slice(0, 160),
            description: String(tool.description ?? "Agent tool").slice(0, 360),
            enabled: editable && !deny.includes(id),
            editable,
            reason: restricted
              ? "Native effective-tool information reports a runtime or session restriction."
              : complex
                ? "Additional tool policy requires native review."
                : unavailable
                  ? "Service or plugin availability requires native review."
                  : deny.includes(id)
                    ? "Disabled by exact tool policy."
                    : "Allowed by policy. Credentials and execution permissions still apply; elevated execution stays disabled.",
          },
        ];
      });
    })
    .slice(0, 512);
}
