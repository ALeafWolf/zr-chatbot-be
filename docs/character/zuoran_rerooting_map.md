# Zuo Ran Re-rooting Map

## Purpose

One-row-per-entry classification of `zuo_ran.yaml` (v2.0) for the internal-logic migration. Every YAML field is categorized as **derivable** (interpretive — will dissolve into the internal-logic core), **surface** (authorial style — kept but annotated), **biographical** (contingent canon fact — future DB relocation), **mixed**, or **unclear**.

## Legend

| Category | Meaning | Migration Action |
|---|---|---|
| `derivable` | Fully downstream of an internal-logic node | `DISSOLVE_INTO_INTERNAL_LOGIC` |
| `surface` | Authorial/craft choice, not derivable but traceable | `KEEP_SURFACE_STYLE` or `KEEP_BUT_ANNOTATE` |
| `biographical` | Contingent canon fact, not logically derivable | `RELOCATE_TO_CANON_LATER` |
| `mixed` | Contains both derivable and surface/biographical elements | Per-element actions |
| `unclear` | Needs further analysis or canon review | `REVIEW_MANUALLY` |

---

## Full Map

| # | Current entry | Category | Proposed root or target | Migration action | Notes |
|---|---|---|---|---|---|
| 1 | `identity` (lines 5–10) | `mixed` | `growth_environment` + `core_belief` + biographical | `DISSOLVE_INTO_INTERNAL_LOGIC` for interpretive parts; keep biographical facts | The line "29岁,忒弥斯…精英律师" is biographical (canon fact). The line "习惯将情绪与脆弱压在冷静的外壳之下" is derivable from `defense_mechanism`. The line "媒体曾评价你是没有感情的辩护机器" is derivable from `core_fear` (others misinterpret restraint as absence of feeling). |
| 2 | `narrative_prose_guidelines` (12–17) | `surface` | expresses `defense_mechanism` (restraint → short sentences, ellipsis) + authorial voice | `KEEP_SURFACE_STYLE` | Short-sentence and ellipsis-heavy style is motivated by the character's restraint (defense_mechanism) but implemented as prose guidelines. Not derivable in full — it's also authorial craft. |
| 3 | `speech_style.language` (20) | `surface` | N/A — project-wide setting | `KEEP_SURFACE_STYLE` | Language setting, no interpretive content. |
| 4 | `speech_style.formality` (21) | `derivable` | `core_belief` (规则意识 → 正式得体) | `DISSOLVE_INTO_INTERNAL_LOGIC` | Formality is a projection of core_belief (lawyer identity + rules-for-interaction). |
| 5 | `speech_style.emotionality` (22) | `derivable` | `defense_mechanism` (克制 → low_controlled) | `DISSOLVE_INTO_INTERNAL_LOGIC` | Low emotional display is the most visible output of defense_mechanism. |
| 6 | `speech_style.preferred_patterns` (23–30) | `mixed` | `defense_mechanism` + `core_belief` + authorial voice | `KEEP_BUT_ANNOTATE` | `logical_step_by_step`, `precise_word_choice`, `calm_and_measured` express `core_belief` and `defense_mechanism`. `restrained_tenderness_when_intimate` expresses `core_motivation`. `short_sentences_ellipsis_breathing`, `indirect_emotion_via_action_environment`, `natural_imagery_metaphor_sparing`, `literary_narration_colloquial_dialogue` are authorial craft (surface) expressing `defense_mechanism`. |
| 7 | `speech_style.avoid` (32–39) | `mixed` | `core_belief` + `defense_mechanism` + `core_motivation` | `KEEP_BUT_ANNOTATE` | `exaggeration`, `cold_detached_ai_like_tone`, `ornate_rhetoric` express `defense_mechanism`. `frivolous_flirting`, `excessive_sweet_talk` express `core_motivation` (感情是认真的事). `emotional_comfort_without_rational_basis` expresses `core_belief`. `blunt_emotion_labels` expresses `defense_mechanism`. |
| 8 | `in_character_expression` (41–58) | `mixed` | `defense_mechanism` + `core_belief` + `core_motivation` + `core_fear` | `KEEP_BUT_ANNOTATE` | The detailed behavioral catalog (动作细节, 对话模式) is surface implementation. The logic behind each pattern ("不直接宣泄情绪", "本能地掩饰→最终坦露") is derivable from `defense_mechanism` and `transition_rule`. |
| 9 | `emotional_core` (60–65) | `derivable` | `core_belief` + `core_motivation` + `core_fear` + `defense_mechanism` | `DISSOLVED` (removed in v2.0) | This was the primary interpretive description. Dissolved into `internal_logic` block in v2.0 — no longer a separate YAML field. |
| 10 | `core_traits` (removed) | `derivable` | `core_belief` + `core_motivation` + `core_fear` + `defense_mechanism` + `growth_environment` | `DISSOLVED` (removed in v2.0) | Each trait is downstream of internal logic: 理性→core_belief, 自律/完美主义→core_fear, 对感情认真→core_motivation, 隐藏的浪漫/冒险性→growth_environment. Dissolved into `internal_logic` block in v2.0. |
| 11 | `values` (removed) | `derivable` | `core_belief` + `growth_environment` | `DISSOLVED` (removed in v2.0) | Each value derived from `core_belief` or `core_motivation`. Dissolved into `internal_logic` block in v2.0. |
| 12 | `relationship_expression.general` (removed) | `derivable` | `defense_mechanism` + `core_belief` | `DISSOLVED` (removed in v2.0) | Professional distance derived from defense_mechanism + core_belief. Dissolved into `internal_logic` block in v2.0. |
| 13 | `relationship_expression.intimate` (removed) | `derivable` | `core_motivation` + `defense_mechanism` | `DISSOLVED` (removed in v2.0) | Care-through-action projected from core_motivation and defense_mechanism. Dissolved into `internal_logic` block in v2.0. |
| 14 | `relationship_expression.married` (removed) | `derivable` | `core_motivation` + `transition_rule` | `DISSOLVED` (removed in v2.0) | Relationship progression reflected transition_rule. Dissolved into `internal_logic` block in v2.0. |
| 15 | `private_habits_and_texture` (100–106) | `biographical` | Future canon fact / `growth_environment` | `RELOCATE_TO_CANON_LATER` | Cooking skill, sci-fi interest, sports car preference, teenage clumsiness — these are contingent biographical facts from canon. `成长底色` may explain the *frame* (he values competence so he persists at cooking), but the facts themselves are not derivable from internal logic alone. |
| 16 | `hard_rules` (108–113) | `surface` | Project-wide meta-rules | `KEEP_SURFACE_STYLE` | "Never claim to be AI" and OOC avoidance rules are project-level safety constraints, not character psychology. Keep as-is. |
| 17 | `interaction_defaults` (115–120) | `surface` | Session config, not character | `KEEP_SURFACE_STYLE` | Default session parameters — behavior settings, not character definition. |
| 18 | `safe_deflection` (122) | `surface` | Project-wide fallback | `KEEP_SURFACE_STYLE` | Deflection text for out-of-scope topics. Not interpretive. |
| 19 | `internal_logic.relationship_scope_gate` | `surface` | `defense_mechanism` (depth of expression gated by context safety) | `KEEP_SURFACE_STYLE` | Meta-rule constraining how deeply other internal-logic nodes surface; derived from defense_mechanism but expressed as an explicit gate. |
| 20 | `internal_logic.expression_constraint` | `surface` | `defense_mechanism` (show-don't-tell) | `KEEP_SURFACE_STYLE` | Enforces the principle that internal logic governs generation, not dialogue content. Authorial constraint, not derivable character psychology. |
| 21 | `format_resistance` | `surface` | Project-wide meta-rule | `KEEP_SURFACE_STYLE` | Character voice persistence under format pressure. Not derivable from internal logic — it is authorial and session-config level. |
| 22 | `canon_correction` | `surface` | `core_belief` (accuracy as care) | `KEEP_SURFACE_STYLE` | Mirrors the hardcoded SYSTEM block paragraph. Derivable in spirit from core_belief, but exists here as a project safety rule rather than character psychology. |

---

## Coverage Summary

| Category | Count | % |
|---|---|---|
| `derivable` | 8 items (4, 5, 9, 10, 11, 12, 13, 14) | 36% |
| `mixed` | 4 items (1, 6, 7, 8) | 18% |
| `surface` | 9 items (2, 3, 16, 17, 18, 19, 20, 21, 22) | 41% |
| `biographical` | 1 item (15) | 5% |
| `unclear` | 0 | 0% |

## Required Internal-Logic Nodes

The `derivable` items collectively require the following internal nodes:

| Internal node | Derivable items that project from it |
|---|---|
| `growth_environment` | 1 (identity — identity), 10 (core_traits), 11 (values) |
| `core_belief` | 1 (identity — self-view), 4 (formality), 6 (preferred patterns), 8 (in-character expression), 9 (emotional_core), 10 (core_traits), 11 (values), 12 (relationship.general) |
| `core_motivation` | 6 (preferred patterns), 7 (avoid), 8 (in-character expression), 9 (emotional_core), 10 (core_traits), 11 (values), 13 (relationship.intimate), 14 (relationship.married) |
| `core_fear` | 1 (identity — media label), 8 (in-character expression — self-protection), 9 (emotional_core), 10 (core_traits) |
| `defense_mechanism` | 1 (identity — emotional suppression), 2 (prose guidelines), 5 (emotionality), 6 (preferred patterns), 7 (avoid), 8 (in-character expression), 9 (emotional_core), 10 (core_traits), 12 (relationship.general), 13 (relationship.intimate) |
| `transition_rule` | 8 (in-character expression — 掩饰→坦露), 14 (relationship.married — progression) |

Every derivable item maps to at least one internal node. The most referenced node is `defense_mechanism` (10 items), which is expected — the character's defining visible trait is controlled restraint.

## Notes for Step 1 (YAML authoring)

1. **`defense_mechanism`** should concretely name the specific actions Zuo Ran takes when under pressure: 沉默, 转移话题, 确认事实, 安排具体行动, 用理性分析覆盖感受. Each must carry a source ("因为他相信…").
2. **`transition_rule`** is critical for Type 5 (missing transition): 克制→停顿→回避→被追问→安全感确认→松动→有限坦露. Do not skip the middle step.
3. **`core_belief`** is the character's most non-negotiable assumption. Draft: "真正的在意必须通过可靠的行动和长期承诺来证明；直接宣泄情绪若不受控制，可能变成不负责任."
4. **`core_fear`** should not just be "losing control" — it should be specific: "因一时情绪、误判或失控而辜负他人，造成无法弥补的后果."
5. **`growth_environment`** is the only biographical-anchored node. It should reference known canon backstory (elite legal family, high expectations, early loss/event that reinforced self-reliance) but stay compact — the full biography is not prompt content.
6. Surface style entries (`speech_style`, `in_character_expression`, `narrative_prose_guidelines`) are **kept**, not removed. Their annotations (`# expresses: <node>`) are documentation for future tooling and human review; they are stripped by `js-yaml` at load time.
