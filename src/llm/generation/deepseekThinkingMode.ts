import type { ModelBinding } from "../../config/models";

export type DeepSeekV4ThinkingMode = "default" | "inner_os" | "no_inner_os";

export type DeepSeekV4ThinkingMarkerScope =
  | "first_turn_only"
  | "every_generation";

/**
 * INNER_OS_MARKER — appended to the user message before generation when
 * DEEPSEEK_V4_THINKING_MODE=inner_os.
 *
 * The 【正文隔离约束】 block was added in TG1.1 to isolate the thinking marker's
 * influence to the <think> block, preventing OOC leak into the visible reply.
 *
 * Downgrade criterion (design 1.1, tasks.md TG1.4):
 *   If on the replay set (turns 260–291) ≥20% of replies still show long
 *   monologue, or clinical density falls <50% vs baseline, set
 *   DEEPSEEK_V4_THINKING_MODE=no_inner_os and re-test.
 * This is an operator / ablation decision rule, NOT injected into the prompt.
 */
export const INNER_OS_MARKER = `

【角色沉浸要求】在你的思考过程（<think>标签内）中，请遵守以下规则：
1. 请以角色第一人称进行内心独白，用括号包裹内心活动，例如"（心想：……）"或"(内心：……)"
2. 用第一人称描写角色的内心感受，例如"我心想""我觉得""我暗自"等
3. 思考内容应沉浸在角色中，通过内心独白分析剧情和规划回复

【正文隔离约束】以上要求仅适用于思考过程。在最终可见回复中：
- 严禁出现"（心想：……）""（内心：……）"或任何长段（≥30字）第一人称心理分析括号
  （简短的动作/停顿括号如"（停顿片刻）"属于角色正常文风，保留）
- 严禁临床/学术式讲解：解剖学、胚胎学、器官机理分析、编号计数式描述
- 严禁解释或复盘自己的心理模式
- 可见回复保持左然文风：短句、动作、沉默、省略号，语言克制，单轮长度控制在约300–700字`;

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

/**
 * Strip the DeepSeek thinking marker from the end of content, if present.
 * Used to sanitize trace previews so marker text is not exposed in LangSmith.
 */
export function stripDeepSeekThinkingMarkerPreview(content: string): string {
  return content
    .replace(/\n\n【角色沉浸要求】[\s\S]*$/u, "")
    .replace(/\n\n【思维模式要求】[\s\S]*$/u, "");
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
