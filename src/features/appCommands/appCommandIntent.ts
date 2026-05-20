import type { AppCommandName, ExportFormat } from "./appCommandTypes";
import {
  APP_COMMAND_EXPORT,
  APP_COMMAND_STATUS,
  APP_COMMAND_UNKNOWN,
} from "./appCommandTypes";

// ---------------------------------------------------------------------------
// Parsed intent
// ---------------------------------------------------------------------------
export interface ParsedAppCommandIntent {
  command: AppCommandName;
  args: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Export keyword patterns
// ---------------------------------------------------------------------------
const EXPORT_PATTERNS: RegExp[] = [
  /export/i,
  /download/i,
  /导出/i,
  /下载/i,
  /raw turns/i,
  /transcript/i,
  /conversation/i,
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
// Deterministic intent parser
// ---------------------------------------------------------------------------
export function parseAppCommandIntent(
  userMessage: string,
): ParsedAppCommandIntent {
  // Export takes priority — an ambiguous phrase like "export status" routes to export.
  if (EXPORT_PATTERNS.some((p) => p.test(userMessage))) {
    return {
      command: APP_COMMAND_EXPORT,
      args: {
        format: detectExportFormat(userMessage) ?? "md",
      },
    };
  }

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
