export interface SessionChunkSuppressionInput {
  structMemEnabled: boolean;
  suppressExtractorSessionChunks: boolean;
  nativeStructMemExtractor: boolean;
}

export function shouldSuppressExtractorSessionChunks(
  input: SessionChunkSuppressionInput,
): boolean {
  return (
    input.structMemEnabled &&
    (input.suppressExtractorSessionChunks || input.nativeStructMemExtractor)
  );
}
