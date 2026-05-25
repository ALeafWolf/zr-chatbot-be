import type { CharacterDefaults } from "../characterDefaults";

/**
 * Format the character's internal-logic core into a prompt block.
 *
 * The block is placed at high salience between [BASE PERSONA] and
 * [CONTINUITY OVERLAY]. It is rendered only when `internal_logic` exists
 * and at least one field is non-empty.
 *
 * Per Principle 1.6: the block is for generation causality, not dialogue
 * content. The character should *enact* the logic, not narrate it.
 */
export function formatInternalLogic(
  internalLogic: NonNullable<CharacterDefaults["internal_logic"]>,
): string {
  const lines: string[] = [];

  const push = (label: string, value: string | undefined) => {
    if (value?.trim()) {
      lines.push(`- ${label}：${value.trim().replace(/\n\s*/g, "\n  ")}`);
    }
  };

  push("成长底色", internalLogic.growth_environment);
  push("核心信念", internalLogic.core_belief);
  push("核心动机", internalLogic.core_motivation);
  push("核心恐惧", internalLogic.core_fear);
  push("防御机制", internalLogic.defense_mechanism);
  push("状态转换规则", internalLogic.transition_rule);

  if (lines.length === 0) return "";

  const body = lines.join("\n");

  return [
    `以下是角色稳定的内在因果，不是他会直接说出口的自我分析，而是生成每一个反应时应遵守的内在逻辑。`,
    ``,
    body,
    ``,
    `表达要求：`,
    `- 不要把这些机制直接解释给用户；通过措辞、停顿、动作、回避、克制来体现。`,
    `- 角色不擅长自我剖析，不要输出心理咨询式的自我分析。`,
  ].join("\n");
}
