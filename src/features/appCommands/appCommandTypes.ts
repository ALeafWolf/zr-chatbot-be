import { z } from "zod";

// ---------------------------------------------------------------------------
// App command names
// ---------------------------------------------------------------------------
export const APP_COMMAND_EXPORT = "export_session_raw_turns" as const;
export const APP_COMMAND_STATUS = "show_session_status" as const;
export const APP_COMMAND_UNKNOWN = "unknown" as const;

export const AppCommandNameSchema = z.enum([
  APP_COMMAND_EXPORT,
  APP_COMMAND_STATUS,
  APP_COMMAND_UNKNOWN,
]);
export type AppCommandName = z.infer<typeof AppCommandNameSchema>;

// ---------------------------------------------------------------------------
// Export format
// ---------------------------------------------------------------------------
export const ExportFormatSchema = z.enum(["md", "json", "txt"]);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

// ---------------------------------------------------------------------------
// File export artifact
// ---------------------------------------------------------------------------
export const FileExportArtifactSchema = z.object({
  title: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  format: ExportFormatSchema,
  content: z.string(),
  byte_length: z.number(),
  message_count: z.number(),
});
export type FileExportArtifact = z.infer<typeof FileExportArtifactSchema>;

// ---------------------------------------------------------------------------
// File export result
// ---------------------------------------------------------------------------
export const FileExportResultSchema = z.object({
  kind: z.literal("file_export"),
  command: z.literal(APP_COMMAND_EXPORT),
  message: z.string(),
  artifact: FileExportArtifactSchema,
});
export type FileExportResult = z.infer<typeof FileExportResultSchema>;

// ---------------------------------------------------------------------------
// Session status result
// ---------------------------------------------------------------------------
export const SessionStatusFieldsSchema = z.object({
  display_title: z.string(),
  session_id: z.string(),
  character_id: z.string(),
  mode: z.string(),
  continuity_scope: z.string(),
  pinned_time: z.string().nullable(),
  pinned_location: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_turns: z.number(),
  message_count: z.number(),
  latest_turn_index: z.number(),
  roleplay_count: z.number(),
  app_command_count: z.number(),
  unsupported_count: z.number(),
  thinking: z.boolean(),
  temperature: z.number(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    total_tokens: z.number(),
    estimated_cost_usd: z.number().nullable(),
    coverage: z.enum(["complete", "partial", "untracked"]),
    untracked_turn_count: z.number(),
  }),
});
export type SessionStatusFields = z.infer<typeof SessionStatusFieldsSchema>;

export const SessionStatusResultSchema = z.object({
  kind: z.literal("session_status"),
  command: z.literal(APP_COMMAND_STATUS),
  message: z.string(),
  fields: SessionStatusFieldsSchema,
});
export type SessionStatusResult = z.infer<typeof SessionStatusResultSchema>;

// ---------------------------------------------------------------------------
// Unsupported command result
// ---------------------------------------------------------------------------
export const UnsupportedCommandResultSchema = z.object({
  kind: z.literal("unsupported"),
  command: z.literal(APP_COMMAND_UNKNOWN),
  message: z.string(),
  available_commands: z.array(z.string()),
});
export type UnsupportedCommandResult = z.infer<
  typeof UnsupportedCommandResultSchema
>;

// ---------------------------------------------------------------------------
// Discriminated union of all app-command results
// ---------------------------------------------------------------------------
export const AppCommandResultSchema = z.discriminatedUnion("kind", [
  FileExportResultSchema,
  SessionStatusResultSchema,
  UnsupportedCommandResultSchema,
]);
export type AppCommandResult = z.infer<typeof AppCommandResultSchema>;

// ---------------------------------------------------------------------------
// Validator-result wrapper stored in chat_messages.validator_result
// ---------------------------------------------------------------------------
export const APP_COMMAND_STATUS_OK = "ok" as const;
export const APP_COMMAND_STATUS_UNSUPPORTED = "unsupported" as const;
export const APP_COMMAND_STATUS_ERROR = "error" as const;

export const AppCommandValidatorResultSchema = z.object({
  route: z.literal("app_command"),
  status: z.enum([
    APP_COMMAND_STATUS_OK,
    APP_COMMAND_STATUS_UNSUPPORTED,
    APP_COMMAND_STATUS_ERROR,
  ]),
  command: AppCommandNameSchema,
  app_command: AppCommandResultSchema,
});
export type AppCommandValidatorResult = z.infer<
  typeof AppCommandValidatorResultSchema
>;

// ---------------------------------------------------------------------------
// Helper: extract the narrow app_command payload from a raw validator_result
// Returns undefined if the row is not an app-command assistant row.
// ---------------------------------------------------------------------------
export function tryExtractAppCommandPayload(
  validatorResult: unknown,
): AppCommandResult | undefined {
  if (!validatorResult) return undefined;
  const parsed = AppCommandValidatorResultSchema.safeParse(validatorResult);
  if (!parsed.success) return undefined;
  return parsed.data.app_command;
}
