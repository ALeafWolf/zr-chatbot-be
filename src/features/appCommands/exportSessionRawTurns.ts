import type { ChatMessage } from "../../db/schema/chat";
import type {
  ExportFormat,
  ExportOptions,
  FileExportResult,
  TurnType,
} from "./appCommandTypes";
import { APP_COMMAND_EXPORT } from "./appCommandTypes";

// ---------------------------------------------------------------------------
// Route mapping: TurnType → chat_messages.route value
// ---------------------------------------------------------------------------
const TURN_TYPE_ROUTE: Record<TurnType, string> = {
  roleplay: "roleplay_turn",
  app_command: "app_command",
  unsupported: "unsupported",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

function roleLabel(role: string): string {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    default:
      return role;
  }
}

function formatTimestamp(date: Date): string {
  return date.toISOString();
}

// ---------------------------------------------------------------------------
// Thought normalization
// ---------------------------------------------------------------------------
interface NormalizedThought {
  kind: string;
  text: string;
}

/**
 * Join streamed fragments without inserting spaces between CJK runs.
 * Ported from frontend `joinNativeThoughtText` (`src/lib/thoughtDisplay.ts`).
 */
function joinTextFragments(fragments: string[]): string {
  return fragments.reduce((prev, next) => {
    if (!prev) return next;
    if (!next) return prev;
    const prevLast = prev[prev.length - 1];
    const nextFirst = next[0];
    if (prevLast === undefined || nextFirst === undefined) return prev + next;

    // Both have spaces around boundary already
    if (/\s/.test(prevLast) || /\s/.test(nextFirst)) return prev + next;

    // Both are ASCII letters → insert space
    if (/[a-zA-Z]/.test(prevLast) && /[a-zA-Z]/.test(nextFirst)) {
      return `${prev} ${next}`;
    }

    // Default: concatenate (CJK or punctuation boundary)
    return prev + next;
  }, "");
}

/** Supported thought kinds eligible for export when include_thoughts is true. */
const EXPORTABLE_THOUGHT_KINDS = new Set([
  "native",
  "recall",
  "tool_decision",
  "tool_result",
  "rewrite",
  "deflect",
]);

function normalizeThoughts(
  rawThoughts: unknown,
): NormalizedThought[] {
  if (!Array.isArray(rawThoughts) || rawThoughts.length === 0) return [];

  const byKind = new Map<string, string[]>();

  for (const t of rawThoughts) {
    if (!t || typeof t !== "object") continue;
    const row = t as Record<string, unknown>;
    const kind = row.kind;
    if (typeof kind !== "string" || !EXPORTABLE_THOUGHT_KINDS.has(kind)) continue;
    const text = typeof row.text === "string" ? row.text : "";
    if (text.trim().length === 0) continue;

    const arr = byKind.get(kind) ?? [];
    arr.push(text);
    byKind.set(kind, arr);
  }

  const result: NormalizedThought[] = [];
  // Preserve first-appearance order
  const seen = new Set<string>();
  for (const t of rawThoughts) {
    if (!t || typeof t !== "object") continue;
    const kind = (t as Record<string, unknown>).kind;
    if (typeof kind !== "string" || !EXPORTABLE_THOUGHT_KINDS.has(kind)) continue;
    if (seen.has(kind)) continue;
    const fragments = byKind.get(kind);
    if (!fragments || fragments.length === 0) continue;
    seen.add(kind);
    result.push({
      kind,
      text: joinTextFragments(fragments),
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Message filtering
// ---------------------------------------------------------------------------
function filterByTurnTypes(
  messages: ChatMessage[],
  turnTypes: TurnType[],
): ChatMessage[] {
  const allowedRoutes = new Set(turnTypes.map((tt) => TURN_TYPE_ROUTE[tt]));
  return messages.filter((m) => allowedRoutes.has(m.route));
}

// ---------------------------------------------------------------------------
// JSON export
// ---------------------------------------------------------------------------
function buildJsonExport(
  messages: ChatMessage[],
  sessionId: string,
  title: string,
  options: ExportOptions,
): string {
  const exportData: Record<string, unknown> = {
    session_id: sessionId,
    title,
    exported_at: new Date().toISOString(),
    options: {
      format: options.format,
      turn_types: options.turn_types,
      include_thoughts: options.include_thoughts,
    },
    message_count: messages.length,
    messages: messages.map((m) => {
      const entry: Record<string, unknown> = {
        id: m.id,
        role: m.role,
        route: m.route,
        turn_type: turnTypeFromRoute(m.route),
        turn_index: m.turnIndex,
        created_at: m.createdAt,
        content: m.content,
      };
      if (options.include_thoughts) {
        entry.thoughts = normalizeThoughts(m.thoughts);
      }
      return entry;
    }),
  };
  return JSON.stringify(exportData, null, 2);
}

function turnTypeFromRoute(route: string): TurnType {
  if (route === "roleplay_turn") return "roleplay";
  if (route === "app_command") return "app_command";
  return "unsupported";
}

// ---------------------------------------------------------------------------
// Markdown export
// ---------------------------------------------------------------------------
function buildMarkdownExport(
  messages: ChatMessage[],
  sessionId: string,
  title: string,
  includeThoughts: boolean,
): string {
  const parts: string[] = [];
  parts.push(`# Session Transcript: ${title}`);
  parts.push("");
  parts.push(`- **Session ID:** \`${sessionId}\``);
  parts.push(`- **Messages:** ${messages.length}`);
  parts.push("");
  parts.push("---");
  parts.push("");

  for (const m of messages) {
    const role = roleLabel(m.role);
    const route = m.route;
    const timestamp = formatTimestamp(m.createdAt);
    parts.push(`### Turn ${m.turnIndex} — ${role}`);
    parts.push(`*Route: ${route} · ${timestamp}*`);
    parts.push("");
    parts.push(m.content);
    parts.push("");

    if (includeThoughts) {
      const normalized = normalizeThoughts(m.thoughts);
      if (normalized.length > 0) {
        parts.push("> **Thoughts:**");
        for (const nt of normalized) {
          parts.push(`> _${nt.kind}_: ${nt.text}`);
        }
        parts.push("");
      }
    }

    parts.push("---");
    parts.push("");
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Plain-text export
// ---------------------------------------------------------------------------
function buildTextExport(
  messages: ChatMessage[],
  sessionId: string,
  title: string,
  includeThoughts: boolean,
): string {
  const SEP = "=".repeat(60);
  const SUB = "-".repeat(60);

  const parts: string[] = [];
  parts.push("Session Transcript");
  parts.push(SEP);
  parts.push(`Title: ${title}`);
  parts.push(`Session ID: ${sessionId}`);
  parts.push(`Messages: ${messages.length}`);
  parts.push(`Exported: ${new Date().toISOString()}`);
  parts.push("");
  parts.push(SUB);
  parts.push("");

  for (const m of messages) {
    const role = roleLabel(m.role);
    const timestamp = formatTimestamp(m.createdAt);
    parts.push(`--- Turn ${m.turnIndex} | ${role} ---`);
    parts.push(`Route: ${m.route} · ${timestamp}`);
    parts.push("");
    parts.push(m.content);
    parts.push("");

    if (includeThoughts) {
      const normalized = normalizeThoughts(m.thoughts);
      if (normalized.length > 0) {
        parts.push("[Thoughts]");
        for (const nt of normalized) {
          parts.push(`  ${nt.kind}: ${nt.text}`);
        }
        parts.push("");
      }
    }
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------
function exportFilename(sessionId: string, format: ExportFormat): string {
  const ext = format === "md" ? "md" : format === "json" ? "json" : "txt";
  return `session-${shortSessionId(sessionId)}-transcript.${ext}`;
}

function exportMimeType(format: ExportFormat): string {
  switch (format) {
    case "json":
      return "application/json";
    case "md":
      return "text/markdown";
    case "txt":
      return "text/plain";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function buildExportArtifact(
  messages: ChatMessage[],
  options: ExportOptions,
  sessionId: string,
  displayTitle: string | null | undefined,
): FileExportResult {
  const sorted = [...messages].sort((a, b) => a.turnIndex - b.turnIndex);

  // Apply turn-type filter
  const filtered = filterByTurnTypes(sorted, options.turn_types);

  const title = displayTitle ?? `Session ${shortSessionId(sessionId)}`;
  const format = options.format;

  const content = (() => {
    switch (format) {
      case "json":
        return buildJsonExport(filtered, sessionId, title, options);
      case "md":
        return buildMarkdownExport(
          filtered,
          sessionId,
          title,
          options.include_thoughts,
        );
      case "txt":
        return buildTextExport(
          filtered,
          sessionId,
          title,
          options.include_thoughts,
        );
    }
  })();

  const filename = exportFilename(sessionId, format);

  return {
    kind: "file_export",
    command: APP_COMMAND_EXPORT,
    message: `Your session transcript has been exported as ${format.toUpperCase()}.`,
    options,
    artifact: {
      title,
      filename,
      mime_type: exportMimeType(format),
      format,
      content,
      byte_length: Buffer.byteLength(content, "utf8"),
      message_count: filtered.length,
    },
  };
}
