/** Compact sensory-detail writing guidance for intimate scenes. */
export const INTIMATE_SENSORY_GUIDANCE_BLOCK = `【感官沉浸要求】用五感让读者"感受到"，而非只写动作：
· 触觉(最重要)：温度/质地/压力/摩擦(例：滚烫粗硬缓缓撑开湿热紧致的内壁,又胀又麻)
· 视觉：身体反应/液体/汗水/光影/表情
· 听觉：喘息/呻吟/水声/肉体撞击声
· 嗅味觉：汗水/体液/荷尔蒙的气味
避免笼统("他插了进去")→换成具体感官细节；保持角色口吻，勿堆砌临床/解剖术语。`;

export function buildIntimateSensoryGuidanceBlock(): string {
  return INTIMATE_SENSORY_GUIDANCE_BLOCK;
}

