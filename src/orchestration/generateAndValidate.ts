import { generateCharacterReply } from "../llm/generateCharacterReply";
import { runResponseValidator } from "../llm/runResponseValidator";
import type { ValidationResult } from "../llm/runResponseValidator";
import type { PromptContext } from "./buildPromptContext";
import type { ChatSession } from "../db/schema/chat";
import type { PersonaOverlayDefaults } from "../character/characterDefaults";
import { loadCharacterDefaults } from "../character/characterDefaults";
import { traceStage, traceLLMStage } from "../observability/langsmithTracing";

export interface GenerateAndValidateResult {
  content: string;
  validatorResult: ValidationResult;
  wasRewritten: boolean;
  wasDeflected: boolean;
  inputTokens: number;
  outputTokens: number;
}

const tracedGenerate = traceLLMStage("llm.generate_character_reply", generateCharacterReply);
const tracedValidate = traceStage("llm.run_response_validator", runResponseValidator);

/**
 * Draft → validate → rewrite-once → validate again → safe deflection ladder (§7/§12).
 *
 * All failure paths are logged through the caller's LangSmith trace span
 * (validator result is always returned as part of the result).
 */
export async function generateAndValidate(input: {
  promptContext: PromptContext;
  userMessage: string;
  session: ChatSession;
  personaOverlay: PersonaOverlayDefaults;
}): Promise<GenerateAndValidateResult> {
  const { promptContext, userMessage, session, personaOverlay } = input;
  const characterDefaults = loadCharacterDefaults(session.characterId);

  const recentContextStr = promptContext.conversationHistory
    .slice(-4)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const validatorInput = {
    characterId: session.characterId,
    continuityScope: session.continuityScope,
    mode: session.mode,
    maxNsfwLevel: personaOverlay.max_nsfw_level,
    escalationRule: personaOverlay.escalation_rule,
    outOfScopeChapterBehavior: personaOverlay.out_of_scope_chapter_behavior,
    recentContext: recentContextStr,
  };

  // Step 1: Generate draft
  const draft = await tracedGenerate({
    systemPrompt: promptContext.systemPrompt,
    conversationHistory: promptContext.conversationHistory,
    userMessage,
  });

  // Step 2: Validate draft
  const validation1 = await tracedValidate({
    ...validatorInput,
    draft: draft.content,
  });

  if (!validation1.needs_rewrite) {
    return {
      content: draft.content,
      validatorResult: validation1,
      wasRewritten: false,
      wasDeflected: false,
      inputTokens: draft.inputTokens,
      outputTokens: draft.outputTokens,
    };
  }

  // Step 3: Rewrite once — inject issues into a new system prompt addendum
  const rewriteSystemPrompt =
    promptContext.systemPrompt +
    `\n\n[REWRITE INSTRUCTION]\n` +
    `前次回复存在以下问题，请重新生成，修正这些问题：\n` +
    validation1.issues.map((issue) => `- ${issue}`).join("\n");

  const rewrite = await tracedGenerate({
    systemPrompt: rewriteSystemPrompt,
    conversationHistory: promptContext.conversationHistory,
    userMessage,
  });

  // Step 4: Validate rewrite
  const validation2 = await tracedValidate({
    ...validatorInput,
    draft: rewrite.content,
  });

  if (!validation2.needs_rewrite) {
    return {
      content: rewrite.content,
      validatorResult: validation2,
      wasRewritten: true,
      wasDeflected: false,
      inputTokens: draft.inputTokens + rewrite.inputTokens,
      outputTokens: draft.outputTokens + rewrite.outputTokens,
    };
  }

  // Step 5: Safe in-character deflection
  const deflection = characterDefaults.safe_deflection;
  return {
    content: deflection,
    validatorResult: validation2,
    wasRewritten: true,
    wasDeflected: true,
    inputTokens: draft.inputTokens + rewrite.inputTokens,
    outputTokens: draft.outputTokens + rewrite.outputTokens,
  };
}
