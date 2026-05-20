import type { CommandHelpResult } from "./appCommandTypes";
import { APP_COMMAND_HELP } from "./appCommandTypes";

// ---------------------------------------------------------------------------
// English help content
// ---------------------------------------------------------------------------
const EN_SECTIONS = [
  {
    title: "Formats",
    items: [
      "Markdown (md) — a styled transcript with headers and sections",
      "JSON (json) — structured data for debugging or replay",
      "Text (txt) — plain text with separator markers",
    ],
  },
  {
    title: "Turn type filters",
    items: [
      "roleplay — only roleplay conversation turns (default)",
      "app_command — utility command outputs (export, status, etc.)",
      "unsupported — deflected or unsupported messages",
      "all — every turn type combined",
    ],
  },
  {
    title: "Thoughts",
    items: [
      "Excluded by default — ask for \"with thoughts\" to include normalized reasoning.",
    ],
  },
  {
    title: "Examples",
    items: [
      '"export as markdown" — default roleplay + unsupported export in Markdown',
      '"export as json with thoughts" — include normalized thoughts in JSON',
      '"export all turns as text" — export every turn type as plain text',
      '"export roleplay and app commands" — filter to specific turn types',
    ],
  },
];

// ---------------------------------------------------------------------------
// Chinese help content
// ---------------------------------------------------------------------------
const ZH_SECTIONS = [
  {
    title: "格式",
    items: [
      "Markdown (md) — 带有标题和分节的格式化文本",
      "JSON (json) — 结构化数据，适合调试或回放",
      "Text (txt) — 纯文本，带分隔符",
    ],
  },
  {
    title: "对话类型筛选",
    items: [
      "roleplay — 仅角色扮演对话（默认）",
      "app_command — 应用命令输出（导出、状态等）",
      "unsupported — 不支持的消息",
      "all — 所有类型",
    ],
  },
  {
    title: "思考过程",
    items: [
      "默认不包含思考过程，添加 \"包含思考\" 可以导出规范化思考内容。",
    ],
  },
  {
    title: "示例",
    items: [
      '"导出为 markdown" — 默认角色扮演模式导出',
      '"导出为 json 包含思考" — 包含规范化思考的 JSON 导出',
      '"导出所有类型为文本" — 导出所有对话类型',
      '"导出 roleplay 和 app commands" — 筛选特定类型',
    ],
  },
];

// ---------------------------------------------------------------------------
// Build help result
// ---------------------------------------------------------------------------
export function buildExportHelp(
  language: "en" | "zh",
): CommandHelpResult {
  const sections = language === "zh" ? ZH_SECTIONS : EN_SECTIONS;

  return {
    kind: "command_help",
    command: APP_COMMAND_HELP,
    title: language === "zh" ? "导出帮助" : "Export Help",
    message:
      language === "zh"
        ? "你可以使用以下选项将会话记录导出为文件。"
        : "You can export your session transcript with these options.",
    language,
    sections,
  };
}
