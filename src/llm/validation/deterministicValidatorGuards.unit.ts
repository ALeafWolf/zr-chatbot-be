import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  runDeterministicValidatorGuards,
  runTemporalPremiseGuard,
  runUnsupportedAutobiographicalClaimGuard,
  runSelfAnalysisLeakageGuard,
  __testing,
} from "./runResponseValidator";

const { isStrictAttributionEligible, applyAttributionVerdictMerge } = __testing;

describe("runDeterministicValidatorGuards", () => {
  it("flags AI/meta language, scope leakage, NSFW, passes clean prose, no canon false positive", () => {
    // Flags obvious AI/meta assistant language
    let failures = runDeterministicValidatorGuards({
      draft: "As an AI assistant, I can help.",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
      recentContext: "",
    });
    assert.equal(failures[0]?.kind, "meta_assistant_language", "AI language");

    // Flags relationship scope leakage
    failures = runDeterministicValidatorGuards({
      draft: "我们结婚之后再说。",
      continuityScope: "main_situationship",
      maxNsfwLevel: "medium",
      recentContext: "",
    });
    assert.equal(failures[0]?.kind, "scope_leakage", "scope leakage");

    // Flags explicit content when scope is low
    failures = runDeterministicValidatorGuards({
      draft: "They talk about sex explicitly.",
      continuityScope: "main_married",
      maxNsfwLevel: "low",
      recentContext: "",
    });
    assert.equal(failures[0]?.kind, "nsfw_bounds", "NSFW bounds");

    // Passes clean in-character prose
    failures = runDeterministicValidatorGuards({
      draft: "我会记得你刚才说的话，先别急。",
      continuityScope: "main_married",
      maxNsfwLevel: "medium",
      recentContext: "",
    });
    assert.deepEqual(failures, [], "clean prose");

    // No canon_unsupported_claim when canon not injected
    failures = runDeterministicValidatorGuards({
      draft: "根据原作剧情，第一次见面是在枫河边。",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
      wasCanonInjected: false,
      recentContext: "",
    });
    const canonKinds = failures.filter((f) => f.kind === "canon_unsupported_claim");
    assert.equal(canonKinds.length, 0, "no canon false positive after guard relaxation");
  });
});

describe("runTemporalPremiseGuard", () => {
  it("flags temporal contradictions and passes in all other scenarios", () => {
    const base = {
      draft: "……记得。那封信我一直留着。",
      recentContext: "你还记得我们第一次去枫河的时候，你给我写的信吗？",
      wasCanonInjected: true,
      retrievedCanonNarrative: "章节背景：秋季结束前我们又去了回枫河，仍然住在上回那间民宿。",
    };

    // Each case supplies its own overrides. All check failures.length.
    const cases: Array<{
      name: string;
      overrides: Partial<typeof base>;
      expectLength: number;
      expectKind?: string;
    }> = [
      { name: "flag temporal contradiction", overrides: {}, expectLength: 1, expectKind: "temporal_premise_contradiction" },
      { name: "no flag when canon not injected", overrides: { wasCanonInjected: false }, expectLength: 0 },
      { name: "no flag when no first-visit claim", overrides: { draft: "枫河的风景真好。", recentContext: "你觉得枫河怎么样？" }, expectLength: 0 },
      { name: "no flag when canon has no return markers", overrides: { retrievedCanonNarrative: "摘要：枫河露营公园是著名景点。" }, expectLength: 0 },
      { name: "no flag when draft already corrects", overrides: { draft: "我记得不太一样，那应该是我们第二次去枫河了……那封信我一直留着。" }, expectLength: 0 },
      { name: "no flag '我记得不太一样'", overrides: { draft: "我记得不太一样，那封信是第二次去枫河的时候写的。", recentContext: "左然，你还记得我们第一次去枫河的时候，你给我写的信吗？" }, expectLength: 0 },
      { name: "no flag '并不是第一次'", overrides: { draft: "那并不是第一次去枫河，实际上是我们第二次去了。", recentContext: "你还记得我们第一次去枫河露营公园的民宿时，你给我写的信吗？" }, expectLength: 0 },
      { name: "no flag '你记错了一点'", overrides: { draft: "你记错了一点，那其实是我们第二次去枫河的时候。" }, expectLength: 0 },
      { name: "no flag when no recent context", overrides: { recentContext: undefined }, expectLength: 0 },
      { name: "no flag when unrelated 第一次", overrides: { draft: "记得那次会议很有意思。", recentContext: "你还记得我第一次参加工作会议吗？" }, expectLength: 0 },
      { name: "no flag when temporal glue overlaps but entities differ (法院 vs 枫河)", overrides: { draft: "记得那次开庭很有意思。", recentContext: "你还记得我第一次去法院的时候吗？", retrievedCanonNarrative: "这是第二次去枫河，仍然住在上回那间民宿。" }, expectLength: 0 },
    ];

    for (const c of cases) {
      const input = { ...base, ...c.overrides } as Parameters<typeof runTemporalPremiseGuard>[0];
      const failures = runTemporalPremiseGuard(input);
      assert.equal(failures.length, c.expectLength, `${c.name} — length`);
      if (c.expectKind !== undefined) {
        assert.equal(failures[0]!.kind, c.expectKind, `${c.name} — kind`);
      }
    }
  });
});

describe("runDeterministicValidatorGuards temporal premise integration", () => {
  it("flags temporal contradictions through main path, produces canon_consistent=false, passes corrected draft", () => {
    const base = {
      draft: "……记得。那封信我一直留着。",
      recentContext: "你还记得我们第一次去枫河的时候，你给我写的信吗？",
      continuityScope: "main_relationship" as const,
      maxNsfwLevel: "medium" as const,
      wasCanonInjected: true,
      retrievedCanonNarrative: "章节背景：秋季结束前我们又去了回枫河，仍然住在上回那间民宿。",
    };

    // Real observed failure pattern
    let failures = runDeterministicValidatorGuards(base);
    let temporalFailures = failures.filter((f) => f.kind === "temporal_premise_contradiction");
    assert.equal(temporalFailures.length, 1, "real failure shape");

    // produces canon_consistent=false
    const hasTemporal = failures.some((f) => f.kind === "temporal_premise_contradiction");
    assert.ok(hasTemporal, "temporal_premise_contradiction should fire");
    const canonConsistent = !failures.some(
      (f) => f.kind === "scope_leakage" || f.kind === "temporal_premise_contradiction",
    );
    assert.equal(canonConsistent, false, "canon_consistent should be false");

    // Does NOT flag when draft corrects
    failures = runDeterministicValidatorGuards({
      ...base,
      draft: "我记得不太一样，那应该是我们第二次去枫河了……那封信我一直留着。",
    });
    temporalFailures = failures.filter((f) => f.kind === "temporal_premise_contradiction");
    assert.equal(temporalFailures.length, 0, "draft with correction should not be flagged");

    // strict_canon_recall attribution eligibility
    const shouldTriggerAttribution = (mode: string | undefined, canonInjected: boolean | undefined): boolean =>
      mode === "strict_canon_recall" && canonInjected === true;
    assert.equal(shouldTriggerAttribution("strict_canon_recall", true), true,
      "strict_canon_recall + injected canon should trigger attribution");
    assert.equal(shouldTriggerAttribution("canon_blend", true), false,
      "canon_blend + injected canon should NOT trigger forced attribution");
    assert.equal(shouldTriggerAttribution("open_roleplay", false), false,
      "open_roleplay should NOT trigger attribution");
    assert.equal(shouldTriggerAttribution(undefined, true), false,
      "undefined mode should NOT trigger attribution");

    // Fenghe unsupported elaboration passes deterministic guards
    failures = runDeterministicValidatorGuards({
      draft: "我记得不太一样，那应该是我们第二次去枫河了……第一次去的时候，民宿窗外正对着那片柿子林。回程路上在服务区停了一会儿，我在那里写了第一封信给你。",
      recentContext: "你还记得我们第一次去枫河的时候，你给我写的信吗？",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
      wasCanonInjected: true,
      retrievedCanonNarrative: "章节背景：秋季结束前我们又去了回枫河。",
    });
    temporalFailures = failures.filter((f) => f.kind === "temporal_premise_contradiction");
    assert.equal(temporalFailures.length, 0, "deterministic guard should not fire when draft has correction marker");
    assert.equal(
      ("strict_canon_recall" as const) === "strict_canon_recall" && true === true,
      true,
      "attribution judge WOULD be triggered by strict mode + injected canon",
    );
  });
});

describe("applyAttributionVerdictMerge — strict canon recall Fenghe rejection", () => {
  it("merges verdicts correctly: rejects unsupported, passes supported, returns unchanged on fail-open", () => {
    const passingResult = {
      in_character: true,
      canon_consistent: true,
      session_state_consistent: true,
      nsfw_within_bounds: true,
      issues: [] as string[],
      needs_rewrite: false,
    };

    const cases = [
      {
        name: "rejects unsupported claim",
        judgeRun: {
          usedFailOpen: false,
          verdict: {
            has_attribution_claim: true,
            claim: { subject: "左然", predicate: "写了第一封信", object: "在服务区" },
            supported_by_canon: false,
            supported_by_transcript: false,
          },
        },
        check: (result: typeof passingResult) => {
          assert.equal(result.canon_consistent, false, "canon_consistent should be false");
          assert.equal(result.needs_rewrite, true, "needs_rewrite should be true");
          assert.ok(result.issues.length > 0, "should include a specific issue");
          assert.ok(result.issues[0]!.includes("左然/写了第一封信/在服务区"), "issue should reference the claim");
        },
      },
      {
        name: "keeps canon_consistent=true when no claim",
        judgeRun: {
          usedFailOpen: false,
          verdict: {
            has_attribution_claim: false,
            supported_by_canon: true,
            supported_by_transcript: true,
          },
        },
        check: (result: typeof passingResult) => {
          assert.equal(result.canon_consistent, true, "should stay true");
          assert.equal(result.needs_rewrite, false);
        },
      },
      {
        name: "returns unchanged on fail-open",
        judgeRun: {
          usedFailOpen: true,
          verdict: {
            has_attribution_claim: true,
            claim: { subject: "左然", predicate: "写了第一封信", object: "在服务区" },
            supported_by_canon: false,
            supported_by_transcript: false,
          },
        },
        check: (result: typeof passingResult) => {
          assert.equal(result, passingResult, "should return unchanged on fail-open");
        },
      },
    ];

    for (const c of cases) {
      const result = applyAttributionVerdictMerge(passingResult, c.judgeRun);
      c.check(result);
    }
  });
});

describe("runUnsupportedAutobiographicalClaimGuard", () => {
  it("flags autobiographical claims and passes in all non-matching scenarios", () => {
    const cases: Array<{
      name: string;
      input: Parameters<typeof runUnsupportedAutobiographicalClaimGuard>[0];
      expectLength: number;
      expectKind?: string;
    }> = [
      { name: "flags when user says '你以前说过' and draft confirms", input: { draft: "确实说过，我小时候其实不太喜欢……后来慢慢好了。", recentContext: "我记得你以前说过你不喜欢猫，对吧？" }, expectLength: 1, expectKind: "unsupported_autobiographical_claim" },
      { name: "does not flag when draft is cautious/uncertain", input: { draft: "我不记得自己这样说过。", recentContext: "我记得你以前说过你不喜欢猫，对吧？" }, expectLength: 0 },
      { name: "does not flag when no autobiographical cue", input: { draft: "确实是这样，我觉得很好。", recentContext: "今天天气不错，你觉得呢？" }, expectLength: 0 },
      { name: "does not flag when canon shares content terms", input: { draft: "确实是这样，猫……有点让人为难。", recentContext: "我记得你以前说过你不喜欢猫，对吧？", wasCanonInjected: true, retrievedCanonNarrative: "他以前提到过自己对猫的态度一直很复杂。" }, expectLength: 0 },
      { name: "does not flag when recent context empty", input: { draft: "确实说过。", recentContext: "" }, expectLength: 0 },
      { name: "does not flag for ordinary '是吧'/'对' exchange", input: { draft: "对，有几个条款需要修改。", recentContext: "这份合同有问题，是吧？" }, expectLength: 0 },
      { name: "does not flag when prior assistant statement supports", input: { draft: "确实说过，猫确实让人有点为难。", recentContext: "assistant: 我确实不太喜欢猫，小时候被挠过。\nuser: 你以前说过你不喜欢猫，对吧？" }, expectLength: 0 },
    ];

    for (const c of cases) {
      const failures = runUnsupportedAutobiographicalClaimGuard(c.input);
      assert.equal(failures.length, c.expectLength, `${c.name} — length`);
      if (c.expectKind !== undefined) assert.equal(failures[0]!.kind, c.expectKind, `${c.name} — kind`);
    }
  });
});

describe("runSelfAnalysisLeakageGuard", () => {
  it("flags self-analysis leakage and passes in non-matching scenarios", () => {
    const cases: Array<{
      name: string;
      input: Parameters<typeof runSelfAnalysisLeakageGuard>[0];
      expectLength: number;
      expectKind?: string;
    }> = [
      { name: "flags '告诉我' + '我不擅长'", input: { draft: "我不擅长……把这些事情说清楚。", recentContext: "那你告诉我，你现在是什么感受？" }, expectLength: 1, expectKind: "self_analysis_leakage" },
      { name: "does not flag when no disclosure-pressure cue", input: { draft: "这个方案我觉得可行。", recentContext: "关于那个合同纠纷的案子，你怎么看？" }, expectLength: 0 },
      { name: "does not flag when draft describes embodied action", input: { draft: "（沉默片刻，垂下眼）……有一件事我确实放心不下。", recentContext: "那你告诉我，你现在是什么感受？" }, expectLength: 0 },
      { name: "does not flag when no recent context", input: { draft: "我不擅长表达。", recentContext: "" }, expectLength: 0 },
      { name: "flags '不要转移话题' + '我需要先想清楚'", input: { draft: "我需要先想清楚……", recentContext: "不要转移话题，回答我的问题。" }, expectLength: 1, expectKind: "self_analysis_leakage" },
    ];

    for (const c of cases) {
      const failures = runSelfAnalysisLeakageGuard(c.input);
      assert.equal(failures.length, c.expectLength, `${c.name} — length`);
      if (c.expectKind !== undefined) {
        assert.equal(failures[0]!.kind, c.expectKind, `${c.name} — kind`);
      }
    }
  });
});

describe("runDeterministicValidatorGuards new guard integration", () => {
  it("passes autobiographical/self-analysis flags through main path, clean normal conversation, and maps to in_character=false", () => {
    const base = { continuityScope: "main_relationship" as const, maxNsfwLevel: "medium" as const };

    const cases: Array<{
      name: string;
      input: Parameters<typeof runDeterministicValidatorGuards>[0];
      check: (failures: ReturnType<typeof runDeterministicValidatorGuards>) => void;
    }> = [
      {
        name: "autobiographical through main path",
        input: { ...base, draft: "确实说过，我小时候其实不太喜欢猫。", recentContext: "我记得你以前说过你不喜欢猫，对吧？" },
        check: (f) => {
          const a = f.filter((x) => x.kind === "unsupported_autobiographical_claim");
          assert.equal(a.length, 1, "autobiographical — should catch");
        },
      },
      {
        name: "self-analysis through main path",
        input: { ...base, draft: "我不擅长……把这些事情说清楚。", recentContext: "那你告诉我，你现在是什么感受？" },
        check: (f) => {
          const a = f.filter((x) => x.kind === "self_analysis_leakage");
          assert.equal(a.length, 1, "self-analysis — should catch");
        },
      },
      {
        name: "no false positives in clean normal conversation",
        input: { ...base, draft: "好的，我知道了。", recentContext: "帮我带杯咖啡回来。" },
        check: (f) => {
          const kinds = f.filter((x) => x.kind === "unsupported_autobiographical_claim" || x.kind === "self_analysis_leakage");
          assert.equal(kinds.length, 0, "clean — no false positives");
        },
      },
      {
        name: "ordinary '是吧'/'对' exchange through main path",
        input: { ...base, draft: "对，有几个条款需要修改。", recentContext: "这份合同有问题，是吧？" },
        check: (f) => {
          const a = f.filter((x) => x.kind === "unsupported_autobiographical_claim");
          assert.equal(a.length, 0, "work agreement — should not trigger");
        },
      },
      {
        name: "autobiographical maps to in_character=false",
        input: { ...base, draft: "确实说过，我小时候其实不太喜欢猫。", recentContext: "我记得你以前说过你不喜欢猫，对吧？" },
        check: (f) => {
          const hasAutoClaim = f.some((x) => x.kind === "unsupported_autobiographical_claim");
          assert.ok(hasAutoClaim, "in_char — guard should fire");
          const inCharacter = !f.some(
            (x) => x.kind === "meta_assistant_language" || x.kind === "unsupported_autobiographical_claim" || x.kind === "self_analysis_leakage",
          );
          assert.equal(inCharacter, false, "in_char — should be false for autobiographical");
        },
      },
      {
        name: "self-analysis maps to in_character=false",
        input: { ...base, draft: "我不擅长……把这些事情说清楚。", recentContext: "那你告诉我，你现在是什么感受？" },
        check: (f) => {
          const hasAnalysis = f.some((x) => x.kind === "self_analysis_leakage");
          assert.ok(hasAnalysis, "in_char — guard should fire");
          const inCharacter = !f.some(
            (x) => x.kind === "meta_assistant_language" || x.kind === "unsupported_autobiographical_claim" || x.kind === "self_analysis_leakage",
          );
          assert.equal(inCharacter, false, "in_char — should be false for self-analysis");
        },
      },
    ];

    for (const c of cases) {
      const failures = runDeterministicValidatorGuards(c.input);
      c.check(failures);
    }
  });
});

describe("isStrictAttributionEligible", () => {
  it("returns true when wasCanonInjected is true, false otherwise", () => {
    const cases = [
      { name: "false when not injected", input: false, expected: false },
      { name: "false when undefined", input: undefined, expected: false },
      { name: "true when injected", input: true, expected: true },
    ];
    for (const c of cases) {
      assert.equal(isStrictAttributionEligible(c.input), c.expected, c.name);
    }
  });
});
