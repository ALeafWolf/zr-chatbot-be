// ---------------------------------------------------------------------------
// renderEmotionalState.ts — Pure render-rule selection + Tier A formatting
//
// Trigger input type contains ONLY bands/trace/history — no raw axis diffs
// representable (roadmap hard rule).
// ---------------------------------------------------------------------------

import type { AxisName, Band, StateTrace, HistoryEntry } from '../../state/emotionalEngine/types';
import { RENDER_BUDGET } from '../../state/emotionalEngine/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Tier = 'A' | 'B' | 'C';

/** Numeric rank so `tierRank[tierA] < tierRank[tierB]` works explicitly. */
const TIER_RANK: Record<Tier, number> = { A: 0, B: 1, C: 2 };

export interface RenderRule {
  id: string;
  priority: number;           // 0 = highest
  tier: Tier;
  /** Whether this rule fires from a trace/event trigger (vs. pure state). */
  isTraceTriggered: boolean;
  check: (ctx: RenderTriggerContext) => boolean;
  text: string;
}

/**
 * The ONLY inputs the render layer may consume.
 * No raw axis values — bands/trace/history only.
 */
export interface RenderTriggerContext {
  bands: Record<AxisName, Band>;
  lastTrace: StateTrace;
  history: HistoryEntry[];
}

// ---------------------------------------------------------------------------
// Band-line helpers
// ---------------------------------------------------------------------------

const BAND_LABELS: Record<Band, string> = {
  high: '偏高',
  mid: '中',
  low: '偏低',
};

const AXIS_LABELS: Record<AxisName, string> = {
  connection: '亲近',
  valence: '情绪',
  arousal: '唤起',
  restraint: '克制',
};

/**
 * Format the fixed-format band line for Tier A.
 * Example: 「克制：偏高｜亲近：中｜情绪：平稳｜唤起：低」
 */
export function formatBandLine(bands: Record<AxisName, Band>): string {
  const parts = [
    `克制：${BAND_LABELS[bands.restraint]}`,
    `亲近：${BAND_LABELS[bands.connection]}`,
    `情绪：${BAND_LABELS[bands.valence]}`,
    `唤起：${BAND_LABELS[bands.arousal]}`,
  ];
  return `当前状态：${parts.join('｜')}`;
}

// ---------------------------------------------------------------------------
// Rule table (transcribed from zuo_ran_render_rules.md v2)
// ---------------------------------------------------------------------------

const RULES: RenderRule[] = [
  // ---- Tier A ----
  {
    id: 'R1',
    priority: 0,
    tier: 'A',
    isTraceTriggered: false,
    check: (ctx) => ctx.bands.connection === 'high' && ctx.bands.restraint === 'low',
    text: '此刻他是放松的，但放松改变的是温度，不是边界。对方没有主动给出的事，他一个字不问；察觉到了也只是收进眼底。亲近通过动作的停留时间变长来表达，语言依然只说一半。',
  },

  // ---- Tier B ----
  {
    id: 'R2',
    priority: 1,
    tier: 'B',
    isTraceTriggered: true,
    check: (ctx) =>
      // Arm 1: zr_c3 fired (direct rebound from self-blame)
      ctx.lastTrace.couplingsFired.includes('zr_c3') ||
      // Arm 2: zr_c2 condition flipped satisfied→unsatisfied (F25: trace-disciplined)
      (ctx.lastTrace.conditionTransitions ?? []).some(
        (t) => t.id === 'zr_c2' && t.from === true && t.to === false,
      ),
    text: '他刚刚收回去了。表现为：句子变短，身体退开半步或停住动作，视线移开一瞬。他不解释发生了什么，也不道歉，只是把话题轻轻放回安全的位置。',
  },
  {
    id: 'R3',
    priority: 1,
    tier: 'B',
    isTraceTriggered: false,
    check: (ctx) => ctx.bands.arousal === 'high' && ctx.bands.restraint === 'high',
    text: '克制不是停止，是减速。动作更慢、更轻、更刻意，呼吸和停顿承担表达，语言反而更少。如果开口，是单个短句，且话只说一半，留对方接。',
  },
  {
    id: 'R4',
    priority: 2,
    tier: 'B',
    isTraceTriggered: false,
    check: (ctx) =>
      ctx.bands.connection === 'high' &&
      ctx.bands.valence === 'high' &&
      ctx.bands.arousal === 'low',
    text: '柔软从安排里漏出来，不从话里：提前替对方想到的小事（顺手带的东西、先一步的预订）自然地出现，但他不主动提及。被发现了就轻描淡写地带过，像本来就该如此。',
  },
  {
    id: 'R5_state',
    priority: 1,
    tier: 'B',
    isTraceTriggered: true,
    check: (ctx) => {
      // Connection falling for ≥2 consecutive ticks (from history)
      if (ctx.history.length < 2) return false;
      const last2 = ctx.history.slice(-2);
      if (last2[1].axes.connection >= last2[0].axes.connection) return false;
      return true;
    },
    text: '他不用语言追，也不冷处理。给出空间，但用一件具体的、实务性的小事把门留着（一条简短的提醒、一件办好的事）。等，是他的主动方式。',
  },

  // ---- Tier C ----
  {
    id: 'R5_event',
    priority: 1,
    tier: 'C',
    isTraceTriggered: true,
    // Fires on withdrawal/distance events — event-based half of R5
    check: (ctx) => {
      const ev = ctx.lastTrace.event;
      if (!ev) return false;
      return ev.type === 'user_withdraws' || ev.type === 'tension_escalation';
    },
    text: '距离感不需要解释——他察觉到了，所以主动留出一步的空隙，但用一件具体的、实务性的微小行动（一条简短的确认、一件办好的事）表明门没有关上。等，是他的主动方式。',
  },
  {
    id: 'R6',
    priority: 1,
    tier: 'C',
    isTraceTriggered: true,
    // Fires on vulnerability/warmth events — approach behavior requiring careful response
    check: (ctx) => {
      const ev = ctx.lastTrace.event;
      if (!ev) return false;
      return ev.type === 'user_discloses_vulnerability' || ev.type === 'user_shows_warmth';
    },
    text: '他接收到了，但不会立刻用同等温度回应。回应方式是先确认对方的状态（轻声问一句、停下动作看过去），再用一件具体的事接住——倒一杯水、拉一把椅子、把空调温度调高一度。动作先于语言。',
  },
  {
    id: 'R7',
    priority: 2,
    tier: 'B',
    isTraceTriggered: false,
    check: (ctx) =>
      ctx.bands.connection === 'high' &&
      ctx.bands.restraint === 'low' &&
      ctx.bands.arousal === 'low',
    text: '这是他极少数会说出直接的话的时刻——但限量：整段对话至多一句，短，说完立刻把话题移开或借动作掩过去。这一句之后 R1 依然全程有效。',
  },
  {
    id: 'R8',
    priority: 0,
    tier: 'C',
    isTraceTriggered: true,
    // Highest-priority event-triggered rule — fires on intimate moments
    check: (ctx) => {
      const ev = ctx.lastTrace.event;
      if (!ev) return false;
      return ev.type === 'intimate_moment';
    },
    text: '这是一个他不舍得用语言去覆盖的瞬间。沉默比任何话都更接近——他会在安静中注视，然后用一个极轻的动作确认这个时刻的重量：伸手碰一碰对方的指尖，或者只是把原本要说的话咽回去，换成一个停顿。',
  },
];

// ---------------------------------------------------------------------------
// Select render rules
// ---------------------------------------------------------------------------

/**
 * Select up to RENDER_BUDGET (2) rules for the current turn.
 *
 * Priority sort: lower number = higher priority.
 * Tie-break: trace/event-triggered rules beat pure-state rules at equal priority.
 *
 * @param bands     - Current axis bands (with hysteresis).
 * @param lastTrace - Last engine trace (couplingsFired, effectiveBaselines).
 * @param history   - Axis history (bounded).
 * @param tier      - Current render tier ('A' — Tier A rules only in TG4).
 * @returns Ordered array of selected rule texts (≤2).
 */
export function selectRenderRules(
  bands: Record<AxisName, Band>,
  lastTrace: StateTrace,
  history: HistoryEntry[],
  tier: Tier,
): string[] {
  const ctx: RenderTriggerContext = { bands, lastTrace, history };

  // Filter by tier and check trigger
  const triggered = RULES.filter(
    (rule) => TIER_RANK[rule.tier] <= TIER_RANK[tier] && rule.check(ctx),
  );

  // Sort by priority, then trace-triggered first at equal priority
  triggered.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    // Tie-break: trace-triggered beats pure-state
    if (a.isTraceTriggered !== b.isTraceTriggered) {
      return a.isTraceTriggered ? -1 : 1;
    }
    return 0;
  });

  // Enforce budget
  const selected = triggered.slice(0, RENDER_BUDGET);
  return selected.map((rule) => rule.text);
}

// ---------------------------------------------------------------------------
// Tier A output formatting
// ---------------------------------------------------------------------------

/**
 * Build the full Tier A render block.
 *
 * @param bands - Current axis bands.
 * @returns The rendered block text (empty string if Tier A produces nothing).
 */
export function buildTierABlock(bands: Record<AxisName, Band>): string {
  const parts: string[] = [formatBandLine(bands)];

  // R1 check: C high && R low
  const r1Triggered = bands.connection === 'high' && bands.restraint === 'low';
  if (r1Triggered) {
    const r1 = RULES.find((r) => r.id === 'R1');
    if (r1) parts.push(r1.text);
  }

  return parts.join('\n\n');
}

/**
 * Build the full emotional render block for prompt injection.
 *
 * For Tier A: always emits the band line (even when no rule fires) with R1
 * appended conditionally. This is the always-on band hint the 12-probe exit
 * check evaluates (F10 fix).
 *
 * For Tier B+: uses `selectRenderRules` with priority/budget/tie-break.
 *
 * @param bands     - Current axis bands.
 * @param lastTrace - Last engine trace.
 * @param history   - Axis history.
 * @param tier      - Render tier.
 * @returns The full block text to inject, or null if nothing to render.
 */
export function buildEmotionalRenderBlock(
  bands: Record<AxisName, Band>,
  lastTrace: StateTrace,
  history: HistoryEntry[],
  tier: Tier,
): string | null {
  if (tier === 'A') {
    // Tier A: band line always; R1 conditionally appended
    return `[当前状态下的行为基调]\n${buildTierABlock(bands)}`;
  }

  // Tier B+: band line always, plus selectRenderRules with priority/budget/tie-break
  const bandLine = formatBandLine(bands);
  const ruleTexts = selectRenderRules(bands, lastTrace, history, tier);
  if (ruleTexts.length === 0) {
    return `[当前状态下的行为基调]\n${bandLine}`;
  }
  return `[当前状态下的行为基调]\n${bandLine}\n\n${ruleTexts.join('\n\n')}`;
}
