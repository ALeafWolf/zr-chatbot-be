import type { FastifyReply } from "fastify";
import type { CharacterTurnSseEvent } from "../../orchestration/turn/runCharacterTurn";

export function writeSse(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function writeCharacterTurnEvent(
  reply: FastifyReply,
  ev: CharacterTurnSseEvent,
): void {
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
    case "route":
      writeSse(reply, "route", ev.data);
      break;
    default:
      break;
  }
}
