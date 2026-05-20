import { db } from "../../db/client";
import { chatMessages } from "../../db/schema/chat";
import { eq } from "drizzle-orm";
import type { ChatSession } from "../../db/schema/chat";
import type { AppCommandValidatorResult } from "./appCommandTypes";
import {
  APP_COMMAND_STATUS_OK,
  APP_COMMAND_STATUS_UNSUPPORTED,
} from "./appCommandTypes";
import type { ExportFormat } from "./appCommandTypes";
import { parseAppCommandIntent } from "./appCommandIntent";
import { buildExportArtifact } from "./exportSessionRawTurns";
import { buildSessionStatus } from "./sessionStatus";

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
      const format = intent.args.format as ExportFormat;

      const rows = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, session.sessionId))
        .orderBy(chatMessages.turnIndex);

      // Default export omits prior app-command rows so transcripts represent the
      // roleplay conversation rather than earlier utility commands (design: include_app_commands defaults false).
      const transcriptMessages = rows.filter(
        (m) => m.route !== "app_command",
      );

      const result = buildExportArtifact(
        transcriptMessages,
        format,
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

    default: {
      return {
        route: "app_command",
        status: APP_COMMAND_STATUS_UNSUPPORTED,
        command: "unknown",
        app_command: {
          kind: "unsupported",
          command: "unknown",
          message:
            "Unrecognized command. Available commands: export_session_raw_turns, show_session_status.",
          available_commands: [
            "export_session_raw_turns",
            "show_session_status",
          ],
        },
      };
    }
  }
}
