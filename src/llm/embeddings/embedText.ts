import OpenAI from "openai";
import { env } from "../../config/env";
import { models } from "../../config/models";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return client;
}

/**
 * Generate a text embedding using the configured embedding model.
 * Dimensions are fixed to EMBEDDING_DIMENSIONS (1536 for text-embedding-3-small)
 * to match the pgvector column on story_units and interactive_memory_events.
 */
export async function embedText(text: string): Promise<number[]> {
  if (models.embedding.provider !== "openai") {
    throw new Error(
      `Embedding provider "${models.embedding.provider}" not supported. Only "openai" is supported in Phase 1.`,
    );
  }

  const response = await getClient().embeddings.create({
    model: models.embedding.model,
    input: text,
    dimensions: env.EMBEDDING_DIMENSIONS,
  });

  return response.data[0].embedding;
}
