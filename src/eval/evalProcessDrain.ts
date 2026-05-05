import type { Client } from "langsmith";

/**
 * Flush LangSmith trace queue and yield briefly so Windows libuv can finish
 * closing HTTP handles before the process exits.
 */
export async function flushLangSmithClient(client: Client): Promise<void> {
  await client.flush();
  await new Promise((resolve) => setTimeout(resolve, 150));
}
