export interface StructMemFlagConfig {
  STRUCTMEM_ENABLED: boolean;
  STRUCTMEM_CONSOLIDATION_ENABLED: boolean;
  STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED: boolean;
  STRUCTMEM_CROSS_SESSION_WRITE_ENABLED: boolean;
  STRUCTMEM_PROMOTION_TO_IME_ENABLED: boolean;
}

export function validateStructMemFlagConfig(
  flags: StructMemFlagConfig,
): string[] {
  const warnings: string[] = [];

  if (flags.STRUCTMEM_CONSOLIDATION_ENABLED && !flags.STRUCTMEM_ENABLED) {
    warnings.push(
      "STRUCTMEM_CONSOLIDATION_ENABLED is true while STRUCTMEM_ENABLED is false; consolidation jobs will not run.",
    );
  }

  if (flags.STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED && !flags.STRUCTMEM_ENABLED) {
    warnings.push(
      "STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED is true while STRUCTMEM_ENABLED is false; cross-session StructMem retrieval will be skipped.",
    );
  }

  if (
    flags.STRUCTMEM_CROSS_SESSION_WRITE_ENABLED &&
    !flags.STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED &&
    !flags.STRUCTMEM_PROMOTION_TO_IME_ENABLED
  ) {
    warnings.push(
      "STRUCTMEM_CROSS_SESSION_WRITE_ENABLED is true while retrieval and IME promotion are both disabled; written cross-session memory may be unused.",
    );
  }

  if (
    flags.STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED &&
    !flags.STRUCTMEM_CONSOLIDATION_ENABLED
  ) {
    warnings.push(
      "STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED is true while STRUCTMEM_CONSOLIDATION_ENABLED is false; this only reads existing cross-session rows.",
    );
  }

  return warnings;
}

export function warnStructMemFlagConfig(
  flags: StructMemFlagConfig,
  warn: (message: string) => void = console.warn,
): string[] {
  const warnings = validateStructMemFlagConfig(flags);
  for (const warning of warnings) {
    warn(`[config] ${warning}`);
  }
  return warnings;
}
