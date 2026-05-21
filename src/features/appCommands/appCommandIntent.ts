import type { AppCommandName, ExportFormat, TurnType } from "./appCommandTypes";
import {
  APP_COMMAND_EXPORT,
  APP_COMMAND_STATUS,
  APP_COMMAND_HELP,
  APP_COMMAND_UNKNOWN,
} from "./appCommandTypes";

// ---------------------------------------------------------------------------
// Parsed intent
// ---------------------------------------------------------------------------
export interface ParsedAppCommandIntent {
  command: AppCommandName;
  args: Record<string, unknown>;
}

/** Default turn types when no filter is mentioned in the request. */
const DEFAULT_TURN_TYPES: TurnType[] = ["roleplay", "unsupported"];

// ---------------------------------------------------------------------------
// Help patterns (checked before export — "how do I export" is help, not export)
// ---------------------------------------------------------------------------
const HELP_PATTERNS: RegExp[] = [
  /how\s+(do|to|can|would|could)\s+.*export/i,
  /help\s+(me\s+)?(with|understand|use).*export/i,
  /what\s+(are|is|export|options|formats).*export/i,
  /export\s+(help|guide|tutorial|howto|instructions?|options?)/i,
  /怎么导出/i,
  /如何导出/i,
  /导出帮助/i,
  /导出方法/i,
  /export.*帮助/i,
];

function isExportHelp(input: string): boolean {
  return HELP_PATTERNS.some((p) => p.test(input));
}

// ---------------------------------------------------------------------------
// Export keyword patterns
// ---------------------------------------------------------------------------
const EXPORT_PATTERNS: RegExp[] = [
  // Direct export/download verbs
  /export/i,
  /download/i,
  /导出/i,
  /下载/i,
  // "raw turns" is specific enough to match standalone
  /raw turns/i,
  // Composite patterns: require an action verb near a broad target word
  /\b(get|save|show|view|fetch)\b.*\btranscript\b/i,
  /\b(get|save|show|view|fetch)\b.*\bconversation\b/i,
];

// ---------------------------------------------------------------------------
// Status keyword patterns
// ---------------------------------------------------------------------------
const STATUS_PATTERNS: RegExp[] = [
  /status/i,
  /\bstats?\b/i,
  /statistics/i,
  /^info\b/i,
  /session status/i,
  /会话状态/i,
  /统计/i,
  /^信息/i,
];

// ---------------------------------------------------------------------------
// Format detection within user input
// ---------------------------------------------------------------------------
function detectExportFormat(input: string): ExportFormat | null {
  if (/\bjson\b/i.test(input)) return "json";
  if (/\b(md|markdown)\b/i.test(input)) return "md";
  if (/\b(txt|text)\b/i.test(input)) return "txt";
  return null;
}

// ---------------------------------------------------------------------------
// Turn-type filter parsing
// ---------------------------------------------------------------------------

/** Patterns that indicate "all types" — short-circuit to all three. */
const ALL_TYPES_PATTERNS: RegExp[] = [
  /\ball\b/i,
  /\beverything\b/i,
  /\bfull\b/i,
  /全部/i,
  /所有类型/i,
];

function hasAllTypes(input: string): boolean {
  return ALL_TYPES_PATTERNS.some((p) => p.test(input));
}

/** Individual turn-type patterns — tested independently. */
interface TypePattern {
  type: TurnType;
  patterns: RegExp[];
}

const TYPE_PATTERNS: TypePattern[] = [
  {
    type: "roleplay",
    patterns: [
      /\broleplay\b/i,
      /\b(role.play|rp)\b/i,
      /\bstory\b/i,
      /\bchat\b/i,
      /角色扮演/i,
      /对话/i,
    ],
  },
  {
    type: "app_command",
    patterns: [
      /\bapp.command\b/i,
      /\bapp commands?\b/i,
      /\bcommands?\b/i,
      /\btool output\b/i,
      /\btools?\b/i,
      /\butility\b/i,
      /应用命令/i,
      /指令/i,
    ],
  },
  {
    type: "unsupported",
    patterns: [
      /\bunsupported\b/i,
      /\bunsupport\b/i,
      /\bother\b/i,
      /不支持/i,
      /其他/i,
    ],
  },
];

function parseTurnTypes(input: string): TurnType[] {
  if (hasAllTypes(input)) {
    return ["roleplay", "app_command", "unsupported"];
  }

  const mentioned = TYPE_PATTERNS.filter((tp) =>
    tp.patterns.some((p) => p.test(input)),
  ).map((tp) => tp.type);

  return mentioned.length > 0 ? mentioned : DEFAULT_TURN_TYPES;
}

// ---------------------------------------------------------------------------
// Thought option parsing
// ---------------------------------------------------------------------------
function parseIncludeThoughts(input: string): boolean {
  // Exclusion takes precedence — if the user explicitly excludes thoughts,
  // return false regardless of any positive mention.
  const excludes = [
    /\bwithout\s+thoughts?\b/i,
    /\b(no|exclude)\s+thoughts?\b/i,
    /\bwithout\s+reasoning\b/i,
    /\b(no|exclude)\s+reasoning\b/i,
    /不包含思考/i,
    /排除思考/i,
  ];
  for (const p of excludes) {
    if (p.test(input)) return false;
  }

  // Positive markers (including native/debug prompts, which imply base
  // thought inclusion as well)
  if (
    /\b(with|include|show)\s+thoughts?\b/i.test(input) ||
    /\bwith\s+reasoning\b/i.test(input) ||
    /\binclude\s+reasoning\b/i.test(input) ||
    /\bwith\s+thinking\b/i.test(input) ||
    /\bshow\s+thinking\b/i.test(input) ||
    /包含思考/i.test(input) ||
    /显示思考/i.test(input) ||
    /包含推理/i.test(input) ||
    /\binclude\s+native\s+thoughts?\b/i.test(input) ||
    /\bwith\s+native\s+thoughts?\b/i.test(input) ||
    /\bdebug\s+(native\s+)?thoughts?\b/i.test(input) ||
    /包含原生思考/i.test(input) ||
    /调试.*(原生思考|思考)/i.test(input)
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Native thought option parsing (explicit debug-only prompts)
// ---------------------------------------------------------------------------
function parseIncludeNativeThoughts(input: string): boolean {
  // Exclusion takes precedence — same as parseIncludeThoughts.
  const excludes = [
    /\bwithout\s+thoughts?\b/i,
    /\b(no|exclude)\s+thoughts?\b/i,
    /\bwithout\s+reasoning\b/i,
    /\b(no|exclude)\s+reasoning\b/i,
    /不包含思考/i,
    /排除思考/i,
  ];
  for (const p of excludes) {
    if (p.test(input)) return false;
  }

  // Only explicit native/debug phrases enable native thought export.
  // Generic phrases like "with thoughts" or "with reasoning" must NOT match.
  return (
    /\b(with|include|show)\s+.*\bnative\b.*\bthoughts?\b/i.test(input) ||
    /\bdebug\s+(native\s+)?thoughts?\b/i.test(input) ||
    /包含原生思考/i.test(input) ||
    /原生思考.*(包含|显示|导出)/i.test(input) ||
    /调试.*(原生思考|思考)/i.test(input)
  );
}

// ---------------------------------------------------------------------------
// Language detection for help text
// ---------------------------------------------------------------------------
function hasCjk(text: string): boolean {
  return /[一-鿿㐀-䶿]/.test(text);
}

// ---------------------------------------------------------------------------
// Deterministic intent parser
// ---------------------------------------------------------------------------
export function parseAppCommandIntent(
  userMessage: string,
): ParsedAppCommandIntent {
  // Help questions about export take priority
  if (isExportHelp(userMessage)) {
    return {
      command: APP_COMMAND_HELP,
      args: {
        language: hasCjk(userMessage) ? "zh" : "en",
      },
    };
  }

  // Export
  if (EXPORT_PATTERNS.some((p) => p.test(userMessage))) {
    return {
      command: APP_COMMAND_EXPORT,
      args: {
        format: detectExportFormat(userMessage) ?? "md",
        turn_types: parseTurnTypes(userMessage),
        include_thoughts: parseIncludeThoughts(userMessage),
        include_native_thoughts: parseIncludeNativeThoughts(userMessage),
      },
    };
  }

  // Status
  if (STATUS_PATTERNS.some((p) => p.test(userMessage))) {
    return {
      command: APP_COMMAND_STATUS,
      args: {},
    };
  }

  return {
    command: APP_COMMAND_UNKNOWN,
    args: {},
  };
}
