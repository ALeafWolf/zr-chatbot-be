import {
  runResponseValidator,
  VALIDATOR_FAIL_OPEN,
  type ValidationResult,
} from "../llm/validation/runResponseValidator";
import type { PromptContext } from "./buildPromptContext";
import type { ChatSession } from "../db/schema/chat";
import type { PersonaOverlayDefaults } from "../character/characterDefaults";
import { loadCharacterDefaults } from "../character/characterDefaults";
import {
  traceLLMStage,
  traceStage,
  traceStreamingLLM,
} from "../observability/langsmithTracing";
import type { ToolChatMessage } from "../llm/providers";
import {
  generateWithToolsStream,
  ToolLoopExceededError,
} from "./generateWithTools";
import type { ToolCtx } from "../llm/tools/types";
import { generateThoughtSummary } from "../llm/generation/generateThoughtSummary";
import type { Thought } from "./thoughtTypes";
import type { OrchestrationStreamEvent } from "./thoughtTypes";
import { extensionsForGenerationThinking } from "../llm/generation/generationThinkingExtensions";
import { models } from "../config/models";
import {
  filterDrafterFacingIssues,
  replayValidatedDraftDeltas,
} from "./validationFlowHelpers";
import {
  recordValidationAttempt,
  recordValidationSnapshot,
} from "../eval/evalSnapshots";

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

/** Chunk size when replaying validated first-draft prose to SSE (~UTF-16 code units). */
const tracedResponseGeneration = traceStreamingLLM(
  "llm.response_generation",
  generateWithToolsStream,
  {
    subsystem: "llm",
    turn: "foreground",
    llm: { binding: models.generation, modelRole: "generation" },
  },
);
const tracedValidate = traceLLMStage(
  "llm.run_response_validator",
  runResponseValidator,
  {
    subsystem: "llm",
    turn: "foreground",
    llm: { binding: models.validator, modelRole: "validator" },
  },
);
const tracedResponseRewriteGeneration = traceStreamingLLM(
  "llm.response_rewrite_generation",
  generateWithToolsStream,
  {
    subsystem: "llm",
    turn: "foreground",
    llm: { binding: models.generation, modelRole: "generation" },
  },
);

function buildToolMessages(
  promptContext: PromptContext,
  userMessage: string,
): ToolChatMessage[] {
  return [
    { role: "system", content: promptContext.systemPrompt },
    ...promptContext.conversationHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];
}

function buildRewriteToolMessages(
  promptContext: PromptContext,
  userMessage: string,
  rewriteSystemPrompt: string,
): ToolChatMessage[] {
  return [
    { role: "system", content: rewriteSystemPrompt },
    ...promptContext.conversationHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];
}

function voiceHintsFrom(
  characterDefaults: ReturnType<typeof loadCharacterDefaults>,
): string {
  const s = characterDefaults.speech_style;
  return [s.formality, s.emotionality, ...(s.preferred_patterns ?? [])].join(
    "，",
  );
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
}): AsyncGenerator<GenerateAndValidateYield> {
  const {
    promptContext,
    userMessage,
    session,
    personaOverlay,
    signal,
    thoughtSummaryCache,
    thoughtsOut,
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

  const priorTranscript = promptContext.conversationHistory
    .slice(-4)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
  const recentContextStr = [
    "Recent transcript (last messages from session, before this turn):",
    priorTranscript || "(none)",
    "",
    "Current user message (this turn):",
    `user: ${userMessage}`,
  ].join("\n");

  const validatorInput = {
    characterId: session.characterId,
    continuityScope: session.continuityScope,
    mode: session.mode,
    maxNsfwLevel: personaOverlay.max_nsfw_level,
    escalationRule: personaOverlay.escalation_rule,
    outOfScopeChapterBehavior: personaOverlay.out_of_scope_chapter_behavior,
    recentContext: recentContextStr,
    retrievedCanonNarrative: promptContext.retrievedCanonNarrative ?? "",
    signal,
  };

  const toolCtx: ToolCtx = {
    sessionId: session.sessionId,
    characterId: session.characterId,
    continuityScope: session.continuityScope,
    continuityFamily: session.continuityFamily as "main_world" | "au",
    signal: signal ?? new AbortController().signal,
  };

  const openAICompatibleRequestExtensions = extensionsForGenerationThinking(
    models.generation,
    session.thinking,
  );

  let draft!: { content: string; inputTokens: number; outputTokens: number };

  try {
    let completed = false;
    for await (const ev of tracedResponseGeneration({
      messages: buildToolMessages(promptContext, userMessage),
      ctx: toolCtx,
      signal,
      enableTools: true,
      ...(openAICompatibleRequestExtensions !== undefined
        ? { openAICompatibleRequestExtensions }
        : {}),
    })) {
      if (ev.type === "delta") {
        // Draft prose is withheld from SSE until after validation; native reasoning streams as thoughts.
        if (ev.reasoning) {
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
          {
            characterName: characterDefaults.name,
            stage: "tool_decision",
            context: { tool: ev.name, args: ev.args },
            voiceHints,
          },
          cache,
        );
        yield* emitThought({
          kind: "tool_decision",
          text: summary,
          ts: Date.now(),
          meta: { tool: ev.name },
        });
        yield {
          type: "tool_call",
          id: ev.id,
          name: ev.name,
          args: ev.args,
        };
      }
      if (ev.type === "after_tool") {
        yield {
          type: "tool_result",
          id: ev.id,
          name: ev.name,
          summary: ev.summary,
        };
        const voiceSummary = await generateThoughtSummary(
          {
            characterName: characterDefaults.name,
            stage: "tool_result",
            context: { tool: ev.name, summary: ev.summary },
            voiceHints,
          },
          cache,
        );
        yield* emitThought({
          kind: "tool_result",
          text: voiceSummary,
          ts: Date.now(),
          meta: { tool: ev.name },
        });
      }
      if (ev.type === "done") {
        draft = {
          content: ev.content,
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
        };
        completed = true;
      }
    }
    if (!completed) {
      throw new Error("Draft generation ended without completion");
    }
  } catch (e) {
    if (e instanceof ToolLoopExceededError) {
      const line = await generateThoughtSummary(
        {
          characterName: characterDefaults.name,
          stage: "deflect",
          context: { reason: "tool_loop_exceeded" },
          voiceHints,
        },
        cache,
      );
      yield* emitThought({ kind: "deflect", text: line, ts: Date.now() });
      yield {
        type: "_complete",
        result: {
          content: characterDefaults.safe_deflection,
          validatorResult: VALIDATOR_FAIL_OPEN,
          wasRewritten: false,
          wasDeflected: true,
          inputTokens: 0,
          outputTokens: 0,
        },
      };
      recordValidationSnapshot({
        finalNeedsRewrite: false,
        wasRewritten: false,
        wasDeflected: true,
        deflectionReason: "tool_loop_exceeded",
      });
      return;
    }
    throw e;
  }

  const validation1 = await tracedValidate({
    ...validatorInput,
    draft: draft.content,
  });
  recordValidationAttempt({
    attempt: 1,
    needsRewrite: validation1.needs_rewrite,
    inCharacter: validation1.in_character,
    canonConsistent: validation1.canon_consistent,
    issues: validation1.issues,
  });

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

  const attributionRewriteHint = drafterIssues1.some((i) =>
    i.startsWith("Attribution claim"),
  )
    ? "如确有把握请先调用 canon_lookup 检索原文佐证；否则改写时移除该归属判断。\n\n"
    : "";

  const rewriteSystemPrompt =
    promptContext.systemPrompt +
    `\n\n[REWRITE INSTRUCTION]\n` +
    attributionRewriteHint +
    `前次回复存在以下问题，请重新生成，修正这些问题：\n` +
    drafterIssues1.map((issue) => `- ${issue}`).join("\n");

  let rewrite!: { content: string; inputTokens: number; outputTokens: number };

  try {
    let completed = false;
    for await (const ev of tracedResponseRewriteGeneration({
      messages: buildRewriteToolMessages(
        promptContext,
        userMessage,
        rewriteSystemPrompt,
      ),
      ctx: toolCtx,
      signal,
      enableTools: true,
      /** One optional tool round + final reply (two assistant completions). */
      maxToolSteps: 2,
      ...(openAICompatibleRequestExtensions !== undefined
        ? { openAICompatibleRequestExtensions }
        : {}),
    })) {
      if (ev.type === "delta") {
        if (ev.text) {
          yield { type: "delta", text: ev.text };
        }
        if (ev.reasoning) {
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
          {
            characterName: characterDefaults.name,
            stage: "tool_decision",
            context: { tool: ev.name, args: ev.args },
            voiceHints,
          },
          cache,
        );
        yield* emitThought({
          kind: "tool_decision",
          text: summary,
          ts: Date.now(),
          meta: { tool: ev.name },
        });
        yield {
          type: "tool_call",
          id: ev.id,
          name: ev.name,
          args: ev.args,
        };
      }
      if (ev.type === "after_tool") {
        yield {
          type: "tool_result",
          id: ev.id,
          name: ev.name,
          summary: ev.summary,
        };
        const voiceSummary = await generateThoughtSummary(
          {
            characterName: characterDefaults.name,
            stage: "tool_result",
            context: { tool: ev.name, summary: ev.summary },
            voiceHints,
          },
          cache,
        );
        yield* emitThought({
          kind: "tool_result",
          text: voiceSummary,
          ts: Date.now(),
          meta: { tool: ev.name },
        });
      }
      if (ev.type === "done") {
        rewrite = {
          content: ev.content,
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
        };
        completed = true;
      }
    }
    if (!completed) {
      throw new Error("Rewrite generation ended without completion");
    }
  } catch (e) {
    if (e instanceof ToolLoopExceededError) {
      const line = await generateThoughtSummary(
        {
          characterName: characterDefaults.name,
          stage: "deflect",
          context: { reason: "rewrite_tool_loop_exceeded" },
          voiceHints,
        },
        cache,
      );
      yield* emitThought({ kind: "deflect", text: line, ts: Date.now() });
      yield {
        type: "_complete",
        result: {
          content: characterDefaults.safe_deflection,
          validatorResult: VALIDATOR_FAIL_OPEN,
          wasRewritten: true,
          wasDeflected: true,
          inputTokens: draft.inputTokens,
          outputTokens: draft.outputTokens,
        },
      };
      recordValidationSnapshot({
        finalNeedsRewrite: true,
        wasRewritten: true,
        wasDeflected: true,
        deflectionReason: "rewrite_tool_loop_exceeded",
      });
      return;
    }
    throw e;
  }

  if (!rewrite) {
    throw new Error("Rewrite stream ended without completion");
  }

  const validation2 = await tracedValidate({
    ...validatorInput,
    draft: rewrite.content,
  });
  recordValidationAttempt({
    attempt: 2,
    needsRewrite: validation2.needs_rewrite,
    inCharacter: validation2.in_character,
    canonConsistent: validation2.canon_consistent,
    issues: validation2.issues,
  });

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
