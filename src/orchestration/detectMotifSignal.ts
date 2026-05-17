import type { MotifSignal } from "./motifTypes";
import type { QueryRewriteResult } from "../retrieval/query/rewriteQuery";

const BODY_OR_OBJECT = [
  "手腕内侧", "手腕", "手背", "手心", "手掌", "手指", "指尖", "指节",
  "肩", "肩膀", "锁骨",
  "唇", "嘴唇", "嘴角",
  "颈后", "颈", "脖子", "脖颈",
  "头发", "发丝", "发梢",
  "耳垂", "耳", "耳朵",
  "额", "额头",
  "腰", "腰部", "腰侧",
  "腕", "踝",
  "胸", "胸部", "胸肌", "乳头", "乳晕", "乳沟",
  "阴茎", "阴囊", "阴囊袋", "龟头", "系带",
  "会阴", "肛门", "肛周", "前列腺", "结肠",
  "衣领", "领带", "领口",
  "戒指", "袖口", "杯子", "钥匙", "便签",
];

const MOTIF_ACTION = [
  "咬", "轻咬", "咬了一口",
  "吻", "亲吻", "亲", "亲了",
  "握住", "握紧", "握",
  "抓住", "抓",
  "牵", "牵着", "牵住",
  "抚摸", "轻抚", "抚",
  "触碰", "轻触", "碰",
  "摩挲",
  "抱", "抱住",
  "贴", "贴着", "贴紧",
  "抵住", "抵",
  "按", "按压",
  "揉", "揉捏", "轻捏", "捏",
  "舔", "添",
  "系好", "推回去",
  "递给", "贴近", "安抚",
];

const PRIVATE_TERMS = [
  "轻轻", "轻", "温柔", "温柔地",
  "慢慢", "缓缓",
  "悄悄", "偷偷",
  "不疾不徐", "轻柔",
  "深吸", "气息",
];

const MOTIF_NEGATION = [
  "不", "没有", "没", "别", "不要",
];

const MOTIF_EXPLICIT_MARKERS = [
  "回应", "作为回应", "回应了",
  "亲密", "亲昵",
  "羞", "害羞", "羞涩", "红", "脸红",
  "心跳", "耳语", "低声",
  "故意", "有意",
  "挑逗", "调情",
  "又", "再", "还是", "像之前", "上次", "那次",
  "那个", "依旧", "照旧",
];

function matchesAny(text: string, terms: string[]): boolean {
  return terms.some((t) => text.includes(t));
}

function collectMatches(text: string, terms: string[]): string[] {
  return terms.filter((t) => text.includes(t));
}

function extractUserAction(queryRewrite: QueryRewriteResult): string | undefined {
  const seg = queryRewrite.segments.find((s) => s.lane === "user_action");
  const text = seg?.text?.trim();
  return text || undefined;
}

export function detectMotifSignal(input: {
  queryRewrite: QueryRewriteResult;
  rawUserMessage: string;
}): MotifSignal {
  const { queryRewrite, rawUserMessage } = input;
  const userAction = extractUserAction(queryRewrite);
  const text = (userAction || rawUserMessage).toLowerCase();

  const hasNegation = matchesAny(text, MOTIF_NEGATION);
  const bodyOrObjectTerms = collectMatches(text, BODY_OR_OBJECT);
  const actionTerms = collectMatches(text, MOTIF_ACTION);
  const privateTerms = collectMatches(text, PRIVATE_TERMS);
  const motifMarkers = collectMatches(text, MOTIF_EXPLICIT_MARKERS);

  const totalPossible =
    bodyOrObjectTerms.length + actionTerms.length +
    privateTerms.length + motifMarkers.length;
  const confidence = totalPossible > 0
    ? Math.min(
        1,
        (bodyOrObjectTerms.length + actionTerms.length) /
          Math.max(4, totalPossible) +
          motifMarkers.length * 0.15,
      )
    : 0;

  return {
    hasNegation,
    bodyOrObjectTerms,
    actionTerms,
    privateTerms,
    motifMarkers,
    confidence,
    userAction,
    rawUserMessage,
  };
}

export function shouldProbeStructMemMotif(signal: MotifSignal): boolean {
  if (signal.hasNegation) return false;
  const hasBodyOrObject = signal.bodyOrObjectTerms.length > 0;
  const hasAction = signal.actionTerms.length > 0;
  const hasPrivateTerm = signal.privateTerms.length > 0;
  const hasExplicitMarker = signal.motifMarkers.length > 0;

  if (hasBodyOrObject && hasAction && signal.confidence >= 0.7) return true;
  if ((hasPrivateTerm || hasExplicitMarker) && signal.confidence >= 0.6) return true;
  return false;
}

export function buildMotifQueries(signal: MotifSignal): string[] {
  const bodyTerms = signal.bodyOrObjectTerms.slice(0, 3);
  const actionTerms = signal.actionTerms.slice(0, 3);
  const queries: string[] = [];

  for (const body of bodyTerms) {
    for (const action of actionTerms) {
      queries.push(`${body} ${action}`);
      if (queries.length >= 4) break;
    }
    if (queries.length >= 4) break;
  }

  if (queries.length === 0 && signal.userAction) {
    queries.push(signal.userAction.slice(0, 200));
  }

  return queries;
}
