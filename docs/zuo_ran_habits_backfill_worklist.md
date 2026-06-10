# Zuo Ran — `private_habits_and_texture` Backfill Worklist

> **Purpose:** No-data-loss preservation artifact created **before** trimming
> `private_habits_and_texture` to the 3 universal always-on items (Phase A,
> Step 10). Every relocated line is mapped to a target internal-logic node,
> its seed-backing status today, and a backfill route for Phase B.
>
> Once Phase B ingests canon scenes and promotes/mines evidence, the
> relocated texture will be retrievable via
> `[CHARACTER INTERNAL LOGIC EVIDENCE]` instead of being always-on in
> `[习惯与质感]`.

---

## 1. Pre-Trim Verbatim Snapshot

This is the **exact** content of `private_habits_and_texture` from
`src/character/defaults/zuo_ran.yaml` (lines 176–194) **before** any trim,
captured on 2026-05-31. It is the no-data-loss guarantee — every line and
`#` sub-comment is reproduced verbatim.

```yaml
private_habits_and_texture:
  # 紧张/思考时的小动作
  - 紧张或有心事时，可能会不自觉揉捏手边的小物件（家里的生日小熊都被他捏得头不圆了）
  - 思考时动作细微，常表现为停顿、垂眼、整理袖口或轻触指节
  - 婚后的新习惯：思考时会转妻子手指上的戒指
  # 兴趣爱好
  - 喜欢刺激性运动（射击、赛车、冲浪），都很擅长，但不会张扬炫耀
  - 是个影评人，马甲叫"知更鸟"；最喜欢科幻和文艺片，但好看的都看，动画片也看
  - 喜欢科幻小说
  # 烹饪
  - 擅长烹饪，但拔丝红薯至今做不好，一直不肯放弃
  # 少年感/笨拙
  - 高中时会撬锁跑到天台吃午饭；边走路边背单词，被旁边鬼屋尖叫声吓到差点撞电线杆
  - 收到情书，不想直接扔掉糟蹋女孩子心意也不想收下，跑去小区找地方埋情书，被人撞见
  - 药太苦会偷喝冰箱里的饮料，但事后会乖乖承认
  - 会学卖糖炒栗子的老婆婆的口音说"小姑娘又来买糖炒栗子哒"
  # 恋爱中的预判式浪漫
  - 出差会在行李箱留出方正的空间放礼物和特产，飞机落地前订好花，回家就送
  - 喜欢上你之后，副驾驶换了更舒适的垫子和更清新的车载香水
```

**13 items total** (3 keep + 10 relocate).

---

## 2. Keep-Set (Always-On After Trim)

These 3 universal lines remain in `private_habits_and_texture` after the
trim. They are broadly applicable across turns and serve as always-on
behavior texture rather than scenario-specific recall.

| # | Line | Verbatim Text |
|---|------|---------------|
| K1 | 揉捏小物件 | 紧张或有心事时，可能会不自觉揉捏手边的小物件（家里的生日小熊都被他捏得头不圆了） |
| K2 | 停顿/垂眼/袖口 | 思考时动作细微，常表现为停顿、垂眼、整理袖口或轻触指节 |
| K3 | 婚后转戒指 | 婚后的新习惯：思考时会转妻子手指上的戒指 |

---

## 3. Backfill Table — Relocated Lines

### Source Mapping

Each row corresponds to one relocated YAML line. The target node, seed
status, and backfill route are cross-checked against
`src/character/internalLogic/evidenceSeeds.ts` (opened 2026-05-31 — see
pointer in §5).

| # | YAML Line (abbrev.) | Verbatim YAML Text | Target Internal-Logic Node | Seed Today (seedId + applyStatus) | Backfill Route | Dramatized Canon Scene Likely? |
|---|---|---|---|---|---|---|
| 1 | 刺激性运动 | 喜欢刺激性运动（射击、赛车、冲浪），都很擅长，但不会张扬炫耀 | **no suitable node yet / re-keep candidate** | **no seed** | hand-author biographical seed — no dramatized scene found in DB or plot sources — or consciously re-keep always-on | Unlikely (hobby preference, not a narrative event) |
| 2 | 影评人/知更鸟 | 是个影评人，马甲叫"知更鸟"；最喜欢科幻和文艺片，但好看的都看，动画片也看 | **no suitable node yet / re-keep candidate** | **no seed** | character-bible / app-social provenance exists (`ni_wo_zhi_jian` units 48-49 confirm 知更鸟 alias) → hand-author biographical seed, or re-keep always-on | Partial — DB confirms 知更鸟 alias in app-social context, but no narrative scene dramatizes it |
| 3 | 科幻小说 | 喜欢科幻小说 | **no suitable node yet / re-keep candidate** | **no seed** | borderline-universal preference; hand-author or re-keep always-on | Unlikely (a taste preference) |
| 4 | 烹饪/拔丝红薯 | 擅长烹饪，但拔丝红薯至今做不好，一直不肯放弃 | **no suitable node yet / re-keep candidate** | **no seed** | borderline-universal; hand-author or re-keep always-on | Partial — DB confirms roasting sweet potatoes at campfire (`jin_shu_feng_hui` Ep2-3), but the specific "拔丝红薯做不好" claim is not in DB |
| 5 | 高中撬锁天台/撞电线杆 | 高中时会撬锁跑到天台吃午饭；边走路边背单词，被旁边鬼屋尖叫声吓到差点撞电线杆 | `defense_mechanism` | `zuo_ran_defense_mechanism_02` — **candidate** (`applyStatus: "candidate"`) | verify canon-DB scene → flip `applyStatus` to `"active"` → `npm run seed:internal-logic -- --apply` | Unknown — no DB or plot-source match found for these teenage anecdotes |
| 6 | 埋情书 | 收到情书，不想直接扔掉糟蹋女孩子心意也不想收下，跑去小区找地方埋情书，被人撞见 | `defense_mechanism` | `zuo_ran_defense_mechanism_02` — **candidate** (same seed as #5) | same route as #5 (same seed) | Unknown — no DB or plot-source match found |
| 7 | 偷喝饮料后承认 | 药太苦会偷喝冰箱里的饮料，但事后会乖乖承认 | `defense_mechanism` | `zuo_ran_defense_mechanism_02` — **candidate** (same seed as #5) | same route as #5 (same seed) | Unknown — no DB or plot-source match found |
| 8 | 学老婆婆口音 | 会学卖糖炒栗子的老婆婆的口音说"小姑娘又来买糖炒栗子哒" | `defense_mechanism` (texture) | **no seed** (not covered by `_02` or any other seed) | ingest canon scene from available sources, or hand-author a seed; if no scene found → re-keep candidate | Unknown — 栗子/板栗 exists in DB camping context, but the specific 老婆婆口音 story does not |
| 9 | 行李箱礼物/订花 | 出差会在行李箱留出方正的空间放礼物和特产，飞机落地前订好花，回家就送 | `core_motivation` | `zuo_ran_core_motivation_01` — **candidate** (`applyStatus: "candidate"`) | verify canon-DB scene → flip to `"active"` → `npm run seed:internal-logic -- --apply` | Partial — DB confirms suitcase+letter (`jin_shu_feng_hui` Ep6), but the specific gift/flower-before-landing details are not in DB |
| 10 | 副驾驶垫子/香水 | 喜欢上你之后，副驾驶换了更舒适的垫子和更清新的车载香水 | `core_motivation` | `zuo_ran_core_motivation_01` — **candidate** (same seed as #9) | same route as #9 (same seed) | Unlikely — no DB or plot-source match found for car-seat/香水 details |

### Borderline-Universal Notes

- **#3 (科幻小说):** Very short (6 chars), low-risk, universally applicable
  taste preference. A reasonable case exists for keeping it always-on.
- **#4 (拔丝红薯):** A quirky personal detail that reads as a universal
  character trait rather than a scenario-specific anecdote. A reasonable case
  exists for keeping it always-on.

Both are flagged as **re-keep candidates** in the backfill route above. The
verbatim snapshot guarantees no loss regardless of the final decision.

---

## 4. Phase B Runbook

> **Phase B is the user's canon-dependent follow-up.** It is NOT implemented
> in this change. This runbook documents the commands and order of operations
> for closing the Step 10 gate after canon scenes are ingested.

### Precondition

Canon-DB scenes have been ingested (or plot-source documents added to
`documents/plot-sources/`). The goal is to verify each relocated line against
canon and make it retrievable via `[CHARACTER INTERNAL LOGIC EVIDENCE]`.

### Workflow

#### Step B1 — Review existing `proposed` rows (before any new mining)

```bash
# Inert rows at status='proposed' may already exist from prior runs.
# They are NOT retrievable until promoted. Review them first to avoid
# creating duplicates.
npm run mine:internal-logic -- --character zuo_ran --list-proposed
```

Review any existing proposed rows — do **not** promote them solely because
they look useful. Each proposed row must be human-validated:

- Verify the evidence text against its canon/source (DB scene or
  plot-source document).
- Confirm the row belongs in its assigned `node` and does not duplicate an
  existing seed or active row.
- If valid, promote:

```bash
npm run mine:internal-logic -- --promote <id1> <id2> ...
```

If a proposed row cannot be provenance-validated, leave it as `proposed`
or discard it. Unvalidated proposed rows are not safe to promote.

#### Step B2 — Promote candidate seeds to `active` (lines #5–7, #9–10)

For each candidate seed whose canon-DB evidence has been verified:

1. Edit `src/character/internalLogic/evidenceSeeds.ts`:
   - Set `applyStatus` from `"candidate"` to `"active"`
   - Optionally update `episodeLabel`, `sceneOrder`, `unitIndex` with
     verified DB provenance
2. Apply the seed fixture to the DB:

```bash
npm run seed:internal-logic -- --apply
```

> **Caveat:** `--apply` writes all seeds with `applyStatus: "active"` to the
> DB. Candidate seeds are **skipped** — this is by design. Only flip seeds
> whose canon provenance you have independently verified.

#### Step B3 — Mine new evidence from canon scenes (lines #8 and any new scenes)

```bash
# Mine from ingested canon stories. Rows land at status='proposed' (INERT —
# retrieval filters on 'active' only, so these are invisible until promoted).
npm run mine:internal-logic -- --character zuo_ran --apply
```

#### Step B4 — Human-review and promote mined rows

```bash
# List newly mined proposed rows:
npm run mine:internal-logic -- --character zuo_ran --list-proposed
```

Before promoting, human-review each proposed row:

- Verify the evidence text matches the canon scene it was mined from.
- Confirm the assigned `node` is correct for the evidence.
- Check for duplication against existing seeds and active rows.
- Record provenance fields (`episodeLabel`, `sceneOrder`, `unitIndex`, etc.)
  where available.

Only after validation, promote:

```bash
npm run mine:internal-logic -- --promote <id1> <id2> ...
```

> **Inert-`proposed` caveat:** Rows mined with `--apply` land at
> `status = 'proposed'`. They are **not** surfaced by the retrieval reranker
> until promoted. `--promote` is mandatory — do not skip it. However,
> mandatory does not mean automatic — promote only validated rows.

#### Step B5 — Hand-author or re-keep (lines #1–4, and #8 if no canon scene exists)

For lines with no suitable node or no dramatized canon scene:

1. **Choose a target node or re-keep always-on.** If a line has no suitable
   node (e.g. 刺激性运动, 影评人/知更鸟), first evaluate whether a valid
   `internal_logic` node can be justified based on the available provenance.
   If no node is clearly justified, do **not** create a seed — instead,
   consciously re-keep the line in `private_habits_and_texture` as always-on
   (the worklist flags it as a re-keep candidate; the verbatim snapshot
   guarantees no data loss either way).

2. **Start as `candidate` unless provenance is independently verified.**
   If a hand-authored seed is created, set `applyStatus: "candidate"` unless
   independent canon/source provenance (a DB scene, a plot-source document,
   or an equivalent verifiable reference) has been recorded in the seed's
   `provenanceNote` and provenance fields. Do **not** set `applyStatus:
   "active"` merely because the seed was hand-authored — per
   `evidenceSeeds.ts` policy, `"active"` is reserved for seeds whose claim
   and evidence text have been independently canon/source-grounded.

3. **Only promote to `active` after provenance is recorded.** Once
   independent provenance is verified and the seed's
   `provenanceNote`/`episodeLabel`/`sceneOrder`/`unitIndex` fields are
   populated, flip `applyStatus` to `"active"` and run
   `npm run seed:internal-logic -- --apply`.

4. **Existing `proposed` rows require human review before promotion.**
   Do not promote mined `proposed` rows solely because they look useful.
   Each must be human-reviewed: verify the evidence text against its source,
   confirm it belongs in the target node, and validate that it doesn't
   duplicate an existing seed or active row. Only then use
   `npm run mine:internal-logic -- --promote <id...>`.

#### Step B6 — Validate retrieval quality

```bash
# Seed validation — checks that each active seed's embedding returns as #1
# for its curated validation queries:
npm run seed:internal-logic -- --validate

# Probe judge — full gate eval with LLM-as-judge (requires LangSmith):
EVAL_ENABLE_LLM_JUDGE=1 npm run eval:langsmith
```

Confirm that the relocated items surface on relevant turns and that probe
scores do not regress relative to the pre-trim baseline.

---

## 5. Pointers

| Reference | Location |
|-----------|----------|
| Plan §Step 10 — Trim `private_habits_and_texture` | `documents/character_internal_logic_plan_final.md` (line 436) |
| Evidence seeds fixture (seed IDs, applyStatus, node mapping) | `src/character/internalLogic/evidenceSeeds.ts` |
| Prior conservative trim audit (removed 3 items already backed by active evidence) | `agent-workspace/handoff/trim-private-habits-and-promote-evidence/implementation-notes.md` |

---

## 6. Prior Trim History

The current 13-item baseline (3 keep + 10 relocate) is the state **after**
the prior conservative trim (`trim-private-habits-and-promote-evidence`,
TG3), which removed 3 items already covered by active evidence seeds
(糖醋里脊 → `growth_environment_01`, 棉花糖 → `core_fear_01`, 恶意信件 →
`core_motivation_02`). See the prior audit for that full analysis.

Items removed in that prior trim are **not** included in this worklist's
verbatim snapshot (which captures the post-conservative-trim baseline). The
prior audit is the source of truth for those already-relocated items.

---

*Generated 2026-05-31 as part of change `trim-internal-logic-habits` (TG1).*
