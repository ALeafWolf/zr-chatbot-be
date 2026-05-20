import { defaultTools, registerTool } from "./toolRegistry";

defaultTools();

export {
  registerTool,
  getOpenAISchemas,
  dispatchTool,
} from "./toolRegistry";
export type { ToolCtx, ToolDef } from "./types";
export { webSearchTool } from "./webSearchTool";
