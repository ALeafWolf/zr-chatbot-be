/**
 * Single source of truth for user-message bracket semantics.
 * Rewriter Phase B uses instructions only; generator uses full rules on fallback.
 */

/** Fed into lane-label LLM: semantic lanes only (Phase A owns delimiters). */
export const REWRITE_ANNOTATION_INSTRUCTIONS = `You label pre-segmented spans of the user's message. You MUST NOT split, merge, rephrase, or edit any span text.

Each span has a structural kind from deterministic parsing:
- plain: text not inside tracked delimiters in that span.
- paren: text inside parentheses () or fullwidth （）.
- square_meta: text inside 【】.

Lane assignment:
- square_meta spans MUST be labeled reply_direction (user meta / out-of-character guidance).
- paren spans MUST be labeled user_thought or user_action only (stage directions, inner state, or describable user behavior — not spoken dialogue).
- plain spans should normally be spoken dialogue and MUST be labeled user_speech unless the plain segment is clearly an action beat without spoken lines (rare); when in doubt for plain, prefer user_speech.

Global fields (JSON):
- entities: short noun phrases grounded in the message (do not invent facts).
- intent: one of attribution | recall | general (telemetry only).
- confidence: optional number in [0,1] — your confidence that lane labels match the user's intent.
- hypothetical: optional one-sentence neutral paraphrase of what canon passage would answer the user (no new facts). Omit unless HyDE is requested by the system.

Safety: do not add detail not present in the spans. Output strict JSON only.`;

/** Generator fallback — identical prose for [USER MESSAGE ANNOTATIONS]. */
export const USER_MESSAGE_ANNOTATION_RULES = `用户消息中可能包含非对白标注。
被 \`()\` 或 \`（）\` 包裹的内容表示非直接说出口的上下文，例如用户的内心活动、用户动作，或双方/场景动作。不要将其视为用户说出的对白。若其中描述的是可观察到的行为、表情、动作或语气变化，应让角色像自然观察到这些外在表现后作出回应。若其中描述的是私人内心活动，不要让角色表现得像能读心；只有当它能从外在表现中合理推断时，才可让角色以试探、猜测或含蓄察觉的方式回应，否则应忽略，或仅作为隐藏情绪背景参考。
被 \`【】\` 包裹的内容表示用户提供的出戏指导或回复方向，而不是情景内对白。它可能用于指定情景设定、下一轮回复角度、情绪基调、节奏或回复重点。生成回复时应参考这些指导来塑造回应，但不得违反更高优先级的系统规则、安全限制或角色一致性。
回复中不要主动提及用户使用了括号或方括号，除非必须请求澄清。`;
