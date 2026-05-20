import type { ChatMessage } from "../../db/schema/chat";
import type { ExportFormat, FileExportResult } from "./appCommandTypes";
import { APP_COMMAND_EXPORT } from "./appCommandTypes";

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
// JSON export
// ---------------------------------------------------------------------------
function buildJsonExport(
  messages: ChatMessage[],
  sessionId: string,
  title: string,
): string {
  const exportData = {
    session_id: sessionId,
    title,
    exported_at: new Date().toISOString(),
    message_count: messages.length,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      route: m.route,
      turn_index: m.turnIndex,
      created_at: m.createdAt,
      content: m.content,
      thoughts: Array.isArray(m.thoughts) ? m.thoughts : [],
    })),
  };
  return JSON.stringify(exportData, null, 2);
}

// ---------------------------------------------------------------------------
// Markdown export
// ---------------------------------------------------------------------------
function buildMarkdownExport(
  messages: ChatMessage[],
  sessionId: string,
  title: string,
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
  format: ExportFormat,
  sessionId: string,
  displayTitle: string | null | undefined,
): FileExportResult {
  const sorted = [...messages].sort((a, b) => a.turnIndex - b.turnIndex);
  const title = displayTitle ?? `Session ${shortSessionId(sessionId)}`;

  const content = (() => {
    switch (format) {
      case "json":
        return buildJsonExport(sorted, sessionId, title);
      case "md":
        return buildMarkdownExport(sorted, sessionId, title);
      case "txt":
        return buildTextExport(sorted, sessionId, title);
    }
  })();

  const filename = exportFilename(sessionId, format);

  return {
    kind: "file_export",
    command: APP_COMMAND_EXPORT,
    message: `Your session transcript has been exported as ${format.toUpperCase()}.`,
    artifact: {
      title,
      filename,
      mime_type: exportMimeType(format),
      format,
      content,
      byte_length: Buffer.byteLength(content, "utf8"),
      message_count: sorted.length,
    },
  };
}
