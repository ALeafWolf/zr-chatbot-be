import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env";
import * as canonSchema from "./schema/canon";
import * as chatSchema from "./schema/chat";
import * as memorySchema from "./schema/memory";
import * as personaSchema from "./schema/persona";

export const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, {
  schema: {
    ...canonSchema,
    ...chatSchema,
    ...memorySchema,
    ...personaSchema,
  },
});

export type DB = typeof db;
