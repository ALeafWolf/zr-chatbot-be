import type { FastifyReply, FastifyRequest } from "fastify";
import {
  runCharacterTurn,
  runCharacterTurnStreamTraced,
} from "../../orchestration/runCharacterTurn";
import { MessageParams, SendMessageBody } from "./chatSchemas";
import { writeCharacterTurnEvent, writeSse } from "./sse";

type MessageRequest = FastifyRequest<{ Params: { id: string } }>;

export async function streamMessageHandler(
  req: MessageRequest,
  reply: FastifyReply,
) {
  const { id: sessionId } = MessageParams.parse(req.params);
  const { content } = SendMessageBody.parse(req.body);

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const ac = new AbortController();
  let streamFinished = false;
  reply.raw.on("close", () => {
    if (!streamFinished) ac.abort();
  });

  const ping = setInterval(() => {
    reply.raw.write(": ping\n\n");
  }, 15_000);

  try {
    await runCharacterTurnStreamTraced({
      sessionId,
      userMessage: content,
      signal: ac.signal,
      onEvent: (event) => writeCharacterTurnEvent(reply, event),
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
}

export async function sendMessageHandler(
  req: MessageRequest,
  reply: FastifyReply,
) {
  const { id: sessionId } = MessageParams.parse(req.params);
  const { content } = SendMessageBody.parse(req.body);

  try {
    const result = await runCharacterTurn({ sessionId, userMessage: content });
    reply.send({
      message_id: result.assistantMessageId,
      content: result.content,
      turn_index: result.turnIndex,
      was_rewritten: result.wasRewritten,
      was_deflected: result.wasDeflected,
      route: result.route,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      reply.status(404).send({ error: message });
      return;
    }
    reply.status(500).send({ error: "Internal error during turn generation" });
    req.log.error({ err, sessionId }, "runCharacterTurn failed");
  }
}
