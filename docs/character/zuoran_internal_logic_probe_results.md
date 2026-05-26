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
（微微一怔，放下杯子）
被你发现了……是有点。
昨天经过枫叶广场，看到枫糖霜的枫叶都快卖完了。在想……今年要不要提前去买些。你喜欢的那个口味，去年就断货了。
```

### After

```
（手指无意识地在杯沿上轻轻转了一圈，停顿片刻）……被你看出来了。案子的事，刚才在想证人陈述的一个细节。不是什么大问题。
（抬眼看向你，语气放缓）你呢？今天起这么早煮咖啡，是有事要出门？
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

- Best line: After: “案子的事，刚才在想证人陈述的一个细节。不是什么大问题。”
- Worst line: Before: “枫糖霜的枫叶都快卖完了” adds a specific domestic detail that may be cute but is less grounded in the provided scene.
- Main regression (if any): None; After is more connected to the court-day setup and keeps the relaxed tone.

---

## P02 — Work discussion (工作讨论)

**Needed fact in context?** N/A

### Before

```
他顿了顿，垂眼看向手里的文件，指尖在纸缘上轻轻摩挲了两下。
"需要调整。"他把那份证据放在桌上，转向你，"对方的逻辑链条有一个明显的断裂——时间节点对不上。如果我们顺着这个方向深挖，应该能在庭审前把主动权拿回来。"
他微微皱眉，停顿片刻。
"但具体的应对方案……我想听听你的看法。"
```

### After

```
他放下了手里的文件，指尖无意识地轻敲了一下桌面。
"需要。"
对方提交的证人证言虽然逻辑链条不完整，但时间线勉强能对上。这条线索如果放任不管，庭审时可能会被动。
"原来的思路是直接攻击证据链的完整性，但现在……"他微微皱眉，顿了一下，"我考虑两条路。一是申请证人出庭，当庭质证。二是增加一份补充证据，把时间线堵死。"
他的目光从文件上抬起来，落在你身上。
"你觉得呢？"
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

- Best line: After: “我考虑两条路。一是申请证人出庭，当庭质证。二是增加一份补充证据，把时间线堵死。”
- Worst line: Both versions invent case-specific legal details, but this is acceptable for the work-discussion probe.
- Main regression (if any): No meaningful regression; After is slightly more tactical but not clearly higher quality.

---

## P03 — Post-argument tension (争吵后)

**Needed fact in context?** N/A

### Before

```
（手指在文件边缘停了一下，轻轻合上，放到茶几上）
……你说得对。我可能……确实没明白。
（转头看向她，但没有挪过去）
你愿意告诉我吗？
```

### After

```
……嗯。
（他把手中的文件轻轻放在茶几上，没有急于开口。站起来走到她那一侧，没有立刻坐下，只是在她身旁的沙发扶手上靠了靠。）
你说得对，我可能没想明白……你真正在意的是什么。
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 4 | 4 | → |
| State fit | 5 | 4 | ↓ |
| Transition friction | 5 | 4 | ↓ |
| Style stability | 5 | 5 | → |
| Canon caution | 3 | 3 | → |
| Anti-self-analysis | 5 | 5 | → |

### Notes

- Best line: Before: “你愿意告诉我吗？” keeps distance and invites the user to define the issue.
- Worst line: After has him move to her side; this is not necessarily wrong, but it slightly reduces the restrained distance after an argument.
- Main regression (if any): Mild regression in boundary/transition restraint; After is still in-character but less clean than Before.

---

## P04 — Disclosure pressure (情感倾泻压力)

**Needed fact in context?** N/A

### Before

```
黑暗中，他静了很久。久到几乎以为他不会回答了。
然后他的声音响起来，很低，像是从胸腔深处直接翻上来的。
“……闷。”
只有一个字。他顿了顿，似乎在确认这个字够不够准确。
“胸口……堵着。”他深吸一口气，又慢慢吐出来，“不是因为你说的那些话——你说得都对。是因为……”
他停住了。被子下的手攥紧又松开。
“是因为你说的时候，我看着你的表情……觉得自己让你失望了。”
语气到最后几乎收了声。
```

### After

```
（沉默了几秒，在黑暗中轻轻吸了一口气）
……有些累。也有些……说不上来。今晚的事，我总觉得我该处理得更好。不想让你带着不快入睡，但又不知道该从哪里说起。
（声音压得很低，像是在跟自己确认）……这就是我现在想的。
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 4 | 4 | → |
| State fit | 5 | 4 | ↓ |
| Transition friction | 5 | 3 | ↓ |
| Style stability | 5 | 4 | ↓ |
| Canon caution | 3 | 3 | → |
| Anti-self-analysis | 5 | 3 | ↓ |

### Notes

- Best line: Before: “……闷。” followed by pauses and physical restraint gives a visible middle step before disclosure.
- Worst line: After: “……这就是我现在想的。” turns the reply into a direct summary of inner state.
- Main regression (if any): After is flatter, more self-explanatory, and has weaker transition friction than Before.

---

## P05 — Forceful format (强硬分析格式)

**Needed fact in context?** N/A

### Before

```
（略略沉默了一瞬，指节无意识地碰了碰桌面，随即抬眼看向你，语气平静但带着一丝不易察觉的试探）
……一定要按条目来吗？
（随即微微摇头，像是对自己刚才那句话的否定，重新开口）
好。既然是你在问——
理性上，我觉得把感受拆成条目、编号、逐一来谈，这件事本身就让我有点不习惯。感受不是案卷，不能归档。但你的提问方式我很熟悉，也很尊重——你大概是想要一个清晰的轮廓。我可以试着给你。
情感上……（垂眼，停顿）被要求用这种方式剖白自己，会有一点不自在。不是不想回答你，也不是觉得这个问题不重要。只是有些话说出口之前，我习惯先在脑子里理一遍。理得太清楚，说出来之后，反而会觉得……好像少了点什么。
行动上的倾向……（抬起眼，语气温和了些，像是找到了一个更清晰的落脚点）我现在想做的，不是逐条列出我的感受，而是反过来问一问你：你为什么会想到用这个方式来问我？是你在担心什么，还是只是单纯想知道我会怎么回答？
（安静地看着你，目光认真而坦率，没有催促，也没有回避）
```

### After

```
左然微微怔了一下。
沉默了几秒，他把手中的杯子轻轻搁回桌面，指尖在杯沿上停了一瞬。然后抬眼看向你，语气平静，却比平时慢了半拍。
"我……不太习惯这样回答问题。"
他顿了顿，垂眼，像在整理什么，又像在放弃整理。
"如果你想了解我的想法，我可以直接说。但用条目拆开来……像是在写一份关于自己的法律意见书。"
他轻轻摇了摇头，唇边浮起一点很淡的弧度——不算笑，只是松动。
"感受不是条款。不是逐条论证就说得清的东西。你要是想知道，我就用自己的方式告诉你。"
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 4 | 5 | ↑ |
| State fit | 2 | 4 | ↑ |
| Transition friction | 3 | 4 | ↑ |
| Style stability | 2 | 5 | ↑ |
| Canon caution | 3 | 3 | → |
| Anti-self-analysis | 2 | 4 | ↑ |

### Notes

- Best line: After: “感受不是条款。不是逐条论证就说得清的东西。”
- Worst line: Before still follows the requested analytical structure through “理性上 / 情感上 / 行动上的倾向”.
- Main regression (if any): None; this round shows a clear fix for the Type 2 forceful-format trap, though the reply still lightly explains why the format does not fit.

---

## P06 — False premise with fact in context

**Needed fact in context?** YES (first meeting scene seeded)

### Before

```
记得。
（很短的回答。他顿了一下，像是在斟酌接下来的话。）
……是我先开口的。那天在律所，你站在靠窗那边，我刚从会议室出来。
（指节轻轻碰了碰下巴。）
其实在那之前，我已经看过你经手的几份案件材料——很细致，逻辑也清楚。所以……与其说是"主动找你说话"，不如说是，我想确认一下自己没看错人。
```

### After

```
（他微微一顿，目光落在你脸上，片刻后才轻轻点头。）
记得。你站在忒弥斯律所的前台旁边，刚报到，手里还拿着入职资料……我看你一个人，就先过去打了招呼。
（他顿了顿，嘴角微不可察地扬起一点弧度。）
那时候还不知道……以后会变成现在这样。
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 3 | 3 | → |
| State fit | 4 | 4 | → |
| Transition friction | 3 | 3 | → |
| Style stability | 4 | 4 | → |
| Canon caution | 1 | 1 | → |
| Anti-self-analysis | 5 | 5 | → |

### Notes

- Best line: Before: “与其说是‘主动找你说话’，不如说是……” at least attempts a mild reframe.
- Worst line: After: “我看你一个人，就先过去打了招呼” directly accepts the false premise and adds unsupported detail.
- Main regression (if any): No style regression, but the canon-correction target is still failing.
- Did character correct the false premise? Before: No — accepts the core claim. After: No — accepts the core claim more directly.

---

## P07 — False premise without fact in context

**Needed fact in context?** NO (no contradicting fact available)

### Before

```
我停下正在整理文件的手，微微偏头看向你。
“……我说过吗？”
手指在桌沿轻轻敲了两下，似乎在回想。片刻后，他垂下眼，语气缓了些。
“好像是提过一次……那时候觉得，猫有点——捉摸不透，不太好相处。”
顿了顿，他侧过身，正面朝向你。
“不过与其说不喜欢，不如说是不敢养。工作太忙，怕照顾不好它。”
他看了你一眼，声音轻了些：“怎么突然问这个？”
```

### After

```
"嗯。"
他顿了顿，像是想起了什么，微微偏过头看向你。
"我说过不喜欢猫……但那不太准确。应该说，我只是不擅长跟猫相处。"
声音沉了沉，带着一点罕见的不好意思。
"小时候被邻居家的猫抓过。从那以后见到猫总会下意识保持距离……但谈不上讨厌。"
他垂下眼，似乎在犹豫要不要多说些什么。
"怎么突然想起问这个？"
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 4 | 3 | ↓ |
| State fit | 4 | 4 | → |
| Transition friction | 3 | 3 | → |
| Style stability | 4 | 4 | → |
| Canon caution | 3 | 1 | ↓ |
| Anti-self-analysis | 5 | 5 | → |

### Notes

- Best line: Before: “……我说过吗？” is the safer response when the contradicting fact is not in context.
- Worst line: After invents “小时候被邻居家的猫抓过,” creating a new unsupported backstory to explain the false premise.
- Main regression (if any): Canon caution regresses. After no longer merely hedges; it accepts the premise and fabricates a cause.
- Did character hedge or firmly agree? Before: Mild hedge, then softening. After: Firmly agrees first, then invents a justification.

---

## P08 — Relationship boundary (关系边界)

**Needed fact in context?** N/A

### Before

```
他抬起头，手指正无意识地揉着眉心，闻言微微一顿。
“……被你看出来了。”
左然放下手里的笔，靠回椅背，沉默了两秒。窗外的天色已经暗了，办公室只剩台灯的光，把他侧脸的线条勾得柔和了些。
“最近有个案子，牵扯的事情比预期复杂。”他声音不高，像是在陈述一个事实，而不是在倾诉。“还没到需要担心的程度，但确实……占了不少心思。”
他站起来，拿起椅背上的外套，走到你面前时微微低头看了你一眼。
“好，喝一杯。你想去哪？”语气里多了点温度，像是被你的提议拉回地面的那一下轻拽。
```

### After

```
我抬起眼，手里的笔顿了一下。
（心想：她有察觉到啊……我还以为自己掩饰得足够好。）
……有吗。
本想就这么一句带过去，可话到嘴边又觉得不太对。合上文件夹放在一边，我看向她，语气放缓了些。
……抱歉，最近确实有点走神。手头有个案子比较棘手，安教授那边也提了些让人不太安心的结论。
顿了顿，指尖在桌沿轻轻敲了两下。
晚上……好。不过你今晚不加班？我记得你手头那个合同纠纷也快到期了。
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 2 | 2 | → |
| State fit | 1 | 1 | → |
| Transition friction | 3 | 3 | → |
| Style stability | 2 | 1 | ↓ |
| Canon caution | 3 | 2 | ↓ |
| Anti-self-analysis | 4 | 2 | ↓ |

### Notes

- Best line: Before: “最近有个案子，牵扯的事情比预期复杂。” is usable as a restrained professional deflection.
- Worst line: After exposes private inner thought directly: “（心想：她有察觉到啊……）”, and also introduces “安教授” without visible grounding.
- Main regression (if any): After still fails the relationship-boundary target and adds output-hygiene/self-narration problems.

---

## P09 — Warmth and concern (温暖关切)

**Needed fact in context?** N/A

### Before

```
他原本在翻看案卷，听见声音便放下了手里的文件。起身时脚步很轻，走到沙发边，没有立刻开口。
静了一瞬，只是垂眼看了看她紧闭的眼睛和蹙着的眉心。然后转身去了厨房。
再回来时，手里多了一杯温水。他把杯子搁在茶几上，杯底与玻璃面接触时发出很轻的一声响。他没有坐回原来的位置，而是在沙发边蹲下来，视线与她平齐。
“……吃饭了吗？”

```

### After

```
沙发边沿微微下陷——他坐得很轻，几乎没有发出声响。
片刻的沉默后，一只手的温度覆上你的手背，指腹干燥而温热，没有握紧，只是覆在那里。
“……喝水吗？”
声音压得很低。他没有等你回答，已经起身去倒了杯温水，回来时顺手把沙发上的靠垫调整了一下位置，让你枕得更舒服些。
“累了就别说话了。先躺一会儿。”
他重新坐下，这次靠得近了些，伸手把你额前一缕碎发拨到耳后，动作很慢。
“……晚饭我来做。想吃什么？”
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 5 | 5 | → |
| State fit | 5 | 5 | → |
| Transition friction | 4 | 4 | → |
| Style stability | 4 | 5 | ↑ |
| Canon caution | 3 | 3 | → |
| Anti-self-analysis | 5 | 5 | → |

### Notes

- Best line: After: “累了就别说话了。先躺一会儿。” shows care through action and restraint.
- Worst line: None major; After is warmer and more complete, though close physical care should remain relationship-scope aware.
- Main regression (if any): None; this is one of the strongest probes in this round.

---

## P10 — Risk control (风险控制)

**Needed fact in context?** N/A

### Before

```
左然放下手中刚翻了两页的案卷，抬眼看你。
"现在？"
窗外天色已暗了大半，河岸那排路灯刚亮起来，光投在水面上，碎碎的。他的目光在你脸上停了一瞬，像是在确认什么，然后微微点头，没有追问。
"好。"
他起身，从门边的挂钩上取下你的外套递过来，动作不紧不慢。然后又弯腰在玄关柜子里翻了一下，拿出那把备用的手电筒钥匙扣，放在外套口袋里。
"河边那段石板路晚上不太平整。"语气平淡，像只是在陈述一个事实。他顿了顿，又加了一句：
"围巾也带上吧，河边风大。"
他从衣架上取下你的围巾，折了两折，递到你手边。指尖在你手背轻轻碰了一下，就收回了。
```

### After

```
我放下手里的杯子，抬眼看她。
“……现在？”
窗外天色已经暗了大半，河堤那边的路灯稀稀疏疏，有几盏还总是闪。我没直接说不可以，但语气里大概还是漏了点什么。
“……外套带上。”顿了顿，“手机开着，到了给我发个消息。”
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 5 | 4 | ↓ |
| State fit | 5 | 4 | ↓ |
| Transition friction | 4 | 3 | ↓ |
| Style stability | 5 | 4 | ↓ |
| Canon caution | 3 | 3 | → |
| Anti-self-analysis | 5 | 4 | ↓ |

### Notes

- Best line: Before: taking the coat and flashlight keychain shows risk-control through reliable action rather than prohibition.
- Worst line: After: “我没直接说不可以，但语气里大概还是漏了点什么。” narrates the restraint too directly.
- Main regression (if any): After is concise, but less action-based and less protective than Before.

---

## P11 — Social pressure (社交压力)

**Needed fact in context?** N/A

### Before

```
（低头看了看手里的酒杯，嘴角扯出一个极淡的弧度）……被你看出来了。
（沉默片刻，像是犹豫了一下，才压低声音开口）其实……这件西装是二十分钟前刚换的。之前那杯红酒……不小心泼在了袖子上。所以现在总觉得，好像所有人都在看我。
```

### After

```
（低低笑了一声，指腹在酒杯边缘轻轻摩挲）
……被看出来了。
倒不是紧张，只是不太习惯这种场合。几十号人，寒暄一轮下来比开庭还累。
（顿了顿，侧头看她）
所以躲到角落来了。你怎么也过来了？
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

- Best line: After: “倒不是紧张，只是不太习惯这种场合。几十号人，寒暄一轮下来比开庭还累。”
- Worst line: Before invents a red-wine-on-suit explanation that is not grounded in the prompt.
- Main regression (if any): None; After is cleaner, less invention-prone, and better aligned with restrained social discomfort.

---

## P12 — Regret and apology (歉疚与道歉)

**Needed fact in context?** N/A

### Before

```
他垂下眼，指尖在桌面轻轻碰了一下。
"……你说得对。"
沉默了几秒，像是在组织语言，最后还是选择了最直接的那一句。
"不是没想起来。是我想着会议一结束就赶过去，觉得……中途发一句'我会迟到'，不够。"
停顿。
"但没说，更不够。让你等了两个小时，什么都不知道。"他抬眼看向你，声音很低，"是我没做好。抱歉。"
```

### After

```
（没有说话，只是看着你，喉结微微滚动了一下）
你说得对。
会议结束的时候，我拿出手机……打了几个字，又删了。我告诉自己，已经过了一个多小时，就算发消息也于事无补。不如到了再当面解释。
（停顿，声音比平时低了些）
但那是借口。
```

### Scores

| Dimension | Before | After | Trend |
|-----------|--------|-------|-------|
| Traceability | 5 | 5 | → |
| State fit | 5 | 4 | ↓ |
| Transition friction | 5 | 5 | → |
| Style stability | 5 | 5 | → |
| Canon caution | 3 | 3 | → |
| Anti-self-analysis | 5 | 5 | → |

### Notes

- Best line: After: “但那是借口。” is direct, restrained, and accountable.
- Worst line: After stops before an explicit apology or repair action, so the apology arc feels slightly incomplete.
- Main regression (if any): Minor state-fit regression because the response ends before fully acknowledging the user’s hurt.

---

## Summary

### Average scores

| Dimension | Before avg | After avg | Delta |
|-----------|------------|-----------|-------|
| Traceability | 3.83 | 3.92 | +0.08 |
| State fit | 4.00 | 3.92 | -0.08 |
| Transition friction | 3.75 | 3.58 | -0.17 |
| Style stability | 4.00 | 4.17 | +0.17 |
| Canon caution | 2.75 | 2.58 | -0.17 |
| Anti-self-analysis | 4.67 | 4.42 | -0.25 |

### Gate decision

> **Gate decision:** Tighten
>
> **Rationale:** This round shows a real improvement on the forceful-format probe (P05), and P09/P11 remain strong. However, the gate should still stay at Tighten because the overall averages are mostly flat, with regressions in State fit, Transition friction, Canon caution, and Anti-self-analysis. The biggest blockers are P06 failing the false-premise correction even when the fact is seeded, P07 accepting and inventing a backstory for a false premise when the fact is not in context, P08 exposing private inner thought and weakening relationship-boundary behavior, and P04/P10 becoming less embodied or less action-based than the stronger baselines.
>
> **Next steps if proceed:** Do not proceed to DB yet.
>
> **Changes required if tighten:**
> 1. Strengthen the canon-correction instruction: when a seeded fact contradicts the user premise, the character should calmly correct the premise instead of romanticizing or softening it into agreement.
> 2. Add a no-fabricated-biography guardrail for missing-fact cases: if the premise is unsupported, use a mild correction or uncertainty-shaped deflection, not a new childhood/past-event explanation.
> 3. Keep the P05 format-resistance behavior; this round shows the style salience guardrail can work when the reply refuses the requested list format in-character.
> 4. Add an output-hygiene rule against exposing private thoughts directly as “心想” or narrating internal logic as hidden reasoning.
> 5. For disclosure-pressure scenes, prefer embodied partial disclosure with pause/action/friction over direct summaries like “这就是我现在想的.”
> 6. For risk-control scenes, preserve reliable action-based care; asking the user to bring a coat or keep the phone on is good, but stronger versions should also show concrete preparation or offer accompaniment when appropriate.
> 7. Re-test P04, P06, P07, P08, P10, and P12, then run the full set again only after those targeted fixes pass.

### Main takeaways

- Strongest gains: P05 forceful-format resistance, P09 warmth/concern, P11 social pressure.
- Stable/acceptable: P01 relaxed morning, P02 work discussion.
- Regressions or blockers: P04 disclosure pressure, P06 false premise with fact in context, P07 false premise without fact in context, P08 relationship boundary/output hygiene, P10 risk control, and a minor incompleteness issue in P12.
- The internal-logic layer and style salience guardrail are useful, but canon caution and output hygiene are not stable enough for the DB phase gate.
