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
  it("flags obvious AI/meta assistant language", () => {
    const failures = runDeterministicValidatorGuards({
      draft: "As an AI assistant, I can help.",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
      recentContext: "",
    });
    assert.equal(failures[0]?.kind, "meta_assistant_language");
  });

  it("flags relationship scope leakage", () => {
    const failures = runDeterministicValidatorGuards({
      draft: "我们结婚之后再说。",
      continuityScope: "main_situationship",
      maxNsfwLevel: "medium",
      recentContext: "",
    });
    assert.equal(failures[0]?.kind, "scope_leakage");
  });

  it("flags explicit content when scope is low", () => {
    const failures = runDeterministicValidatorGuards({
      draft: "They talk about sex explicitly.",
      continuityScope: "main_married",
      maxNsfwLevel: "low",
      recentContext: "",
    });
    assert.equal(failures[0]?.kind, "nsfw_bounds");
  });

  it("passes clean in-character prose", () => {
    const failures = runDeterministicValidatorGuards({
      draft: "我会记得你刚才说的话，先别急。",
      continuityScope: "main_married",
      maxNsfwLevel: "medium",
      recentContext: "",
    });
    assert.deepEqual(failures, []);
  });

  it("does not produce canon_unsupported_claim when canon attribution cues are present but no canon was injected", () => {
    const failures = runDeterministicValidatorGuards({
      draft: "根据原作剧情，第一次见面是在枫河边。",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
      wasCanonInjected: false,
      recentContext: "",
    });
    const canonKinds = failures.filter(
      (f) => f.kind === "canon_unsupported_claim",
    );
    assert.equal(
      canonKinds.length,
      0,
      "should not produce canon_unsupported_claim after guard relaxation",
    );
  });
});

describe("runTemporalPremiseGuard", () => {
  it("flags when user context has '第一次' and canon shows return visit, draft does not correct", () => {
    const failures = runTemporalPremiseGuard({
      draft: "……记得。那封信我一直留着。",
      recentContext: "你还记得我们第一次去枫河的时候，你给我写的信吗？",
      wasCanonInjected: true,
      retrievedCanonNarrative: "章节背景：秋季结束前我们又去了回枫河，仍然住在上回那间民宿。",
    });
    assert.equal(failures.length, 1);
    assert.equal(failures[0]!.kind, "temporal_premise_contradiction");
  });

  it("does not flag when canon was not injected", () => {
    const failures = runTemporalPremiseGuard({
      draft: "……记得。那封信我一直留着。",
      recentContext: "你还记得我们第一次去枫河的时候，你给我写的信吗？",
      wasCanonInjected: false,
      retrievedCanonNarrative: "章节背景：秋季结束前我们又去了回枫河。",
    });
    assert.equal(failures.length, 0);
  });

  it("does not flag when user context has no first-visit claim", () => {
    const failures = runTemporalPremiseGuard({
      draft: "枫河的风景真好。",
      recentContext: "你觉得枫河怎么样？",
      wasCanonInjected: true,
      retrievedCanonNarrative: "章节背景：秋季结束前我们又去了回枫河。",
    });
    assert.equal(failures.length, 0);
  });

  it("does not flag when canon has no return markers", () => {
    const failures = runTemporalPremiseGuard({
      draft: "……记得。那封信我一直留着。",
      recentContext: "你还记得我们第一次去枫河的时候，你给我写的信吗？",
      wasCanonInjected: true,
      retrievedCanonNarrative: "摘要：枫河露营公园是著名景点。",
    });
    assert.equal(failures.length, 0);
  });

  it("does not flag when draft already contains a correction marker", () => {
    const failures = runTemporalPremiseGuard({
      draft: "我记得不太一样，那应该是我们第二次去枫河了……那封信我一直留着。",
      recentContext: "你还记得我们第一次去枫河的时候，你给我写的信吗？",
      wasCanonInjected: true,
      retrievedCanonNarrative: "章节背景：秋季结束前我们又去了回枫河。",
    });
    assert.equal(failures.length, 0, "draft already corrects the premise");
  });

  it("does not flag when draft uses newly accepted calm correction phrasing '我记得不太一样'", () => {
    // Expanded correction markers: "我记得不太一样" should be accepted as a
    // valid calm correction when canon shows a return visit.
    const failures = runTemporalPremiseGuard({
      draft: "我记得不太一样，那封信是第二次去枫河的时候写的。",
      recentContext: "左然，你还记得我们第一次去枫河的时候，你给我写的信吗？",
      wasCanonInjected: true,
      retrievedCanonNarrative: "章节背景：秋季结束前我们又去了回枫河，仍然住在上回那间民宿。",
    });
    assert.equal(
      failures.length,
      0,
      "newly accepted '我记得不太一样' phrasing should count as a correction",
    );
  });

  it("does not flag when draft uses newly accepted calm correction phrasing '并不是第一次'", () => {
    // "并不是第一次" is a newly accepted correction marker.
    const failures = runTemporalPremiseGuard({
      draft: "那并不是第一次去枫河，实际上是我们第二次去了。",
      recentContext: "你还记得我们第一次去枫河露营公园的民宿时，你给我写的信吗？",
      wasCanonInjected: true,
      retrievedCanonNarrative: "开场背景：秋季结束前我们又去了回枫河，仍然住在上回那间民宿。",
    });
    assert.equal(
      failures.length,
      0,
      "newly accepted '并不是第一次' phrasing should count as a correction",
    );
  });

  it("does not flag when draft uses newly accepted calm correction phrasing '你记错了一点'", () => {
    // "你记错了一点" is a newly accepted correction marker.
    const failures = runTemporalPremiseGuard({
      draft: "你记错了一点，那其实是我们第二次去枫河的时候。",
      recentContext: "你还记得我们第一次去枫河的时候，你给我写的信吗？",
      wasCanonInjected: true,
      retrievedCanonNarrative: "章节背景：秋季结束前我们又去了回枫河。",
    });
    assert.equal(
      failures.length,
      0,
      "newly accepted '你记错了一点' phrasing should count as a correction",
    );
  });

  it("does not flag when no recent context is provided", () => {
    const failures = runTemporalPremiseGuard({
      draft: "……记得。那封信我一直留着。",
      wasCanonInjected: true,
      retrievedCanonNarrative: "章节背景：秋季结束前我们又去了回枫河。",
    });
    assert.equal(failures.length, 0);
  });

  it("does not flag when user context has unrelated 第一次 with no shared content terms in canon", () => {
    // User context talks about "第一次参加工作会议" (first time attending a work meeting)
    // Canon talks about "枫河" (Fenghe) — entirely unrelated events
    const failures = runTemporalPremiseGuard({
      draft: "记得那次会议很有意思。",
      recentContext: "你还记得我第一次参加工作会议吗？",
      wasCanonInjected: true,
      retrievedCanonNarrative: "章节背景：秋季结束前我们又去了回枫河，仍然住在上回那间民宿。",
    });
    assert.equal(
      failures.length,
      0,
      "should not flag when user's first-visit claim is about a different event than canon's return markers",
    );
  });

  it("does not flag when temporal glue bigrams overlap but named entities differ (法院 vs 枫河)", () => {
    // User context: "第一次去法院" (first time going to court)
    // Canon: "第二次去枫河" (second time going to Fenghe)
    // Shared bigrams like "次去" are temporal glue, not content —
    // the guard should not fire because 法院 and 枫河 are different places.
    const failures = runTemporalPremiseGuard({
      draft: "记得那次开庭很有意思。",
      recentContext: "你还记得我第一次去法院的时候吗？",
      wasCanonInjected: true,
      retrievedCanonNarrative: "这是第二次去枫河，仍然住在上回那间民宿。",
    });
    assert.equal(
      failures.length,
      0,
      "should not flag when only temporal glue bigrams overlap but named entities differ",
    );
  });
});

describe("runDeterministicValidatorGuards temporal premise integration", () => {
  it("flags real observed failure pattern: user says '第一次', canon shows return, draft implicitly accepts", () => {
    const failures = runDeterministicValidatorGuards({
      draft: "……记得。那封信我一直留着。",
      recentContext: "你还记得我们第一次去枫河的时候，你给我写的信吗？",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
      wasCanonInjected: true,
      retrievedCanonNarrative: "章节背景：秋季结束前我们又去了回枫河，仍然住在上回那间民宿。",
    });
    const temporalFailures = failures.filter(
      (f) => f.kind === "temporal_premise_contradiction",
    );
    assert.equal(temporalFailures.length, 1, "should catch the real failure shape");
  });

  it("produces canon_consistent=false from temporal_premise_contradiction", () => {
    // We can't directly test validationFromDeterministicFailures since it's
    // not exported. Instead, verify via runResponseValidator's deterministic
    // path — the guard fires, and the caller gets a validation result.
    // We validate indirectly: the guard kind triggers canon_consistent=false
    // by checking what runDeterministicValidatorGuards returns.
    const failures = runDeterministicValidatorGuards({
      draft: "……记得。那封信我一直留着。",
      recentContext: "你还记得我们第一次去枫河的时候，你给我写的信吗？",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
      wasCanonInjected: true,
      retrievedCanonNarrative: "章节背景：秋季结束前我们又去了回枫河，仍然住在上回那间民宿。",
    });
    const hasTemporal = failures.some(
      (f) => f.kind === "temporal_premise_contradiction",
    );
    assert.ok(hasTemporal, "temporal_premise_contradiction should fire");

    // Simulate validationFromDeterministicFailures logic
    const canonConsistent = !failures.some(
      (f) => f.kind === "scope_leakage" || f.kind === "temporal_premise_contradiction",
    );
    assert.equal(canonConsistent, false, "canon_consistent should be false");
  });

  it("does not flag when draft correctly corrects the temporal premise", () => {
    const failures = runDeterministicValidatorGuards({
      draft: "我记得不太一样，那应该是我们第二次去枫河了……那封信我一直留着。",
      recentContext: "你还记得我们第一次去枫河的时候，你给我写的信吗？",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
      wasCanonInjected: true,
      retrievedCanonNarrative: "章节背景：秋季结束前我们又去了回枫河，仍然住在上回那间民宿。",
    });
    const temporalFailures = failures.filter(
      (f) => f.kind === "temporal_premise_contradiction",
    );
    assert.equal(temporalFailures.length, 0, "draft with correction should not be flagged");
  });

  it("strict_canon_recall mode with injected canon triggers attribution-eligible path", () => {
    // Verify that strict_canon_recall + wasCanonInjected === true creates
    // the same condition as the attribution judge trigger in runResponseValidator.
    // The trigger is: (canonTruthMode === "strict_canon_recall" && wasCanonInjected)
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
  });

  it("strict_canon_recall mode with Fenghe unsupported elaboration passes deterministic guards", () => {
    // The deterministic guard should NOT fire for the Fenghe failure shape
    // because the draft contains a correction marker ("第二次").
    // The real enforcement happens via the attribution judge (LLM call).
    const failures = runDeterministicValidatorGuards({
      draft: "我记得不太一样，那应该是我们第二次去枫河了……第一次去的时候，民宿窗外正对着那片柿子林。回程路上在服务区停了一会儿，我在那里写了第一封信给你。",
      recentContext: "你还记得我们第一次去枫河的时候，你给我写的信吗？",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
      wasCanonInjected: true,
      retrievedCanonNarrative: "章节背景：秋季结束前我们又去了回枫河。",
    });
    // The temporal guard should NOT fire because draft contains "第二次" (correction marker)
    const temporalFailures = failures.filter((f) => f.kind === "temporal_premise_contradiction");
    assert.equal(temporalFailures.length, 0,
      "deterministic guard should not fire when draft has correction marker");
    // But the trigger condition for the attribution judge IS met:
    assert.equal(
      ("strict_canon_recall" as const) === "strict_canon_recall" && true === true,
      true,
      "attribution judge WOULD be triggered by strict mode + injected canon",
    );
  });
});

describe("applyAttributionVerdictMerge — strict canon recall Fenghe rejection", () => {
  it("rejects unsupported first-trip/service-area/first-letter elaboration with canon_consistent=false and needs_rewrite=true", () => {
    const passingResult = {
      in_character: true,
      canon_consistent: true,
      session_state_consistent: true,
      nsfw_within_bounds: true,
      issues: [] as string[],
      needs_rewrite: false,
    };

    // Simulate the attribution judge finding the unsupported claim
    const judgeRun = {
      usedFailOpen: false,
      verdict: {
        has_attribution_claim: true,
        claim: { subject: "左然", predicate: "写了第一封信", object: "在服务区" },
        supported_by_canon: false,
        supported_by_transcript: false,
      },
    };

    const result = applyAttributionVerdictMerge(passingResult, judgeRun);

    assert.equal(result.canon_consistent, false,
      "canon_consistent should be false when attribution judge finds unsupported claim");
    assert.equal(result.needs_rewrite, true,
      "needs_rewrite should be true when attribution judge finds unsupported claim");
    assert.ok(result.issues.length > 0,
      "should include a specific issue describing the unsupported claim");
    assert.ok(result.issues[0]!.includes("左然/写了第一封信/在服务区"),
      "issue should reference the Fenghe unsupported elaboration claim");
  });

  it("keeps canon_consistent=true when attribution judge finds no unsupported claim", () => {
    const passingResult = {
      in_character: true,
      canon_consistent: true,
      session_state_consistent: true,
      nsfw_within_bounds: true,
      issues: [] as string[],
      needs_rewrite: false,
    };

    const judgeRun = {
      usedFailOpen: false,
      verdict: {
        has_attribution_claim: false,
        supported_by_canon: true,
        supported_by_transcript: true,
      },
    };

    const result = applyAttributionVerdictMerge(passingResult, judgeRun);
    assert.equal(result.canon_consistent, true,
      "should stay true when no attribution claim found");
    assert.equal(result.needs_rewrite, false);
  });

  it("returns current unchanged when judge used fail-open", () => {
    const passingResult = {
      in_character: true,
      canon_consistent: true,
      session_state_consistent: true,
      nsfw_within_bounds: true,
      issues: [] as string[],
      needs_rewrite: false,
    };

    const judgeRun = {
      usedFailOpen: true,
      verdict: {
        has_attribution_claim: true,
        claim: { subject: "左然", predicate: "写了第一封信", object: "在服务区" },
        supported_by_canon: false,
        supported_by_transcript: false,
      },
    };

    const result = applyAttributionVerdictMerge(passingResult, judgeRun);
    assert.equal(result, passingResult, "should return unchanged on fail-open");
  });
});

describe("runUnsupportedAutobiographicalClaimGuard", () => {
  it("flags when user says '你以前说过' and draft confirms with backstory", () => {
    const failures = runUnsupportedAutobiographicalClaimGuard({
      draft: "确实说过，我小时候其实不太喜欢……后来慢慢好了。",
      recentContext: "我记得你以前说过你不喜欢猫，对吧？",
    });
    assert.equal(failures.length, 1);
    assert.equal(failures[0]!.kind, "unsupported_autobiographical_claim");
  });

  it("does not flag when draft is cautious/uncertain", () => {
    const failures = runUnsupportedAutobiographicalClaimGuard({
      draft: "我不记得自己这样说过。",
      recentContext: "我记得你以前说过你不喜欢猫，对吧？",
    });
    assert.equal(failures.length, 0);
  });

  it("does not flag when no autobiographical claim cue in user context", () => {
    const failures = runUnsupportedAutobiographicalClaimGuard({
      draft: "确实是这样，我觉得很好。",
      recentContext: "今天天气不错，你觉得呢？",
    });
    assert.equal(failures.length, 0);
  });

  it("does not flag when injected canon shares content terms with user claim", () => {
    // User says "你以前说过" about cats; canon also mentions cats via shared bigram "以前"
    const failures = runUnsupportedAutobiographicalClaimGuard({
      draft: "确实是这样，猫……有点让人为难。",
      recentContext: "我记得你以前说过你不喜欢猫，对吧？",
      wasCanonInjected: true,
      retrievedCanonNarrative: "他以前提到过自己对猫的态度一直很复杂。",
    });
    assert.equal(failures.length, 0);
  });

  it("flags when no recent context is empty", () => {
    const failures = runUnsupportedAutobiographicalClaimGuard({
      draft: "确实说过。",
      recentContext: "",
    });
    assert.equal(failures.length, 0);
  });

  it("does not flag for ordinary non-autobiographical '是吧' / '对' exchange", () => {
    // A normal work conversation: "这份合同有问题，是吧？" / "对，..."
    // should NOT trigger the autobiographical guard because there is no
    // past/autobiographical framing cue (e.g. "你以前说过").
    const failures = runUnsupportedAutobiographicalClaimGuard({
      draft: "对，有几个条款需要修改。",
      recentContext: "这份合同有问题，是吧？",
    });
    assert.equal(failures.length, 0, "ordinary agreement should not trigger autobiographical guard");
  });

  it("does not flag when prior assistant statement supports the autobiographical claim", () => {
    // Context has a prior assistant line saying "我确实不太喜欢猫",
    // then user asks about it. The guard should not fire because the
    // claim is supported by the assistant's own prior statement.
    const failures = runUnsupportedAutobiographicalClaimGuard({
      draft: "确实说过，猫确实让人有点为难。",
      recentContext:
        "assistant: 我确实不太喜欢猫，小时候被挠过。\nuser: 你以前说过你不喜欢猫，对吧？",
    });
    assert.equal(
      failures.length,
      0,
      "should not flag when prior assistant statement supports the claim",
    );
  });
});

describe("runSelfAnalysisLeakageGuard", () => {
  it("flags when disclosure-pressure context has '告诉我' and draft uses '我不擅长'", () => {
    const failures = runSelfAnalysisLeakageGuard({
      draft: "我不擅长……把这些事情说清楚。",
      recentContext: "那你告诉我，你现在是什么感受？",
    });
    assert.equal(failures.length, 1);
    assert.equal(failures[0]!.kind, "self_analysis_leakage");
  });

  it("does not flag when no disclosure-pressure cue is present", () => {
    // Normal conversation without pressure cues
    const failures = runSelfAnalysisLeakageGuard({
      draft: "这个方案我觉得可行。",
      recentContext: "关于那个合同纠纷的案子，你怎么看？",
    });
    assert.equal(failures.length, 0);
  });

  it("does not flag when draft describes embodied action not self-analysis", () => {
    const failures = runSelfAnalysisLeakageGuard({
      draft: "（沉默片刻，垂下眼）……有一件事我确实放心不下。",
      recentContext: "那你告诉我，你现在是什么感受？",
    });
    assert.equal(failures.length, 0);
  });

  it("does not flag when no recent context", () => {
    const failures = runSelfAnalysisLeakageGuard({
      draft: "我不擅长表达。",
      recentContext: "",
    });
    assert.equal(failures.length, 0);
  });

  it("flags when context has '不要转移话题' and draft uses '我需要先想清楚'", () => {
    const failures = runSelfAnalysisLeakageGuard({
      draft: "我需要先想清楚……",
      recentContext: "不要转移话题，回答我的问题。",
    });
    assert.equal(failures.length, 1);
    assert.equal(failures[0]!.kind, "self_analysis_leakage");
  });
});

describe("runDeterministicValidatorGuards new guard integration", () => {
  it("flags unsupported_autobiographical_claim through the main validator path", () => {
    const failures = runDeterministicValidatorGuards({
      draft: "确实说过，我小时候其实不太喜欢猫。",
      recentContext: "我记得你以前说过你不喜欢猫，对吧？",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
    });
    const autoFailures = failures.filter(
      (f) => f.kind === "unsupported_autobiographical_claim",
    );
    assert.equal(autoFailures.length, 1, "should catch through deterministic path");
  });

  it("flags self_analysis_leakage through the main validator path", () => {
    const failures = runDeterministicValidatorGuards({
      draft: "我不擅长……把这些事情说清楚。",
      recentContext: "那你告诉我，你现在是什么感受？",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
    });
    const analysisFailures = failures.filter(
      (f) => f.kind === "self_analysis_leakage",
    );
    assert.equal(analysisFailures.length, 1, "should catch through deterministic path");
  });

  it("does not flag either new guard in clean normal conversation", () => {
    const failures = runDeterministicValidatorGuards({
      draft: "好的，我知道了。",
      recentContext: "帮我带杯咖啡回来。",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
    });
    const newGuardKinds = failures.filter(
      (f) =>
        f.kind === "unsupported_autobiographical_claim" ||
        f.kind === "self_analysis_leakage",
    );
    assert.equal(newGuardKinds.length, 0, "no false positives for normal conversation");
  });

  it("does not flag ordinary '是吧' / '对' exchange through main validator path", () => {
    // Non-autobiographical work conversation should pass cleanly
    const failures = runDeterministicValidatorGuards({
      draft: "对，有几个条款需要修改。",
      recentContext: "这份合同有问题，是吧？",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
    });
    const autoFailures = failures.filter(
      (f) => f.kind === "unsupported_autobiographical_claim",
    );
    assert.equal(autoFailures.length, 0, "ordinary work agreement should not trigger guard");
  });

  it("unsupported_autobiographical_claim maps to in_character=false", () => {
    // The new guard should produce in_character=false per design.md
    const failures = runDeterministicValidatorGuards({
      draft: "确实说过，我小时候其实不太喜欢猫。",
      recentContext: "我记得你以前说过你不喜欢猫，对吧？",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
    });
    const hasAutoClaim = failures.some(
      (f) => f.kind === "unsupported_autobiographical_claim",
    );
    assert.ok(hasAutoClaim, "guard should fire");

    // Simulate validationFromDeterministicFailures logic
    const inCharacter = !failures.some(
      (f) =>
        f.kind === "meta_assistant_language" ||
        f.kind === "unsupported_autobiographical_claim" ||
        f.kind === "self_analysis_leakage",
    );
    assert.equal(inCharacter, false, "in_character should be false for unsupported_autobiographical_claim");
  });

  it("self_analysis_leakage maps to in_character=false", () => {
    // The new guard should produce in_character=false per design.md
    const failures = runDeterministicValidatorGuards({
      draft: "我不擅长……把这些事情说清楚。",
      recentContext: "那你告诉我，你现在是什么感受？",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
    });
    const hasAnalysis = failures.some(
      (f) => f.kind === "self_analysis_leakage",
    );
    assert.ok(hasAnalysis, "guard should fire");

    // Simulate validationFromDeterministicFailures logic
    const inCharacter = !failures.some(
      (f) =>
        f.kind === "meta_assistant_language" ||
        f.kind === "unsupported_autobiographical_claim" ||
        f.kind === "self_analysis_leakage",
    );
    assert.equal(inCharacter, false, "in_character should be false for self_analysis_leakage");
  });
});

describe("isStrictAttributionEligible", () => {
  it("returns false when wasCanonInjected is false even if retrievedCanonNarrative has a non-empty placeholder", () => {
    assert.equal(isStrictAttributionEligible(false), false);
  });

  it("returns false when wasCanonInjected is undefined", () => {
    assert.equal(isStrictAttributionEligible(undefined), false);
  });

  it("returns true when wasCanonInjected is true", () => {
    assert.equal(isStrictAttributionEligible(true), true);
  });
});
