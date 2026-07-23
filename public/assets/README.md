# 往哲荣耀占位素材目录

当前 Demo 使用 CSS 与 `app/game/assets.ts` 中的图标占位，不依赖现成游戏素材。

未来替换时，请保持下列路径约定：

- `characters/<character-id>.png`：角色立绘或战场小人
- `enemies/<enemy-kind>.png`：敌人战场图标
- `maps/<map-id>.png`：地图底图
- `effects/<effect-id>.png`：投射物、命中、技能特效
- `audio/<cue-id>.wav`：界面、战斗、历史事件与结算短音效

所有素材的引用都应先登记到 `app/game/assets.ts`，不要把资源路径散落到战斗或经济逻辑中。

音效由 `scripts/generate-audio-assets.mjs` 确定性生成，是不含第三方采样和
生成模型输出的项目原创 PCM；运行时统一登记在 `app/game/audio.ts`。
