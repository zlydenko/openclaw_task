import type { Message, ToolActivity } from "./types.ts";

export function mergeActivities(older: ToolActivity[], newer: ToolActivity[]) {
  const items = new Map(older.map((item) => [item.id, item]));

  for (const item of newer) {
    const previous = items.get(item.id);
    const status =
      previous &&
      ["completed", "failed"].includes(previous.status) &&
      ["requested", "running", "unknown"].includes(item.status)
        ? previous.status
        : item.status;
    items.set(item.id, { ...previous, ...item, status });
  }

  return [...items.values()];
}

export function mergeHistory(older: Message[], newer: Message[]) {
  const items = new Map(older.map((item) => [item.id, item]));

  for (const item of newer) {
    const previous = items.get(item.id);
    items.set(item.id, {
      ...previous,
      ...item,
      ...(item.activities || previous?.activities
        ? { activities: mergeActivities(previous?.activities ?? [], item.activities ?? []) }
        : {}),
    });
  }

  return [...items.values()];
}

export function groupActivityRows(messages: Message[]) {
  const groups = new Map<string, Message>();
  const rows: Message[] = [];

  for (const message of messages) {
    if (message.text || !message.activities?.length) {
      rows.push(message);
      continue;
    }
    for (const activity of message.activities) {
      const key = activity.id;
      const existing = groups.get(key);
      if (existing) existing.activities = mergeActivities(existing.activities ?? [], [activity]);
      else {
        const last = rows.at(-1);
        const row =
          last && !last.text && last.activities?.length ? last : { ...message, activities: [] };
        row.activities = [...(row.activities ?? []), activity];
        groups.set(key, row);
        if (row !== last) rows.push(row);
      }
    }
  }

  return rows;
}
