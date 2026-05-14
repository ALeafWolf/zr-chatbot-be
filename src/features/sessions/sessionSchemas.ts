import { z } from "zod";
import { env } from "../../config/env";
import { AVAILABLE_SCOPES } from "../../retrieval/scope/resolveContinuityScope";

const MainWorldScopeZodEnum = AVAILABLE_SCOPES as unknown as [
  string,
  ...string[],
];

const DISPLAY_TITLE_MAX_LEN = 120;

const optionalDisplayTitleField = z
  .string()
  .optional()
  .transform((val) => {
    if (val === undefined) return undefined;
    const t = val.trim();
    return t.length === 0 ? null : t;
  })
  .pipe(
    z
      .union([z.undefined(), z.null(), z.string().max(DISPLAY_TITLE_MAX_LEN)])
      .optional(),
  );

const patchDisplayTitleField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((val) => {
    if (val === undefined) return undefined;
    if (val === null) return null;
    const t = val.trim();
    return t.length === 0 ? null : t;
  })
  .pipe(
    z
      .union([z.undefined(), z.null(), z.string().max(DISPLAY_TITLE_MAX_LEN)])
      .optional(),
  );

export const CreateSessionBody = z.object({
  character_id: z.string().default(env.DEFAULT_CHARACTER_ID),
  mode: z.enum(["canonical_live", "pinned_scenario", "sandbox"]),
  continuity_scope: z.enum(MainWorldScopeZodEnum).default("main_married"),
  pinned_time: z.string().optional(),
  pinned_location: z.string().optional(),
  thinking: z.boolean().optional(),
  display_title: optionalDisplayTitleField,
  temperature: z.number().min(0).max(2).optional(),
});

export const SessionIdParams = z.object({ id: z.string() });

export const PatchSessionBody = z
  .object({
    display_title: patchDisplayTitleField,
    thinking: z.boolean().optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .refine(
    (d) =>
      d.display_title !== undefined ||
      d.thinking !== undefined ||
      d.temperature !== undefined,
    {
      message:
        "At least one of display_title, thinking, or temperature is required",
    },
  );

export const GetMessagesQuery = z.object({
  page: z
    .string()
    .default("0")
    .transform(Number)
    .pipe(z.number().int().min(0)),
  page_size: z
    .string()
    .default("50")
    .transform(Number)
    .pipe(z.number().int().min(1).max(200)),
});

export type CreateSessionInput = z.infer<typeof CreateSessionBody>;
export type PatchSessionInput = z.infer<typeof PatchSessionBody>;
export type GetMessagesQueryInput = z.infer<typeof GetMessagesQuery>;
