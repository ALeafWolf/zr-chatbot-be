import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export function handleHttpError(
  err: FastifyError | Error,
  req: FastifyRequest,
  reply: FastifyReply,
): void {
  if (reply.sent) return;

  if (err instanceof ZodError) {
    reply.status(400).send({
      error: "Invalid request",
      issues: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  const statusCode =
    "statusCode" in err && typeof err.statusCode === "number"
      ? err.statusCode
      : 500;

  if (statusCode >= 500) {
    req.log.error({ err }, "Unhandled request error");
    reply.status(500).send({ error: "Internal server error" });
    return;
  }

  reply.status(statusCode).send({ error: err.message });
}
