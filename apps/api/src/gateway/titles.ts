// Native fallback slugs from the pinned OpenClaw session-slug implementation.
const adjectives = new Set(
  "amber briny brisk calm clear cool crisp dawn delta ember faint fast fresh gentle glow good grand keen kind lucky marine mellow mild neat nimble nova oceanic plaid quick quiet rapid salty sharp swift tender tidal tidy tide vivid warm wild young".split(
    " ",
  ),
);
const crustaceans = new Set(
  "barnacle claw crab crayfish krill langoustine lobster prawn shrimp shell".split(" "),
);

export function isFallbackName(name: string) {
  const parts = name.split("-");

  return (
    parts.length >= 2 &&
    parts.length <= 4 &&
    adjectives.has(parts[0]!) &&
    crustaceans.has(parts[1]!) &&
    parts.slice(2).every((part) => /^[a-z0-9]+$/.test(part))
  );
}

export function titleFromUserText(input: string) {
  const normalized = input.replace(/\s+/gu, " ").trim();
  const sentence = normalized.match(/^.*?[.!?](?=\s|$)/u)?.[0] || normalized;
  const characters = [...sentence];

  if (characters.length <= 60) return sentence;

  const prefix = characters.slice(0, 59).join("");
  const boundary = prefix.lastIndexOf(" ");

  return (boundary > 35 ? prefix.slice(0, boundary) : prefix).trimEnd() + "…";
}
