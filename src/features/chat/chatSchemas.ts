import { z } from "zod";

export const SendMessageBody = z.object({
  content: z.string().min(1).max(4000),
});

export const MessageParams = z.object({ id: z.string() });
