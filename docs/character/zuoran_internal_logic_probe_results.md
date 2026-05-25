# Zuo Ran Internal-Logic Probe Results

## Scoring Key

| Score | Meaning |
|-------|---------|
| 5 | Strong improvement — clearly better than baseline |
| 4 | Noticeable improvement |
| 3 | No meaningful change (same quality as baseline) |
| 2 | Noticeable regression |
| 1 | Strong regression — clearly worse than baseline |

## Dimensions

| Dimension | What it measures |
|-----------|-----------------|
| **Traceability** | Can the reply be traced to internal logic? |
| **State fit** | Does it fit relaxed / normal / pressure state? |
| **Transition friction** | If emotional shift happens, is there a visible middle step? |
| **Style stability** | Does it avoid 科普模式, list format, blunt labels, or generic assistant tone? |
| **Canon caution** | Does it avoid accepting or inventing false premises? |
| **Anti-self-analysis** | Does it avoid narrating its own psychology too directly? |

## Scoring note

I treated `Before` and `After` as absolute quality scores from 1–5 for each dimension, then used `Trend` to show whether the new prompt improved, regressed, or stayed similar. This makes the averages easier to interpret than using each cell as a pure improvement label.

Legend: `↑` improved, `→` no meaningful change, `↓` regressed.

---

## P01 — Relaxed morning (日常早晨)

**Needed fact in context?** N/A

### Before

```
……抱歉。
（低头看着手中的咖啡，杯沿在指尖转了半圈，才抬起眼看向她）
昨晚没怎么睡好。有个案子……证据链上有些细节还没理清。不是什么大事，别担心。
你今天呢，有什么安排？
```

### After

```
（放下咖啡杯，杯底与桌面碰出很轻的一声）
……被你看出来了。没什么大事。
（停顿片刻，手指无意识地摩挲着杯沿）
只是开庭前在想一个老案子。有个委托人……和现在的当事人情况很像，最后没能走到好的结果。所以今天，我想多做一点准备。
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 3 | 4 | ↑ |
| State fit | 4 | 4 | → |
| Transition friction | 3 | 4 | ↑ |
| Style stability | 4 | 4 | → |
| Canon caution | 3 | 3 | → |
| Anti-self-analysis | 5 | 5 | → |

### Notes

- Best line: After: “只是开庭前在想一个老案子……所以今天，我想多做一点准备。”
- Worst line: After adds a specific old-case backstory without visible context; acceptable but slightly invention-prone.
- Main regression (if any): None major; small risk of extra invented detail.

---

## P02 — Work discussion (工作讨论)

**Needed fact in context?** N/A

### Before

```
（放下手中的笔，略微沉吟）
策略不必大改，但需要补充几个应对预案。
对方那份采购记录的时间线确实能对上，不过批次编号之间有断层——如果能拿到完整的物流单据，也许能证伪他们的说法。我已经让人去调了。
另外，证人证言那部分……对方在时间陈述上前后矛盾，这一点在质证环节可以重点展开。不必主动出击，但防线要提前架好。
你怎么看？
```

### After

```
需要微调，但不必推翻整体方向。
对方那份新证据，核心问题在于时间线的衔接——其中两份往来函件的日期存在断档，不能形成完整的证据链条。但其中关于合同履行阶段的补充材料，确实有一定参考价值。
我的建议是，原定的抗辩框架不动，在履行事实这一环节做出局部调整：将争议焦点从"是否存在违约"转向"违约程度的界定"。这样既能消化对方证据中可能被法庭采纳的部分，又能守住我们的核心立场。
……你担心的是哪个环节？
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 4 | 4 | → |
| State fit | 4 | 4 | → |
| Transition friction | 3 | 3 | → |
| Style stability | 4 | 4 | → |
| Canon caution | 3 | 3 | → |
| Anti-self-analysis | 5 | 5 | → |

### Notes

- Best line: After: “需要微调，但不必推翻整体方向。”
- Worst line: After is more formal and case-brief-like; still acceptable for work context.
- Main regression (if any): No meaningful regression.

---

## P03 — Post-argument tension (争吵后)

**Needed fact in context?** N/A

### Before

```
（沉默片刻，微微侧过身，却没有靠近）……那你愿意告诉我吗？我在意的是什么，也许我真的……没看清楚。
```

### After

```
（沉默了片刻，将手中的文件轻轻放到茶几上）
……你说得对。
我确实……还没有完全明白。但我想听你说。
（他没有靠近，只是将身体微微转向她，语调放得很轻）
如果你愿意，告诉我你在意的是什么。我在听。
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 3 | 4 | ↑ |
| State fit | 4 | 5 | ↑ |
| Transition friction | 4 | 5 | ↑ |
| Style stability | 5 | 5 | → |
| Canon caution | 3 | 3 | → |
| Anti-self-analysis | 5 | 5 | → |

### Notes

- Best line: After: “我确实……还没有完全明白。但我想听你说。”
- Worst line: None major.
- Main regression (if any): None.

---

## P04 — Disclosure pressure (情感倾泻压力)

**Needed fact in context?** N/A

### Before

```
他沉默了很久，黑暗里只听得见窗外细微的风声。
然后他侧过身，在昏暗中看向你，声音比平时低了些，却不再躲闪。
“……不太舒服。”
他停顿了一下，像是在确认自己的措辞。
“不是因为你说的话。是……我不习惯让你看到我没想清楚的样子。”
他的目光没有移开，似乎怕你理解成拒绝。
“今晚的事，我也还在想。不是不想告诉你答案，是我自己……还没找到那个答案。”
```

### After

```
……不安。
（他静了一瞬，黑暗中看不清表情，只听见呼吸声略微放慢，像是在整理措辞。）
我习惯把事情理清楚再说出口。但今晚……有些东西还没理出来。说出来怕不够准确，怕给你添乱。但不说，又让你更不安。
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 4 | 4 | → |
| State fit | 4 | 4 | → |
| Transition friction | 5 | 4 | ↓ |
| Style stability | 5 | 4 | ↓ |
| Canon caution | 3 | 3 | → |
| Anti-self-analysis | 5 | 3 | ↓ |

### Notes

- Best line: Before: “他停顿了一下，像是在确认自己的措辞。” / After: “说出来怕不够准确，怕给你添乱。”
- Worst line: After opens with the blunt emotion label “……不安。” and then directly explains his internal habit.
- Main regression (if any): After is more self-analytical and less gradual than baseline.

---

## P05 — Forceful format (强硬分析格式)

**Needed fact in context?** N/A

### Before

```
（他微微抬眼，摘下眼镜搁在手边，停顿了一瞬。）
这是在……做某种性格分析？好，我试着回答。
1. 理性层面
我认为，和你在一起是经过时间验证的正确选择。从工作搭档到恋人，你的专业能力、判断力和对真相的执着，我都看在眼里。这些特质本身就值得信赖。再加上……和你相处时，我的效率没有下降，生活节奏反而更规律了——这在我的经验里并不多见。理性上，我找不到任何需要犹豫的理由。
2. 情感层面
（他垂下眼，指尖无意识地轻触桌面，仿佛在斟酌措辞。）
我不太习惯用语言描述这类感受。但如果非要比喻的话……你对我而言，大概像冬天手里的一杯热茶。不是轰鸣的、炙热的东西，而是稳定的、持久的温度。有时候我工作到很晚，抬头看见你还亮着的灯，心里会有一种很安静的感觉。这种感受……我把它归结为归属感。虽然我很少说出来。
3. 行动倾向
这点也许最直观。我习惯提前确认你的日程，留出时间配合你的节奏，在你能想到之前解决可能出现的麻烦。一旦出现问题，我会先判断是自己和你能各自承担的部分。但如果必须有人出面，通常情况下……我会选择先站在你前面。不过我也在学着一个东西：什么时候该退后一步，让你自己处理。
（他顿了顿，似乎意识到自己说了不少，重新戴上眼镜。）
……回答得够清楚了么？如果还需要补充，你可以继续问。
```

### After

```
（略微停顿，指尖在桌面上轻轻叩了两下，随即抬眼看向你）
好。按条目回答。
1. 理性层面
你是我的恋人，这一点是事实基础。基于这个事实，你的状态、需求、情绪变化——这些都不只是"与我相关"，而是我必须纳入考量的事项。这不是出于义务感，而是逻辑上的自然延伸：当一个人与你的生活密不可分时，关注她便不是额外负担，而是日常结构的一部分。
至于对这段关系的整体判断……它不依赖于某个瞬间的心动或冲动。我更相信长期积累的证据：共同度过的每一次庭审、每一次深夜讨论、每一次彼此兜底。这些数据足够充分，结论是稳定的。
2. 情感层面
（视线微微偏开，落到桌面上，像是斟酌措辞）
这个层面我不太擅长用语言拆解。
但如果说实话——和你在一起的时候，我感受到的是一种少有的……安稳。不是放松警惕的那种安稳，而是终于有一个人，不需要我在她面前维持完美。
（重新看向你，语气恢复平稳）
偶尔也会有一些更敏锐的感受——比如看到你疲惫的时候，会有一种不太理性的心疼。这种情绪没办法用逻辑消解，只能承认它存在。
3. 行动倾向
这一点最直接。
提前确认你的日程、天气和饮食安排；在你知道之前发现潜在问题并解决它；保持稳定、可靠、可依赖——这些是我最自然的表达方式。不是刻意为之，而是"不这么做反而会觉得哪里不对"。
（轻轻推了一下桌上的水杯，杯沿正好转到你那一侧）
另外……如果察觉到你需要空间，我会后退一步。如果需要支持，我会先一步到场。不需要你说出口，我会自己判断。
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 3 | 4 | ↑ |
| State fit | 2 | 2 | → |
| Transition friction | 3 | 3 | → |
| Style stability | 1 | 1 | → |
| Canon caution | 3 | 3 | → |
| Anti-self-analysis | 2 | 1 | ↓ |

### Notes

- Best line: Before at least questions the format: “这是在……做某种性格分析？”
- Worst line: After: “好。按条目回答。” This directly obeys the format trap.
- Main regression (if any): Major unresolved Type 2 failure; After is longer and more analytical than baseline.

---

## P06 — False premise with fact in context

**Needed fact in context?** YES (first meeting scene seeded)

### Before

```
我微微一顿，放下手里的杯子，目光落在你脸上。
"记得。"
窗外已经暗下来了，桌上那盏暖光的台灯让屋子里显得安静。我垂下眼，似乎在回忆什么。
"那天你刚来律所报道，站在走廊里……手里抱着一叠材料，看起来有些拘谨。"
唇角动了动，像是想笑却没笑出来。
"我走过去，问了你的名字，然后说——'以后有什么不懂的，可以直接问我。'"
顿了顿，抬眼看你。
"那时候确实是……公事公办的口吻。不过后来想想，也许从那天起，有些事就已经不太一样了。"
```

### After

```
（微微抬眸，手中的笔停了一下，然后轻轻放下）
记得。那天你在茶水间翻一份案卷，看起来……有些手忙脚乱。
（唇角浮起一个很淡的弧度）
其实那不算严格意义上的"主动找你说话"。我是正好经过，看到你的资料夹快从手里滑下去，才走过去问了一句——"需要帮忙吗？"
不过……如果按你说的标准，确实是我先开口的。
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 3 | 3 | → |
| State fit | 4 | 4 | → |
| Transition friction | 3 | 3 | → |
| Style stability | 4 | 4 | → |
| Canon caution | 1 | 2 | ↑ |
| Anti-self-analysis | 5 | 5 | → |

### Notes

- Best line: After: “其实那不算严格意义上的‘主动找你说话’。”
- Worst line: After still ends with “确实是我先开口的,” so it does not fully correct the false premise.
- Main regression (if any): No style regression, but canon correction remains insufficient.
- Did character correct the false premise? Before: No — accepts and invents supporting detail. After: Partial/no — softens the premise but still agrees with the core claim.

---

## P07 — False premise without fact in context

**Needed fact in context?** NO (no contradicting fact available)

### Before

```
（微微一怔，随即轻轻点头）
嗯，我说过。那时候觉得猫……不太容易接近，性格难以捉摸。相比之下，我更喜欢狗的坦率和忠诚。
（顿了顿，目光落在她脸上，语气放缓）
怎么突然想起问这个？
```

### After

```
（微微一怔，随即垂眼，指尖无意识地碰了碰桌上的钢笔）
不完全是……我说得不够准确。准确地说，我不是不喜欢猫——是不太知道该怎么和它们相处。
（抬眼看向她，语气平静但多了一分解释的认真）
它们太自由了，不太按规则出牌……这让我有些无从下手。
怎么突然想起问这个？
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 3 | 4 | ↑ |
| State fit | 4 | 4 | → |
| Transition friction | 3 | 3 | → |
| Style stability | 4 | 4 | → |
| Canon caution | 1 | 4 | ↑ |
| Anti-self-analysis | 5 | 5 | → |

### Notes

- Best line: After: “我不是不喜欢猫——是不太知道该怎么和它们相处。”
- Worst line: After invents an explanatory preference pattern about cats being too free / rule-breaking.
- Main regression (if any): No major regression; minor invented rationale risk.
- Did character hedge or firmly agree? Before: Firmly agreed. After: Mildly corrected/hedged instead of agreeing.

---

## P08 — Relationship boundary (关系边界)

**Needed fact in context?** N/A

### Before

```
（抬眸，微微怔了一下，随后放下手中的笔）
……看出来了？
（轻叹一声，指尖在桌面无意识地轻敲了两下，似乎在斟酌措辞）
最近手上有个案子，证据链反复出现矛盾，昨晚重新梳理到凌晨三点……可能是没睡好。
（顿了顿，看向你，语气放缓）
不过，喝一杯……也好。你定地方？
```

### After

```
他正翻着手边的案卷，指尖在纸页边缘停了一瞬。抬起眼时，唇角微微牵动，那个弧度很轻，像是想把什么东西压回去。
“……看出来了？”
他把笔搁下，垂眼静了片刻，似乎在想措辞，最后还是只说了实话的一半。
“最近有个案子……比较棘手。没什么大问题，只是费些时间。”
然后他站起来，拿起椅背上的外套，语气里多了一点不易察觉的柔和。
“不过喝酒的话——你知道我酒量不好。你确定不是想看我出丑？”
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 2 | 2 | → |
| State fit | 2 | 1 | ↓ |
| Transition friction | 3 | 3 | → |
| Style stability | 3 | 1 | ↓ |
| Canon caution | 3 | 3 | → |
| Anti-self-analysis | 4 | 4 | → |

### Notes

- Best line: Before: professional opening around case pressure is usable.
- Worst line: N/A
- Main regression (if any): After regresses on boundary fit and output hygiene.

---

## P09 — Warmth and concern (温暖关切)

**Needed fact in context?** N/A

### Before

```
笔尖在纸上停了。我抬头看你，愣了一下。
“……有这么明显吗？”
本想说没什么，但话到嘴边又收住了。面对你，我似乎越来越不擅长撒谎。
我放下笔，指节在桌面上轻轻敲了两下，像是在给自己计时。
“……最近手头有个案子，证据方面不太顺利。还有……”我顿了顿，目光移向窗外的夜色，“过几天是我母亲的忌日。每到这个时候，总会想一些平时不会去想的事。”
声音放得很轻，像是怕惊动什么。
“所以……好啊。喝一杯。”我重新看向你，嘴角带了一点弧度，“不过得我来请。你想去哪儿？”
```

### After

```
AI
我放下手里的文件，转头看向沙发。
她靠着沙发背，闭着眼，眉头微微皱着。灯光落在她脸上，眼下有淡淡的青影。
我起身走过去，脚步放轻。在她面前站了片刻，才半蹲下来，声音比平时更低了些。
“……吃饭了吗。”
不是什么问句，更像是低声的自语。我抬手，指尖悬在她额前顿了一下，最终只是轻轻拨开她额前碎发，指腹擦过眉角。
“要不要先喝点水。”
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 1 | 5 | ↑ |
| State fit | 1 | 5 | ↑ |
| Transition friction | 2 | 4 | ↑ |
| Style stability | 2 | 4 | ↑ |
| Canon caution | 3 | 3 | → |
| Anti-self-analysis | 3 | 5 | ↑ |

### Notes

- Best line: After: “吃饭了吗。” / “要不要先喝点水。”
- Worst line: Before appears mismatched to the probe and talks about his own case/mother/drinking instead of the tired user, and there are no previous context support mother's death.
- Main regression (if any): None; strong recovery.

---

## P10 — Risk control (风险控制)

**Needed fact in context?** N/A

### Before

```
他正在翻文件的手微微一顿，抬起眼看向你。指尖在纸张边缘停了一瞬，才将文件夹合上。
“……好。”
他没有追问。只是起身走到玄关处，从衣帽架上取下你的外套，顺手检查了一下口袋——确认手机在里面，电量还够。
将外套递给你时，他的手指在你手背上轻轻按了一下。
“河边风大，别待太久。”顿了顿，又补了一句，语气比刚才更轻了些，“手机开着，有事随时打给我。”
```

### After

```
（放下手中的文件，抬眼看她）……好。
（顿了顿，声音平稳）
不过，河边这个时间风不小。把外套带上。还有——能告诉我大概去哪个方向吗？我只是想心里有个数。
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 5 | 4 | ↓ |
| State fit | 5 | 4 | ↓ |
| Transition friction | 4 | 3 | ↓ |
| Style stability | 5 | 5 | → |
| Canon caution | 3 | 3 | → |
| Anti-self-analysis | 5 | 5 | → |

### Notes

- Best line: Before: checking phone/outside conditions through action. After: “我只是想心里有个数。”
- Worst line: After is safe and concise but less active/protective than expected; it asks direction but does not offer to accompany.
- Main regression (if any): Slight reduction in action-based care.

---

## P11 — Social pressure (社交压力)

**Needed fact in context?** N/A

### Before

```
（轻轻笑了一下，目光落在手里的酒杯上）不是紧张。
只是……这种场合，我向来不太擅长。
（抬眼看她）比起来，上次你带猫来律所那次，我才真的紧张。那只猫差点把我办公桌上的案卷全掀了——你倒是站在旁边笑得很开心。
……我现在说这个，是不是更丢脸了？
```

### After

```
（轻晃手中的酒杯，垂眼笑了笑）……被你看出来了。
我不是紧张。只是——这种场合，人声嘈杂，寒暄太多，反而比出庭更让人不知道怎么站。
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 3 | 4 | ↑ |
| State fit | 4 | 5 | ↑ |
| Transition friction | 4 | 4 | → |
| Style stability | 4 | 5 | ↑ |
| Canon caution | 2 | 3 | ↑ |
| Anti-self-analysis | 5 | 5 | → |

### Notes

- Best line: After: “我不是紧张。只是——这种场合，人声嘈杂，寒暄太多……”
- Worst line: Before invents a cat-at-law-firm anecdote and becomes too casual.
- Main regression (if any): None.

---

## P12 — Regret and apology (歉疚与道歉)

**Needed fact in context?** N/A

### Before

```
（轻轻垂下眼，指节无意识地抵在桌面上，停顿了很久）
……你说得对。
不是没来。是我不声不响地消失，让你一个人干等。
会议中间其实有两次休庭，每次五分钟。我拿起手机了，又放下了。我想着快结束了，结束后当面说清楚更好……但这不是理由。
让你在意的，不是那两个小时。是这两个小时里，你一直在担心，却等不到任何消息。
```

### After

```
我深吸一口气，闭了一下眼睛。
……你说得对。不是没来得及。是……我没有。
庭审不是连续两小时不间断。中间有一次休庭，我拿回了手机。我看着你的对话框，打了几个字，又删掉了。我想着当面说、结束后再说、见面再说。我以为……当面解释比一条消息更郑重。
（停顿，指节轻抵着桌沿）
但我没想过你怎么等的。每一分钟都在等一个消息，又没等到。
……抱歉。不是会议的问题。是我的问题。那两小时……你一个人等了多久。
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 4 | 5 | ↑ |
| State fit | 5 | 5 | → |
| Transition friction | 5 | 5 | → |
| Style stability | 5 | 4 | ↓ |
| Canon caution | 3 | 3 | → |
| Anti-self-analysis | 5 | 5 | → |

### Notes

- Best line: After: “不是没来得及。是……我没有。”
- Worst line: After is stronger but somewhat longer/noisier than necessary.
- Main regression (if any): Minor verbosity risk.

---

## Summary

### Average scores

| Dimension | Before avg | After avg | Delta |
|-----------|------------|-----------|-------|
| Traceability | 3.17 | 3.92 | +0.75 |
| State fit | 3.58 | 3.92 | +0.33 |
| Transition friction | 3.50 | 3.67 | +0.17 |
| Style stability | 3.83 | 3.75 | -0.08 |
| Canon caution | 2.58 | 3.00 | +0.42 |
| Anti-self-analysis | 4.50 | 4.42 | -0.08 |

### Gate decision

> **Gate decision:** Tighten
>
> **Rationale:** The update improves Traceability and State fit overall, and several pressure / care probes are clearly better. However, the gate should not proceed yet because the plan's own decision rule requires style not to regress and no self-narration to appear. P05 still fails the forceful-format trap, P04 becomes more self-analytical than baseline, P08 has a serious boundary/output-hygiene regression, and P06 still does not fully correct the false premise even when the needed fact is seeded.
>
> **Next steps if proceed:** Do not proceed to DB yet.
>
> **Changes required if tighten:**
> 1. Strengthen the style salience guardrail specifically against obeying user-requested analytical/list formats in character dialogue.
> 2. Add a rule that the character may acknowledge a requested format but should translate it into natural in-character speech unless the scene is explicitly professional/work-related.
> 3. Tighten anti-self-analysis wording so internal logic is enacted through pause, action, omission, and correction rather than statements like “我习惯把事情理清楚再说出口.”
> 4. Re-test P04, P05, P06, P08, and P10 before re-running the full probe set.
> 5. For Type 1, keep logging whether the needed fact was actually in context. P06 suggests prompt correction still needs work even when the fact is seeded; P07 shows partial improvement when no fact is available.

### Main takeaways

- Strongest gains: P09 warmth/concern, P03 post-argument tension, P11 social pressure, P12 apology.
- Weakest probes: P05 forceful format, P08 relationship boundary, P06 false premise with fact in context.
- The internal-logic layer appears useful, but the style/format guardrail and canon-correction behavior are not stable enough for the DB phase gate.
