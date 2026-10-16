import type { ModelChoice } from "../types.ts";

// Reviewed against https://openrouter.ai/api/v1/models on 2026-10-16.
// Rates are USD per million tokens. Tiered pricing can increase the cost.
export const models: ModelChoice[] = [
  ["moonshotai/kimi-k2-thinking", "Kimi K2 Thinking", 262144, 0.6, 2.5, false],
  ["qwen/qwen3.7-flash", "Qwen3.7 Flash", 1000000, 0.03, 0.13, true],
  ["xiaomi/mimo-v2.6-flash", "MiMo-V2.6-Flash", 1050000, 0.14, 0.28, true],
  ["deepseek/deepseek-v4.1-flash", "DeepSeek V4.1 Flash", 1048576, 0.036, 0.684, true],
  ["z-ai/glm-5.3-flash", "GLM 5.3 Flash", 1048576, 0.01926, 0.9, true],
  ["google/gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite", 1048576, 0.1, 0.4, true],
].map(([id, name, context, input, output, vision]) => ({
  id: "openrouter/" + id,
  name: String(name),
  input: vision ? ["text", "image"] : ["text"],
  tools: true,
  contextWindow: Number(context),
  inputPrice: Number(input),
  outputPrice: Number(output),
  priceDate: "2026-10-16",
  api: "openai-completions",
  verified: vision
    ? "Not outcome-tested in this application"
    : "Bounded text and file-tool checks passed; other workflows unverified",
}));
