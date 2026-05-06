import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  runCharacterTurn,
  runCharacterTurnStreamTraced,
  type CharacterTurnSseEvent,
} from "../orchestration/runCharacterTurn";

const SendMessageBody = z.object({
  content: z.string().min(1).max(4000),
});

const MessageParams = z.object({ id: z.string() });

function writeSse(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const chatController = {
  async streamMessage(req: FastifyRequest, reply: FastifyReply) {
    const { id: sessionId } = MessageParams.parse(
      (req as FastifyRequest<{ Params: { id: string } }>).params,
    );
    const { content } = SendMessageBody.parse(req.body);

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const ac = new AbortController();
    // Important: do NOT bind abort to req.raw "close".
    // For POST requests, request-stream close can happen immediately after body read,
    // which would abort generation before first streamed tokens.
    let streamFinished = false;
    reply.raw.on("close", () => {
      if (!streamFinished) ac.abort();
    });

    const ping = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, 15_000);

    try {
      const emitEvent = (ev: CharacterTurnSseEvent) => {
        switch (ev.event) {
          case "thought":
            writeSse(reply, "thought", {
              kind: ev.data.kind,
              text: ev.data.text,
              ts: ev.data.ts,
              meta: ev.data.meta,
            });
            break;
          case "delta":
            writeSse(reply, "delta", ev.data);
            break;
          case "tool_call":
            writeSse(reply, "tool_call", ev.data);
            break;
          case "tool_result":
            writeSse(reply, "tool_result", ev.data);
            break;
          case "done":
            writeSse(reply, "done", ev.data);
            break;
          case "error":
            writeSse(reply, "error", ev.data);
            break;
          default:
            break;
        }
      };

      await runCharacterTurnStreamTraced({
        sessionId,
        userMessage: content,
        signal: ac.signal,
        onEvent: emitEvent,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err, sessionId }, "streamMessage failed");
      writeSse(reply, "error", { message });
    } finally {
      streamFinished = true;
      clearInterval(ping);
      reply.raw.end();
    }
  },

  async sendMessage(req: FastifyRequest, reply: FastifyReply) {
    const { id: sessionId } = MessageParams.parse(
      (req as FastifyRequest<{ Params: { id: string } }>).params,
    );
    const { content } = SendMessageBody.parse(req.body);

    try {
      const result = await runCharacterTurn({ sessionId, userMessage: content });
      reply.send({
        message_id: result.assistantMessageId,
        content: result.content,
        turn_index: result.turnIndex,
        was_rewritten: result.wasRewritten,
        was_deflected: result.wasDeflected,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        reply.status(404).send({ error: message });
      } else {
        reply.status(500).send({ error: "Internal error during turn generation" });
        req.log.error({ err, sessionId }, "runCharacterTurn failed");
      }
    }
  },
};
