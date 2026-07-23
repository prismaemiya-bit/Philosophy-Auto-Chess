# 《往哲荣耀》声音设计 V1

## 目标

声音只承担三件事：确认操作、解释战况、标记关键转折。它不负责替代画面，
也不应让自动战斗变成连续噪声。

- 决策音清楚但短，避免尖锐方波、锯齿波和长尾叠加。
- 普通攻击只是低音量战斗纹理，永远让位于漏怪、Boss 与结算。
- 相同事件只播放一次；高频事件按类别限流。
- 所有播放失败都只影响表现，不改变游戏状态。

## 当前声音地图

| 层级 | 事件 |
| --- | --- |
| 经营 | 购买、刷新、部署、出售、冻结 |
| 成长 | 三合一、升级、开波 |
| 战斗 | 普通攻击纹理、技能、格挡、漏怪 |
| 历史 | 历史事件揭示、意识形态确定 |
| 敌情 | Boss 到场、Boss 阶段变化 |
| 结算 | 单波守住、最终胜利、最终失败 |

治疗与常规护盾继续依靠现有画面、数字和状态条表达，不额外发声。它们发生频率
高且不是立即需要玩家反应的信息，加入声音只会遮蔽真正重要的提示。

## 混音与舒适度约束

- 资源格式：44.1 kHz、单声道、16-bit PCM WAV。
- 单文件峰值不超过 `0.40`，RMS 不超过 `0.14`。
- 4 kHz 以上估算能量占比不超过 `0.24`；当前生成结果最高约 `0.05`。
- 普通攻击运行时增益最低，并限制为最多约每 240 ms 一次。
- 漏怪、历史抉择、Boss 和结算会建立 420–900 ms 的声音留白。
- 同一事件 ID 严格去重；同类事件另有独立冷却。
- 每次事件根据稳定 ID 产生 ±4% 的微小播放速率差异，减轻重复感而不改变语义。

完整数值位于 `app/game/audio.ts` 的 `audioAssets` 与
`SOUND_CUE_POLICIES`；生成后的测量位于
`public/assets/audio/TECHNICAL_REPORT.txt`。

## 资产与许可证决策

本版生产音效全部由 `scripts/generate-audio-assets.mjs` 确定性合成，不包含
第三方采样，也没有使用生成模型输出，因此不存在额外素材署名或模型输出许可。

后续需要写实脚步、布料、金属或环境声时，候选顺序如下：

1. [MOSS SoundEffect v2](https://huggingface.co/OpenMOSS-Team/MOSS-SoundEffect-v2.0)
   标注 Apache-2.0，适合离线批量生成候选，再由人工剪辑与混音。
2. [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) 与
   [RPG Audio](https://kenney.nl/assets/rpg-audio) 均标注 CC0，适合作为
   可审计的补充素材源。
3. [Stable Audio Open Small](https://huggingface.co/stabilityai/stable-audio-open-small/blob/main/LICENSE)
   使用 Stability AI Community License，商业使用包含注册、营收阈值与展示
   归属等条件；除非项目明确接受这些义务，否则不进入默认生产链。
4. Freesound 只考虑逐条确认过的 CC0 或 CC-BY 文件，并保存作者、原始页面和
   许可证快照；不使用 CC-BY-NC。

生成模型只负责给出素材候选，不能绕过听感筛选、峰值检查、事件语义和许可证台账。

## 复现与检查

```powershell
npm.cmd run generate:audio
npm.cmd test
```

`generate:audio` 会重建全部 WAV，并在峰值、RMS、高频能量或 DC 偏移超出门禁时
直接失败。真实听感仍需在非静音的系统 Chrome 与常用耳机/扬声器上完成一轮人工
试听，尤其关注连续 10 波时的疲劳度和漏怪/Boss 提示的可辨识度。
