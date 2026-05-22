import type { ModelBinding } from "../../config/models";

export type DeepSeekV4ThinkingMode = "default" | "inner_os" | "no_inner_os";

export type DeepSeekV4ThinkingMarkerScope =
  | "first_turn_only"
  | "every_generation";

export const INNER_OS_MARKER = `

【角色沉浸要求】在你的思考过程（<think>标签内）中，请遵守以下规则：
1. 请以角色第一人称进行内心独白，用括号包裹内心活动，例如"（心想：……）"或"(内心：……)"
2. 用第一人称描写角色的内心感受，例如"我心想""我觉得""我暗自"等
3. 思考内容应沉浸在角色中，通过内心独白分析剧情和规划回复`;

export const NO_INNER_OS_MARKER = `

【思维模式要求】在你的思考过程（<think>标签内）中，请遵守以下规则：
1. 禁止使用圆括号包裹内心独白，例如"（心想：……）"或"(内心：……)"，所有分析内容直接陈述即可
2. 禁止以角色第一人称描写内心活动，例如"我心想""我觉得""我暗自"等，请用分析性语言替代
3. 思考内容应聚焦于剧情走向分析和回复内容规划，不要在思考中进行角色扮演式的内心戏表演`;

export function isDeepSeekV4ProGenerationModel(model: ModelBinding): boolean {
  return (
    model.provider === "deepseek" &&
    model.model.trim().toLowerCase() === "deepseek-v4-pro"
  );
}

export function getDeepSeekThinkingMarker(
  mode: DeepSeekV4ThinkingMode,
): string {
  if (mode === "inner_os") return INNER_OS_MARKER;
  if (mode === "no_inner_os") return NO_INNER_OS_MARKER;
  return "";
}

export function hasDeepSeekThinkingMarker(content: string): boolean {
  return (
    content.includes("【角色沉浸要求】") ||
    content.includes("【思维模式要求】")
  );
}

export function appendDeepSeekThinkingMarker(input: {
  content: string;
  mode: DeepSeekV4ThinkingMode;
  generationModel: ModelBinding;
  isFirstUserTurn: boolean;
  scope?: DeepSeekV4ThinkingMarkerScope;
}): {
  content: string;
  injected: boolean;
  reason:
    | "injected"
    | "not_first_user_turn"
    | "unsupported_model"
    | "default_mode"
    | "already_present";
} {
  if (input.scope !== "every_generation" && !input.isFirstUserTurn) {
    return { content: input.content, injected: false, reason: "not_first_user_turn" };
  }

  if (!isDeepSeekV4ProGenerationModel(input.generationModel)) {
    return { content: input.content, injected: false, reason: "unsupported_model" };
  }

  const marker = getDeepSeekThinkingMarker(input.mode);
  if (!marker) {
    return { content: input.content, injected: false, reason: "default_mode" };
  }

  if (hasDeepSeekThinkingMarker(input.content)) {
    return { content: input.content, injected: false, reason: "already_present" };
  }

  return {
    content: `${input.content}${marker}`,
    injected: true,
    reason: "injected",
  };
}
