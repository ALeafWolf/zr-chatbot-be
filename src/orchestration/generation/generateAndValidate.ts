import {
  runResponseValidator,
  VALIDATOR_FAIL_OPEN,
  type ValidationResult,
  type ValidatorInput,
} from "../../llm/validation/runResponseValidator";
import type { CanonTruthMode } from "../prompt/buildPromptContext";
import type { PromptContext } from "../prompt/buildPromptContext";
import type { ChatSession } from "../../db/schema/chat";
import type { PersonaOverlayDefaults } from "../../character/characterDefaults";
import { loadCharacterDefaults, type CharacterDefaults } from "../../character/characterDefaults";
import { voiceHintsFrom } from "../../character/voiceHints";
import {
  traceLLMStage,
  traceStreamingLLM,
} from "../../observability/langsmithTracing";
import type { ToolChatMessage } from "../../llm/providers";
import {
  generateWithToolsStream,
  ToolLoopExceededError,
} from "./generateWithTools";
import type { ToolCtx } from "../../llm/tools/types";
import { generateThoughtSummary } from "../../llm/generation/generateThoughtSummary";
import type { Thought } from "../thought/thoughtTypes";
import type { OrchestrationStreamEvent } from "../thought/thoughtTypes";
import { extensionsForGenerationThinking } from "../../llm/generation/generationThinkingExtensions";
import { models } from "../../config/models";
import {
  filterDrafterFacingIssues,
  replayValidatedDraftDeltas,
} from "./validationFlowHelpers";
import {
  recordValidationAttempt,
  recordValidationSnapshot,
} from "../../eval/evalSnapshots";
import { env } from "../../config/env";
import {
  appendDeepSeekThinkingMarker,
  stripDeepSeekThinkingMarkerPreview,
  type DeepSeekV4ThinkingMode,
  type DeepSeekV4ThinkingMarkerScope,
} from "../../llm/generation/deepseekThinkingMode";

/** System/transport issues from the validator are not actionable for the drafter. */
export interface GenerateAndValidateResult {
  content: string;
  validatorResult: ValidationResult;
  wasRewritten: boolean;
  wasDeflected: boolean;
  inputTokens: number;
  outputTokens: number;
}

export type GenerateAndValidateYield =
  | OrchestrationStreamEvent
  | { type: "_complete"; result: GenerateAndValidateResult };

type GenerateWithToolsStreamInput = Parameters<typeof generateWithToolsStream>[0];

function unwrapGenerateWithToolsStreamInput(
  inputs: Readonly<unknown>,
): GenerateWithToolsStreamInput {
  const rec = inputs as Record<string, unknown>;
  if (rec && typeof rec === "object" && "input" in rec && rec.input) {
    return rec.input as GenerateWithToolsStreamInput;
  }
  return inputs as GenerateWithToolsStreamInput;
}

function traceInputsForGenerationToolLoop(
  inputs: Readonly<unknown>,
): Record<string, unknown> {
  const input = unwrapGenerateWithToolsStreamInput(inputs);
  const systemMsg = input.messages.find((m) => m.role === "system");
  const userMsgs = input.messages.filter((m) => m.role === "user");
  const lastUserMsg = userMsgs[userMsgs.length - 1];
  const systemContent = systemMsg?.content ?? "";
  const ext = input as Record<string, unknown>;
  return {
    messages: input.messages as unknown as Record<string, unknown>[],
    allowedToolNames: input.allowedToolNames ?? null,
    enableTools: input.enableTools !== false,
    systemPromptChars: systemContent.length,
    conversationMessageCount: input.messages.length,
    userMessageChars: lastUserMsg?.content?.length ?? 0,
    userMessagePreview: stripDeepSeekThinkingMarkerPreview(
      lastUserMsg?.content ?? "",
    ).slice(0, 200),
    ...(ext.deepseekThinkingMode !== undefined
      ? { deepseekThinkingMode: ext.deepseekThinkingMode }
      : {}),
    ...(ext.deepseekThinkingMarkerInjected !== undefined
      ? { deepseekThinkingMarkerInjected: ext.deepseekThinkingMarkerInjected }
      : {}),
    ...(ext.deepseekThinkingMarkerReason !== undefined
      ? { deepseekThinkingMarkerReason: ext.deepseekThinkingMarkerReason }
      : {}),
    ...(ext.deepseekThinkingMarkerPlacement !== undefined
      ? {
          deepseekThinkingMarkerPlacement:
            ext.deepseekThinkingMarkerPlacement,
        }
      : {}),
    ...(ext.deepseekThinkingTargetModel !== undefined
      ? { deepseekThinkingTargetModel: ext.deepseekThinkingTargetModel }
      : {}),
    ...(ext.deepseekThinkingMarkerScope !== undefined
      ? { deepseekThinkingMarkerScope: ext.deepseekThinkingMarkerScope }
      : {}),
  };
}

function unwrapValidatorTraceInput(inputs: Readonly<unknown>): ValidatorInput {
  const rec = inputs as Record<string, unknown>;
  if (rec && typeof rec === "object" && "input" in rec && rec.input) {
    return rec.input as ValidatorInput;
  }
  return inputs as ValidatorInput;
}

/** Chunk size when replaying validated first-draft prose to SSE (~UTF-16 code units). */
const tracedResponseGeneration = traceStreamingLLM(
  "llm.response_generation",
  generateWithToolsStream,
  {
    subsystem: "llm",
    turn: "foreground",
    llm: { binding: models.generation, modelRole: "generation" },
    processInputs: traceInputsForGenerationToolLoop,
  },
);
const tracedValidate = traceLLMStage(
  "llm.run_response_validator",
  runResponseValidator,
  {
    subsystem: "llm",
    turn: "foreground",
    llm: { binding: models.validator, modelRole: "validator" },
    processInputs: (inputs) => {
      const input = unwrapValidatorTraceInput(inputs);
      return {
        wasCanonInjected: input.wasCanonInjected ?? false,
        retrievedCanonNarrativeChars: (input.retrievedCanonNarrative ?? "").length,
        draftChars: input.draft.length,
      };
    },
    processOutputs: (outputs) => {
      const o = outputs as unknown as ValidationResult;
      return {
        needs_rewrite: o.needs_rewrite,
        canon_consistent: o.canon_consistent,
        issueCount: o.issues.length,
        issuesPreview: o.issues.slice(0, 5),
      };
    },
  },
);
const tracedResponseRewriteGeneration = traceStreamingLLM(
  "llm.response_rewrite_generation",
  generateWithToolsStream,
  {
    subsystem: "llm",
    turn: "foreground",
    llm: { binding: models.generation, modelRole: "generation" },
    processInputs: traceInputsForGenerationToolLoop,
  },
);

function buildToolMessages(
  promptContext: PromptContext,
  userMessage: string,
  options?: {
    isFirstUserTurn: boolean;
  },
): {
  messages: ToolChatMessage[];
  markerInjected: boolean;
  markerReason: string;
} {
  // TG1: When isolation applies, use the stripped generation-facing message
  // instead of the raw user message. The generator must not see 【】 content.
  const generationMessage = promptContext.generationUserMessage ?? userMessage;
  const decorated = decorateUserMessageForGeneration({
    userMessage: generationMessage,
    isFirstUserTurn: options?.isFirstUserTurn ?? false,
  });

  return {
    messages: [
      { role: "system", content: promptContext.systemPrompt },
      ...promptContext.conversationHistory.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: decorated.content },
    ],
    markerInjected: decorated.markerInjected,
    markerReason: decorated.markerReason,
  };
}

function buildRewriteToolMessages(
  promptContext: PromptContext,
  userMessage: string,
  rewriteSystemPrompt: string,
  options?: {
    isFirstUserTurn: boolean;
  },
): {
  messages: ToolChatMessage[];
  markerInjected: boolean;
  markerReason: string;
} {
  // TG1: When isolation applies, use the stripped generation-facing message
  // for rewrites too — the rewrite path inherits the [REPLY DIRECTION] block
  // automatically from promptContext.systemPrompt.
  const generationMessage = promptContext.generationUserMessage ?? userMessage;
  const decorated = decorateUserMessageForGeneration({
    userMessage: generationMessage,
    isFirstUserTurn: options?.isFirstUserTurn ?? false,
  });

  return {
    messages: [
      { role: "system", content: rewriteSystemPrompt },
      ...promptContext.conversationHistory.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: decorated.content },
    ],
    markerInjected: decorated.markerInjected,
    markerReason: decorated.markerReason,
  };
}

const ALLOWED_GENERATION_TOOLS: string[] = ["web_search"];

/**
 * Decorate the user message with the DeepSeek thinking marker when conditions are met.
 * Marker is appended only for generation provider messages — the raw userMessage
 * is preserved for validation, persistence, retrieval, memory, and StructMem.
 */
function decorateUserMessageForGeneration(input: {
  userMessage: string;
  isFirstUserTurn: boolean;
}): {
  content: string;
  markerInjected: boolean;
  markerReason: string;
} {
  const result = appendDeepSeekThinkingMarker({
    content: input.userMessage,
    mode: env.DEEPSEEK_V4_THINKING_MODE as DeepSeekV4ThinkingMode,
    generationModel: models.generation,
    isFirstUserTurn: input.isFirstUserTurn,
    scope: env.DEEPSEEK_V4_THINKING_MARKER_SCOPE as DeepSeekV4ThinkingMarkerScope,
  });

  return {
    content: result.content,
    markerInjected: result.injected,
    markerReason: result.reason,
  };
}

/**
 * Generate a draft through the provider tool loop.
 *
 * Yields thought and tool-call events during generation.
 * Returns the draft content and token counts on success.
 * Throws `ToolLoopExceededError` if the tool loop budget is exceeded.
 *
 * Does NOT record eval snapshots — those are owned by the calling orchestration.
 */
export async function* generateDraft(input: {
  promptContext: PromptContext;
  userMessage: string;
  session: ChatSession;
  characterDefaults: CharacterDefaults;
  toolCtx: ToolCtx;
  signal?: AbortSignal;
  thoughtSummaryCache: Map<string, string>;
  thoughtsAcc: Thought[];
  isFirstUserTurn: boolean;
  voiceHints: string;
  openAICompatibleRequestExtensions: Record<string, unknown> | undefined;
  buildMessages: typeof buildToolMessages;
}): AsyncGenerator<OrchestrationStreamEvent, { content: string; inputTokens: number; outputTokens: number }> {
  const {
    promptContext,
    userMessage,
    session,
    characterDefaults,
    toolCtx,
    signal,
    thoughtSummaryCache,
    thoughtsAcc,
    isFirstUserTurn,
    voiceHints,
    openAICompatibleRequestExtensions,
    buildMessages,
  } = input;

  const cache = thoughtSummaryCache;

  async function* emitThought(
    thought: Thought,
  ): AsyncGenerator<OrchestrationStreamEvent> {
    thoughtsAcc.push(thought);
    yield { type: "thought", thought };
  }

  let completed = false;
  const builtMessages = buildMessages(promptContext, userMessage, { isFirstUserTurn });
  const generationInput: Parameters<typeof generateWithToolsStream>[0] = {
    messages: builtMessages.messages,
    ctx: toolCtx,
    signal,
    enableTools: true,
    allowedToolNames: ALLOWED_GENERATION_TOOLS,
    ...(openAICompatibleRequestExtensions !== undefined
      ? { openAICompatibleRequestExtensions }
      : {}),
  };
  Object.assign(generationInput, {
    deepseekThinkingMode: env.DEEPSEEK_V4_THINKING_MODE,
    deepseekThinkingMarkerScope: env.DEEPSEEK_V4_THINKING_MARKER_SCOPE,
    deepseekThinkingMarkerInjected: builtMessages.markerInjected,
    deepseekThinkingMarkerReason: builtMessages.markerReason,
    deepseekThinkingMarkerPlacement: "current_user_message",
    deepseekThinkingTargetModel: `${models.generation.provider}:${models.generation.model}`,
  });

  let result: { content: string; inputTokens: number; outputTokens: number } | undefined;

  for await (const ev of tracedResponseGeneration(generationInput)) {
    if (ev.type === "delta") {
      if (ev.reasoning && env.SHOW_NATIVE_REASONING_EVENTS) {
        const thought: Thought = {
          kind: "native",
          text: ev.reasoning,
          ts: Date.now(),
        };
        yield* emitThought(thought);
      }
    }
    if (ev.type === "before_tool") {
      const summary = await generateThoughtSummary(
        { characterName: characterDefaults.name, stage: "tool_decision", context: { tool: ev.name, args: ev.args }, voiceHints },
        cache,
      );
      yield* emitThought({ kind: "tool_decision", text: summary, ts: Date.now(), meta: { tool: ev.name } });
      yield { type: "tool_call", id: ev.id, name: ev.name, args: ev.args };
    }
    if (ev.type === "after_tool") {
      yield { type: "tool_result", id: ev.id, name: ev.name, summary: ev.summary };
      const voiceSummary = await generateThoughtSummary(
        { characterName: characterDefaults.name, stage: "tool_result", context: { tool: ev.name, summary: ev.summary }, voiceHints },
        cache,
      );
      yield* emitThought({ kind: "tool_result", text: voiceSummary, ts: Date.now(), meta: { tool: ev.name } });
    }
    if (ev.type === "done") {
      result = { content: ev.content, inputTokens: ev.inputTokens, outputTokens: ev.outputTokens };
      completed = true;
    }
  }

  if (!completed || !result) {
    throw new Error("Draft generation ended without completion");
  }

  return result;
}

/**
 * Validate a draft through the LLM validator and record the attempt.
 *
 * Does NOT record `recordValidationSnapshot` — that depends on the final
 * outcome (pass, rewrite, deflection) which is decided at the orchestration level.
 */
export async function validateDraft(
  draft: string,
  validatorInput: Omit<ValidatorInput, "draft">,
  attempt: number,
): Promise<ValidationResult> {
  const result = await tracedValidate({ ...validatorInput, draft });
  recordValidationAttempt({
    attempt,
    needsRewrite: result.needs_rewrite,
    inCharacter: result.in_character,
    canonConsistent: result.canon_consistent,
    issues: result.issues,
  });
  return result;
}

/**
 * Generate a rewrite through the provider tool loop using rewrite-system-prompt
 * constructed from validation issues.
 *
 * Yields the rewrite-intro thought, then tool-call and delta events during
 * generation. Returns rewritten content and token counts on success.
 * Throws `ToolLoopExceededError` if the tool loop budget is exceeded.
 *
 * Does NOT record eval snapshots.
 */
export async function* rewriteDraft(input: {
  promptContext: PromptContext;
  userMessage: string;
  session: ChatSession;
  characterDefaults: CharacterDefaults;
  toolCtx: ToolCtx;
  signal?: AbortSignal;
  thoughtSummaryCache: Map<string, string>;
  thoughtsAcc: Thought[];
  isFirstUserTurn: boolean;
  voiceHints: string;
  openAICompatibleRequestExtensions: Record<string, unknown> | undefined;
  issues: string[];
  rewriteIntro: string;
  buildRewriteMessages: typeof buildRewriteToolMessages;
}): AsyncGenerator<OrchestrationStreamEvent, { content: string; inputTokens: number; outputTokens: number }> {
  const {
    promptContext, userMessage, session, characterDefaults, toolCtx, signal,
    thoughtSummaryCache, thoughtsAcc, isFirstUserTurn, voiceHints,
    openAICompatibleRequestExtensions, issues, rewriteIntro, buildRewriteMessages,
  } = input;

  const cache = thoughtSummaryCache;

  // Yield rewrite-intro thought
  thoughtsAcc.push({ kind: "rewrite", text: rewriteIntro, ts: Date.now() });
  yield { type: "thought", thought: { kind: "rewrite", text: rewriteIntro, ts: Date.now() } };

  async function* emitThought(thought: Thought): AsyncGenerator<OrchestrationStreamEvent> {
    thoughtsAcc.push(thought);
    yield { type: "thought", thought };
  }

  const rewriteSystemPrompt =
    promptContext.systemPrompt +
    `\n\n[REWRITE INSTRUCTION]\n` +
    `前次回复存在以下问题，请重新生成，修正这些问题：\n` +
    issues.map((issue) => `- ${issue}`).join("\n");

  let completed = false;
  const builtMessages = buildRewriteMessages(
    promptContext, userMessage, rewriteSystemPrompt, { isFirstUserTurn },
  );
  const generationInput: Parameters<typeof generateWithToolsStream>[0] = {
    messages: builtMessages.messages,
    ctx: toolCtx,
    signal,
    enableTools: true,
    allowedToolNames: ALLOWED_GENERATION_TOOLS,
    ...(openAICompatibleRequestExtensions !== undefined ? { openAICompatibleRequestExtensions } : {}),
  };
  Object.assign(generationInput, {
    deepseekThinkingMode: env.DEEPSEEK_V4_THINKING_MODE,
    deepseekThinkingMarkerScope: env.DEEPSEEK_V4_THINKING_MARKER_SCOPE,
    deepseekThinkingMarkerInjected: builtMessages.markerInjected,
    deepseekThinkingMarkerReason: builtMessages.markerReason,
    deepseekThinkingMarkerPlacement: "rewrite_current_user_message",
    deepseekThinkingTargetModel: `${models.generation.provider}:${models.generation.model}`,
  });

  let result: { content: string; inputTokens: number; outputTokens: number } | undefined;

  for await (const ev of tracedResponseRewriteGeneration(generationInput)) {
    if (ev.type === "delta") {
      if (ev.text) {
        yield { type: "delta", text: ev.text };
      }
      if (ev.reasoning && env.SHOW_NATIVE_REASONING_EVENTS) {
        yield* emitThought({ kind: "native", text: ev.reasoning, ts: Date.now() });
      }
    }
    if (ev.type === "before_tool") {
      const summary = await generateThoughtSummary(
        { characterName: characterDefaults.name, stage: "tool_decision", context: { tool: ev.name, args: ev.args }, voiceHints },
        cache,
      );
      yield* emitThought({ kind: "tool_decision", text: summary, ts: Date.now(), meta: { tool: ev.name } });
      yield { type: "tool_call", id: ev.id, name: ev.name, args: ev.args };
    }
    if (ev.type === "after_tool") {
      yield { type: "tool_result", id: ev.id, name: ev.name, summary: ev.summary };
      const voiceSummary = await generateThoughtSummary(
        { characterName: characterDefaults.name, stage: "tool_result", context: { tool: ev.name, summary: ev.summary }, voiceHints },
        cache,
      );
      yield* emitThought({ kind: "tool_result", text: voiceSummary, ts: Date.now(), meta: { tool: ev.name } });
    }
    if (ev.type === "done") {
      result = { content: ev.content, inputTokens: ev.inputTokens, outputTokens: ev.outputTokens };
      completed = true;
    }
  }

  if (!completed || !result) {
    throw new Error("Rewrite generation ended without completion");
  }

  return result;
}

/**
 * Emit a safe-deflection sequence: deflect thought, completion event, and
 * eval snapshot.
 *
 * Unified for both tool-loop-exceeded and validator-hard-fail reasons.
 * Returns a `_complete`-compatible `GenerateAndValidateResult` with
 * `wasDeflected: true`.
 */
export async function* safeDeflection(
  input: {
    characterName: string;
    safeDeflectionText: string;
    reason: "tool_loop_exceeded" | "validator_hard_fail" | "rewrite_tool_loop_exceeded";
    thoughtSummaryCache: Map<string, string>;
    thoughtsAcc: Thought[];
    voiceHints: string;
    draftInputTokens?: number;
    draftOutputTokens?: number;
  },
): AsyncGenerator<OrchestrationStreamEvent, GenerateAndValidateResult> {
  const {
    characterName, safeDeflectionText, reason, thoughtSummaryCache, thoughtsAcc, voiceHints,
    draftInputTokens = 0, draftOutputTokens = 0,
  } = input;

  const line = await generateThoughtSummary(
    { characterName, stage: "deflect", context: { reason }, voiceHints },
    thoughtSummaryCache,
  );

  thoughtsAcc.push({ kind: "deflect", text: line, ts: Date.now() });
  yield { type: "thought", thought: { kind: "deflect", text: line, ts: Date.now() } };

  const result: GenerateAndValidateResult = {
    content: safeDeflectionText,
    validatorResult: VALIDATOR_FAIL_OPEN,
    wasRewritten: reason === "rewrite_tool_loop_exceeded" || reason === "validator_hard_fail",
    wasDeflected: true,
    inputTokens: draftInputTokens,
    outputTokens: draftOutputTokens,
  };

  recordValidationSnapshot({
    finalNeedsRewrite: result.wasRewritten,
    wasRewritten: result.wasRewritten,
    wasDeflected: true,
    deflectionReason: reason,
  });

  return result;
}

/**
 * Draft, validate, rewrite once, validate again, then safe deflection ladder,
 * yielding orchestration events incrementally. Ends with a `_complete` sentinel.
 */
export async function* generateAndValidateStream(input: {
  promptContext: PromptContext;
  userMessage: string;
  session: ChatSession;
  personaOverlay: PersonaOverlayDefaults;
  signal?: AbortSignal;
  thoughtSummaryCache?: Map<string, string>;
  thoughtsOut?: Thought[];
  isFirstUserTurn?: boolean;
}): AsyncGenerator<GenerateAndValidateYield> {
  const {
    promptContext,
    userMessage,
    session,
    personaOverlay,
    signal,
    thoughtSummaryCache,
    thoughtsOut,
    isFirstUserTurn = false,
  } = input;

  const characterDefaults = loadCharacterDefaults(session.characterId);
  const voiceHints = voiceHintsFrom(characterDefaults);
  const cache = thoughtSummaryCache ?? new Map<string, string>();
  const thoughtsAcc = thoughtsOut ?? [];

  async function* emitThought(
    thought: Thought,
  ): AsyncGenerator<OrchestrationStreamEvent> {
    thoughtsAcc.push(thought);
    yield { type: "thought", thought };
  }

  const validatorInput = buildValidatorContext({
    session,
    personaOverlay,
    promptContext,
    userMessage,
    signal,
  });

  const toolCtx: ToolCtx = {
    sessionId: session.sessionId,
    characterId: session.characterId,
    memoryNamespace: session.memoryNamespace,
    continuityScope: session.continuityScope,
    continuityFamily: session.continuityFamily as "main_world" | "au",
    signal: signal ?? new AbortController().signal,
  };

  const openAICompatibleRequestExtensions = extensionsForGenerationThinking(
    models.generation,
    session.thinking,
  );

  let draft: { content: string; inputTokens: number; outputTokens: number };

  try {
    draft = yield* generateDraft({
      promptContext,
      userMessage,
      session,
      characterDefaults,
      toolCtx,
      signal,
      thoughtSummaryCache: cache,
      thoughtsAcc,
      isFirstUserTurn,
      voiceHints,
      openAICompatibleRequestExtensions,
      buildMessages: buildToolMessages,
    });
  } catch (e) {
    if (e instanceof ToolLoopExceededError) {
      yield* safeDeflection({
        characterName: characterDefaults.name,
        safeDeflectionText: characterDefaults.safe_deflection,
        reason: "tool_loop_exceeded",
        thoughtSummaryCache: cache,
        thoughtsAcc,
        voiceHints,
      });
      return;
    }
    throw e;
  }

  const validation1 = await validateDraft(draft.content, validatorInput, 1);

  if (!validation1.needs_rewrite) {
    yield* replayValidatedDraftDeltas(draft.content, signal);
    yield {
      type: "_complete",
      result: {
        content: draft.content,
        validatorResult: validation1,
        wasRewritten: false,
        wasDeflected: false,
        inputTokens: draft.inputTokens,
        outputTokens: draft.outputTokens,
      },
    };
    recordValidationSnapshot({
      finalNeedsRewrite: validation1.needs_rewrite,
      wasRewritten: false,
      wasDeflected: false,
    });
    return;
  }

  const drafterIssues1 = filterDrafterFacingIssues(validation1.issues);
  if (drafterIssues1.length === 0) {
    console.warn(
      "[generateAndValidate] Validator asked for rewrite but only meta/system issues were present; keeping original draft.",
    );
    yield* replayValidatedDraftDeltas(draft.content, signal);
    yield {
      type: "_complete",
      result: {
        content: draft.content,
        validatorResult: {
          ...validation1,
          needs_rewrite: false,
          issues: [],
        },
        wasRewritten: false,
        wasDeflected: false,
        inputTokens: draft.inputTokens,
        outputTokens: draft.outputTokens,
      },
    };
    recordValidationSnapshot({
      finalNeedsRewrite: false,
      wasRewritten: false,
      wasDeflected: false,
    });
    return;
  }

  const rewriteIntro = await generateThoughtSummary(
    {
      characterName: characterDefaults.name,
      stage: "rewrite",
      context: { issues: drafterIssues1 },
      voiceHints,
    },
    cache,
  );
  yield* emitThought({ kind: "rewrite", text: rewriteIntro, ts: Date.now() });

  const hasCanonEvidenceIssue = drafterIssues1.some(
    (i) =>
      i.startsWith("Attribution claim") ||
      i.includes("canon_unsupported_claim"),
  );

  let rewrite: { content: string; inputTokens: number; outputTokens: number };

  try {
    rewrite = yield* rewriteDraft({
      promptContext, userMessage, session, characterDefaults, toolCtx, signal,
      thoughtSummaryCache: cache, thoughtsAcc, isFirstUserTurn, voiceHints,
      openAICompatibleRequestExtensions,
      issues: drafterIssues1, rewriteIntro,
      buildRewriteMessages: buildRewriteToolMessages,
    });
  } catch (e) {
    if (e instanceof ToolLoopExceededError) {
      yield* safeDeflection({
        characterName: characterDefaults.name,
        safeDeflectionText: characterDefaults.safe_deflection,
        reason: "rewrite_tool_loop_exceeded",
        thoughtSummaryCache: cache, thoughtsAcc, voiceHints,
        draftInputTokens: draft.inputTokens,
        draftOutputTokens: draft.outputTokens,
      });
      return;
    }
    throw e;
  }

  const validation2 = await validateDraft(rewrite.content, validatorInput, 2);

  if (!validation2.needs_rewrite) {
    yield {
      type: "_complete",
      result: {
        content: rewrite.content,
        validatorResult: validation2,
        wasRewritten: true,
        wasDeflected: false,
        inputTokens: draft.inputTokens + rewrite.inputTokens,
        outputTokens: draft.outputTokens + rewrite.outputTokens,
      },
    };
    recordValidationSnapshot({
      finalNeedsRewrite: validation2.needs_rewrite,
      wasRewritten: true,
      wasDeflected: false,
    });
    return;
  }

  const drafterIssues2 = filterDrafterFacingIssues(validation2.issues);
  if (drafterIssues2.length === 0) {
    console.warn(
      "[generateAndValidate] Second validation failed only with meta/system issues; keeping rewrite draft.",
    );
    yield {
      type: "_complete",
      result: {
        content: rewrite.content,
        validatorResult: {
          ...validation2,
          needs_rewrite: false,
          issues: [],
        },
        wasRewritten: true,
        wasDeflected: false,
        inputTokens: draft.inputTokens + rewrite.inputTokens,
        outputTokens: draft.outputTokens + rewrite.outputTokens,
      },
    };
    recordValidationSnapshot({
      finalNeedsRewrite: false,
      wasRewritten: true,
      wasDeflected: false,
    });
    return;
  }

  const deflectLine = await generateThoughtSummary(
    {
      characterName: characterDefaults.name,
      stage: "deflect",
      context: { issues: drafterIssues2 },
      voiceHints,
    },
    cache,
  );
  yield* emitThought({ kind: "deflect", text: deflectLine, ts: Date.now() });

  const deflection = characterDefaults.safe_deflection;
  yield {
    type: "_complete",
    result: {
      content: deflection,
      validatorResult: validation2,
      wasRewritten: true,
      wasDeflected: true,
      inputTokens: draft.inputTokens + rewrite.inputTokens,
      outputTokens: draft.outputTokens + rewrite.outputTokens,
    },
  };
  recordValidationSnapshot({
    finalNeedsRewrite: validation2.needs_rewrite,
    wasRewritten: true,
    wasDeflected: true,
    deflectionReason: "validator_second_pass_failed",
  });
}

/** Non-streaming wrapper that drains {@link generateAndValidateStream}. */
export async function generateAndValidate(
  input: Parameters<typeof generateAndValidateStream>[0],
): Promise<GenerateAndValidateResult> {
  let result: GenerateAndValidateResult | undefined;
  for await (const ev of generateAndValidateStream(input)) {
    if (ev.type === "_complete") result = ev.result;
  }
  if (!result) {
    throw new Error("generateAndValidate completed without a result");
  }
  return result;
}

// ---------------------------------------------------------------------------
// Shared validator context builder
// ---------------------------------------------------------------------------

/**
 * Build `Omit<ValidatorInput, "draft">` from session, prompt context, and
 * persona overlay fields.
 *
 * This helper is shared between the direct generation path and the graph
 * generation path to ensure validation receives the same context fields.
 */
export function buildValidatorContext(input: {
  session: { characterId: string; continuityScope: string; mode: string };
  personaOverlay: {
    max_nsfw_level: string;
    escalation_rule: string;
    out_of_scope_chapter_behavior: string;
  };
  promptContext: {
    conversationHistory?: Array<{ role: string; content: string }>;
    retrievedCanonNarrative?: string;
    selectedMemorySources?: Array<unknown>;
    canonTruthMode?: string;
  };
  userMessage: string;
  signal?: AbortSignal;
}): Omit<ValidatorInput, "draft"> {
  const priorTranscript = (input.promptContext.conversationHistory ?? [])
    .slice(-4)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const recentContextStr = [
    "Recent transcript (last messages from session, before this turn):",
    priorTranscript || "(none)",
    "",
    "Current user message (this turn):",
    `user: ${input.userMessage}`,
  ].join("\n");

  return {
    characterId: input.session.characterId,
    continuityScope: input.session.continuityScope,
    mode: input.session.mode,
    maxNsfwLevel: input.personaOverlay.max_nsfw_level,
    escalationRule: input.personaOverlay.escalation_rule,
    outOfScopeChapterBehavior: input.personaOverlay.out_of_scope_chapter_behavior,
    recentContext: recentContextStr,
    retrievedCanonNarrative: input.promptContext.retrievedCanonNarrative ?? "",
    wasCanonInjected:
      (input.promptContext.retrievedCanonNarrative?.length ?? 0) > 30,
    selectedMemorySources: (input.promptContext.selectedMemorySources ?? []) as any,
    canonTruthMode: input.promptContext.canonTruthMode as CanonTruthMode | undefined,
    signal: input.signal,
  };
}

export const __testing = {
  traceInputsForGenerationToolLoop,
  decorateUserMessageForGeneration,
  buildToolMessages,
  buildRewriteToolMessages,
  buildValidatorContext,
};
