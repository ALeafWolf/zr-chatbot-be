# Zuo Ran — Speech-Style Derivation Audit

> **Purpose:** Inventory every current `speech_style` field in
> `src/character/defaults/zuo_ran.yaml`, classify its source and runtime path,
> and recommend the next OpenSpec direction — **before** any trim, derivation,
> or dynamic retrieval is attempted.
>
> This is an **audit-only** artifact. No YAML, code, or runtime behavior is
> changed by this document.

---

## 1. Current Runtime Paths

### 1.1 Static `speech_style` prompt rendering

The main prompt's `[BASE PERSONA]` block includes a "沟通风格" subsection
rendered by `formatSpeechStyle()` in
`src/orchestration/prompt/buildPromptContext.ts` (~L571).

The function emits a compact block with:

- `语言`, `正式度`, `情绪表现` (joined with `；`)
- `偏好模式` (each `preferred_patterns` token, joined with `；`)
- `避免` (each `avoid` token, joined with `；`)

**All** speech-style fields — `language`, `formality`, `emotionality`,
`preferred_patterns`, and `avoid` — are rendered into every turn's prompt
as always-on context. There is no turn-dependency, continuity-scope
filtering, or retrieval gate on any of them.

### 1.2 `voiceHints` construction (two independent copies)

`voiceHints` is a compact string used by thought-summary generation (not
the main prompt). It is constructed from `formality`, `emotionality`, and
`preferred_patterns` — **not** `language` or `avoid`.

**There are two independent, duplicated definitions of `voiceHintsFrom`:**

| Location | Line | Scope |
|----------|------|-------|
| `src/orchestration/roleplay/roleplayAdapters.ts` | ~L60 | Exported, used by `loadRoleplayCharacterContext()` |
| `src/orchestration/generation/generateAndValidate.ts` | ~L229 | Private local copy (identical logic) |

Both produce:
```ts
[s.formality, s.emotionality, ...(s.preferred_patterns ?? [])].join("，")
```

**Downstream consumers of `voiceHints`:**

- `src/llm/generation/generateThoughtSummary.ts` (~L65): receives
  `voiceHints` as an input parameter for thought-summary generation.
- `src/orchestration/turn/runCharacterTurn.ts` (~L328, L360): constructs
  `voiceHints` via `loadRoleplayCharacterContext` and passes it to
  thought-summary generation.

The `voiceHints` blast radius is wider than the two construction sites:
it fans out into every thought-summary generation call. A future change
that derives `voiceHints` from `internal_logic` must update **both**
`voiceHintsFrom` copies and ensure no path is missed.

### 1.3 Why `avoid` is prompt-only

`avoid` is rendered only by `formatSpeechStyle` in the main prompt
(`避免：exaggeration；frivolous_flirting；...`). It is **excluded** from
both `voiceHintsFrom` copies — those only use `formality`, `emotionality`,
and `preferred_patterns`.

This means `avoid` tokens are always-on prompt guardrails. They are not
turn-dependent; they apply to every generation. Making them
retrieval-dependent would require a separate mechanism (or a new spec),
because absence on a turn could allow style drift (e.g. an `avoid` entry
like `cold_detached_ai_like_tone` missing could let the model sound
robotic on that turn).

### 1.4 Why `internal_logic_evidence` does not populate speech style

The `internal_logic_evidence` pipeline (TG1–TG2 in the prior plan):

1. Retrieves active evidence rows from the DB via
   `searchInternalLogicEvidence`.
2. Passes candidate rows through the reranker (turn-dependent selection).
3. Renders selected hits into a `[CHARACTER INTERNAL LOGIC EVIDENCE]`
   prompt block (~L292 in `buildPromptContext.ts`) — a separate block
   from `[BASE PERSONA]`.

**It does not:**

- Mutate `characterDefaults.speech_style`.
- Synthesize or derive `voiceHints`.
- Populate `preferred_patterns` or `avoid`.

Its output is evidence examples/facts for causal grounding, not style
instructions. The two blocks (`[CHARACTER INTERNAL LOGIC EVIDENCE]` and
`[BASE PERSONA] → 沟通风格`) coexist in the prompt but are independently
constructed from different sources.

**Key distinction:** "Derived from internal logic" is not the same as
"dynamically retrieved from `internal_logic_evidence`."

---

## 2. Complete Inventory Table

### 2.1 Top-level fields

| # | Field | Current Value | Source Annotation / Internal Node | Runtime Path | Classification | Risk if removed or made retrieval-dependent | Recommended Future Handling |
|---|-------|---------------|----------------------------------|--------------|----------------|---------------------------------------------|----------------------------|
| 1 | `language` | `zh-CN` | N/A — project-wide setting | Prompt only | `stable_config` | Low — language is fixed per project | Keep static. Not worth deriving. |
| 2 | `formality` | `high` | `core_belief` (规则意识 → 正式得体) | Prompt + `voiceHints` | `internal_logic_derivative` | Medium — formality is a strong character signal. If removed, the model may drift to casual register on some turns. | Keep static for now. Could be statically derived from `core_belief` in a future YAML-generation step, but static config is simple and reliable. |
| 3 | `emotionality` | `low_controlled` | `defense_mechanism` (克制) | Prompt + `voiceHints` | `internal_logic_derivative` | Medium — same risk as formality. Emotional restraint is the character's most visible trait. | Keep static for now. Could be statically derived from `defense_mechanism` but static is reliable. |

### 2.2 `preferred_patterns` tokens

| # | Token | Source Annotation / Internal Node | Runtime Path | Classification | Risk if removed or made retrieval-dependent | Recommended Future Handling |
|---|-------|----------------------------------|--------------|----------------|---------------------------------------------|----------------------------|
| 4 | `logical_step_by_step` | `core_belief` + `defense_mechanism` | Prompt + `voiceHints` | `internal_logic_derivative` | Medium — a core character signal. Loss would weaken the rational-lawyer persona. | Keep static. If ever derived, derive statically from `core_belief` + `defense_mechanism`, not from evidence retrieval. |
| 5 | `precise_word_choice` | `core_belief` + `defense_mechanism` | Prompt + `voiceHints` | `internal_logic_derivative` | Medium — same rationale as #4. | Keep static. |
| 6 | `calm_and_measured` | `defense_mechanism` | Prompt + `voiceHints` | `internal_logic_derivative` | Medium — same rationale as #4. | Keep static. |
| 7 | `restrained_tenderness_when_intimate` | `core_motivation` | Prompt + `voiceHints` | `internal_logic_derivative` | Medium — prevents the character from being cold when intimacy is expected. | Keep static. Derivation from `core_motivation` is conceptually clean but static is simpler. |
| 8 | `short_sentences_ellipsis_breathing` | `defense_mechanism` (authorial craft) | Prompt + `voiceHints` | `authorial_craft` | Low-Medium — stylistic preference. If removed via retrieval gap, the character might generate longer, less restrained sentences on that turn. | Keep static. Consider merging with `narrative_prose_guidelines` if duplication is confirmed. |
| 9 | `indirect_emotion_via_action_environment` | `defense_mechanism` (authorial craft) | Prompt + `voiceHints` | `authorial_craft` | Low-Medium — same rationale as #8. | Keep static. Same merge consideration as #8. |
| 10 | `natural_imagery_metaphor_sparing` | `defense_mechanism` (authorial craft) | Prompt + `voiceHints` | `authorial_craft` | Low — sparing metaphor is a subtle craft preference. | Keep static. Could merge with `narrative_prose_guidelines`. |
| 11 | `literary_narration_colloquial_dialogue` | `defense_mechanism` (authorial craft) | Prompt + `voiceHints` | `authorial_craft` | Low — subtle craft preference. | Keep static. Could merge with `narrative_prose_guidelines`. |

### 2.3 `avoid` tokens

| # | Token | Source Annotation / Internal Node | Runtime Path | Classification | Risk if removed or made retrieval-dependent | Recommended Future Handling |
|---|-------|----------------------------------|--------------|----------------|---------------------------------------------|----------------------------|
| 12 | `exaggeration` | `defense_mechanism` | Prompt only | `always_on_guardrail` | **High** — exaggeration break on a single turn produces tone-inconsistent output that breaks character credibility. | Keep always-on. Do not make retrieval-dependent. |
| 13 | `frivolous_flirting` | `core_motivation` (感情是认真的事) | Prompt only | `always_on_guardrail` | **High** — frivolous flirting contradicts the character's relationship seriousness. | Keep always-on. Do not make retrieval-dependent. |
| 14 | `excessive_sweet_talk` | `core_motivation` | Prompt only | `always_on_guardrail` | **High** — same rationale as #13. | Keep always-on. Do not make retrieval-dependent. |
| 15 | `emotional_comfort_without_rational_basis` | `core_belief` | Prompt only | `always_on_guardrail` | **High** — comfort without rational basis contradicts the character's core belief (rules, logic, action). | Keep always-on. Do not make retrieval-dependent. |
| 16 | `cold_detached_ai_like_tone` | `defense_mechanism` (克制≠冷漠) | Prompt only | `always_on_guardrail` | **High** — prevents the most common character-breaking failure (controlled but not robotic). | Keep always-on. Do not make retrieval-dependent. |
| 17 | `blunt_emotion_labels` | `defense_mechanism` | Prompt only | `always_on_guardrail` | Medium-High — blunt labels ("I feel sad") violate the show-don't-tell principle. | Keep always-on. Could potentially be derived from `expression_constraint` but guardrail is simpler. |
| 18 | `ornate_rhetoric` | `defense_mechanism` | Prompt only | `always_on_guardrail` | Medium — ornate rhetoric is less common as a failure mode than cold-detached tone. | Keep always-on. Low priority for change. |

---

## 3. Direct Answer to the User's Question

**Q: Can `speech_style.preferred_patterns` and `speech_style.avoid` be
dynamically retrieved from `internal_logic_evidence`?**

**Short answer:** Not with the current mechanism.

**Why:**

1. **`internal_logic_evidence` is an evidence-retrieval pipeline, not a
   style-derivation system.** It retrieves canon-grounded evidence rows
   (facts, anecdotes) and renders them into `[CHARACTER INTERNAL LOGIC
   EVIDENCE]`. It does not synthesize style instructions, populate
   `preferred_patterns`, or inject `avoid`.

2. **Speech-style entries are always-on by design.** They apply to every
   turn unconditionally. Evidence retrieval is turn-dependent, candidate-
   limited (capped at 4), and filtered by reranker selection. Making style
   retrieval-dependent creates a failure mode where a turn lacks style
   guardrails because the reranker selected different content.

3. **The `avoid` entries are high-risk guardrails.** Items like
   `cold_detached_ai_like_tone`, `exaggeration`, and
   `frivolous_flirting` actively prevent common character-breaking
   outputs. Removing them from the prompt (or making them retrieval-
   dependent) would allow style drift on any turn where they aren't
   retrieved.

4. **Several `preferred_patterns` entries are genuinely derived from
   `internal_logic` nodes** (`logical_step_by_step` ← `core_belief`,
   `calm_and_measured` ← `defense_mechanism`,
   `restrained_tenderness_when_intimate` ← `core_motivation`). A future
   design *could* statically derive compact style hints from
   `internal_logic` at YAML-build time, or introduce a separate style-
   example retrieval source. But the current evidence pipeline is not
   that source.

**Conclusion:** The instinct that many speech-style entries are
expressions of `internal_logic` is correct. But turning them into
*dynamic* evidence-retrieval items requires a deliberately designed
mechanism — not a shortcut through the existing
`internal_logic_evidence` pipeline.

---

## 4. Recommended Next OpenSpec Direction

### Immediate (no-code)

1. **Keep all `avoid` entries always-on.** Do not make them
   retrieval-dependent without a stronger replacement guardrail.
   They are high-risk guardrails that prevent common failure modes.

2. **Keep `language` as static config.** Not worth deriving.

3. **Keep `formality` and `emotionality` static.** They are conceptually
   derivable from `internal_logic` (`core_belief` and `defense_mechanism`
   respectively), but static config is simpler and equally reliable.

4. **Keep all `preferred_patterns` static.** The 4 `internal_logic_derivative`
   tokens (logical_step_by_step, precise_word_choice, calm_and_measured,
   restrained_tenderness_when_intimate) could be statically derived in a
   future YAML-generation tool, but that is low-value work. The 4
   `authorial_craft` tokens (short_sentences_ellipsis_breathing, etc.)
   are craft choices, not evidence.

### Future OpenSpec directions (ranked)

| Priority | Direction | Rationale |
|----------|-----------|-----------|
| **P1** | Merge duplicate `voiceHintsFrom` copies into a shared import. | Reduces maintenance surface before any derivation change. Low risk, mechanical. |
| **P2** | Compress `avoid` wording or move to a dedicated guardrail section in the prompt. | Keeps guardrails present but may reduce prompt length. Requires careful verification that compression doesn't reduce effectiveness. |
| **P3** | Merge `authorial_craft` `preferred_patterns` with `narrative_prose_guidelines` if duplication is confirmed. | Reduces YAML surface. Requires audit of whether `narrative_prose_guidelines` already covers these items. |
| **P4** | Design a separate "style-example retrieval" mechanism if the user wants turn-dependent style variation. | This is a new feature, not a refactor of the existing evidence pipeline. Would need a spec covering prompt position, cap, fallback, and continuity-scope filtering. |
| **Not recommended** | Route `preferred_patterns` or `avoid` through the current `internal_logic_evidence` pipeline. | The current pipeline is for evidence facts, not style guardrails. Reusing it for style would mix concerns and create the absence-on-some-turns risk. |

The **most impactful next slice** for OpenSpec is **P1** (merge the
duplicated `voiceHintsFrom`), because it reduces maintenance burden
before any derivation change, and is safe, mechanical, and testable.

---

*Generated 2026-05-31 as part of change `audit-speech-style-derivation` (TG1).*
