export function shouldSuppressExtractorSessionChunks(input: {
  structMemEnabled: boolean;
  suppressExtractorSessionChunks: boolean;
  nativeStructMemExtractor: boolean;
}): boolean {
  return (
    input.structMemEnabled &&
    (input.suppressExtractorSessionChunks || input.nativeStructMemExtractor)
  );
}
