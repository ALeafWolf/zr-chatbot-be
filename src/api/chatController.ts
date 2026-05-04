import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { runCharacterTurn } from "../orchestration/runCharacterTurn";

const SendMessageBody = z.object({
  content: z.string().min(1).max(4000),
});

const MessageParams = z.object({ id: z.string() });

export const chatController = {
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
