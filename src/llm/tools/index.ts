import { env } from "../../config/env";
import { defaultTools, registerTool } from "./toolRegistry";
import {
  lookupStructMemTool,
  lookupStructMemConsolidationTool,
  lookupOlderSessionTool,
  lookupInteractiveMemoryTool,
} from "./memoryLookupTools";

defaultTools();

// Hybrid lazy lookup tools — registered when the feature flag is enabled.
if (env.GENERATION_LOOKUP_TOOLS_ENABLED) {
  registerTool(lookupStructMemTool);
  registerTool(lookupStructMemConsolidationTool);
  registerTool(lookupOlderSessionTool);
  registerTool(lookupInteractiveMemoryTool);
}

export {
  registerTool,
  getOpenAISchemas,
  dispatchTool,
} from "./toolRegistry";
export type { ToolCtx, ToolDef } from "./types";
export { webSearchTool } from "./webSearchTool";
export { canonLookupTool } from "./canonLookupTool";
export {
  lookupStructMemTool,
  lookupStructMemConsolidationTool,
  lookupOlderSessionTool,
  lookupInteractiveMemoryTool,
} from "./memoryLookupTools";
