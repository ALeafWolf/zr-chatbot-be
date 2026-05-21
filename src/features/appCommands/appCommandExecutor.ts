import { db } from "../../db/client";
import { chatMessages } from "../../db/schema/chat";
import { eq } from "drizzle-orm";
import type { ChatSession } from "../../db/schema/chat";
import type { AppCommandValidatorResult } from "./appCommandTypes";
import {
  ExportOptionsSchema,
  APP_COMMAND_STATUS_OK,
  APP_COMMAND_STATUS_UNSUPPORTED,
  APP_COMMAND_STATUS_ERROR,
} from "./appCommandTypes";
import { parseAppCommandIntent } from "./appCommandIntent";
import { buildExportArtifact } from "./exportSessionRawTurns";
import { buildSessionStatus } from "./sessionStatus";
import { buildExportHelp } from "./exportHelp";

/**
 * Execute an app command for the given user message and session.
 * Queries persisted messages from the database to build the command result.
 */
export async function executeAppCommand(
  userMessage: string,
  session: ChatSession,
): Promise<AppCommandValidatorResult> {
  const intent = parseAppCommandIntent(userMessage);

  switch (intent.command) {
    case "export_session_raw_turns": {
      const parsed = ExportOptionsSchema.safeParse(intent.args);
      if (!parsed.success) {
        return {
          route: "app_command",
          status: APP_COMMAND_STATUS_ERROR,
          command: "export_session_raw_turns",
          app_command: {
            kind: "unsupported",
            command: "unknown",
            message: `Invalid export options: ${parsed.error.message}`,
            available_commands: [
              "export_session_raw_turns",
              "show_session_status",
              "show_export_help",
            ],
          },
        };
      }
      const options = parsed.data;

      const rows = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, session.sessionId))
        .orderBy(chatMessages.turnIndex);

      const result = buildExportArtifact(
        rows,
        options,
        session.sessionId,
        session.displayTitle,
      );

      return {
        route: "app_command",
        status: APP_COMMAND_STATUS_OK,
        command: "export_session_raw_turns",
        app_command: result,
      };
    }

    case "show_session_status": {
      const rows = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, session.sessionId))
        .orderBy(chatMessages.turnIndex);

      const result = buildSessionStatus({
        session,
        messages: rows,
      });

      return {
        route: "app_command",
        status: APP_COMMAND_STATUS_OK,
        command: "show_session_status",
        app_command: result,
      };
    }

    case "show_export_help": {
      const language = intent.args.language as "en" | "zh";
      const result = buildExportHelp(language);

      return {
        route: "app_command",
        status: APP_COMMAND_STATUS_OK,
        command: "show_export_help",
        app_command: result,
      };
    }

    default: {
      return {
        route: "app_command",
        status: APP_COMMAND_STATUS_UNSUPPORTED,
        command: "unknown",
        app_command: {
          kind: "unsupported",
          command: "unknown",
          message:
            "Unrecognized command. Available commands: export_session_raw_turns, show_session_status, show_export_help.",
          available_commands: [
            "export_session_raw_turns",
            "show_session_status",
            "show_export_help",
          ],
        },
      };
    }
  }
}
