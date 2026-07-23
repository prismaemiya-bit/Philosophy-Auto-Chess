# 给 WorkBuddy 的续作提示词

你现在接手《往哲荣耀 / Philosophy Auto Chess》的历史事件系统实现。

项目目录：

`C:\Users\12125\Documents\Codex\2026-07-12\1-2-8-3-9-5`

你的目标是直接完成剩余实现、自动验证、系统 Chrome 验收和记录，不只给设计建议。开始前必须完整阅读：

1. `HISTORICAL_EVENTS_IMPLEMENTATION_PLAN.md`
2. `WORKLOG_V02.md` 最后 180 行
3. `DESIGN_V02.md`
4. `app/game/historical-events.ts`
5. `app/game/engine.ts`
6. `app/game/combat-core.ts`
7. `app/game/battle.ts`
8. `app/game/GameClient.tsx`
9. `scripts/economy-sim.ts`
10. `scripts/balance-sim.ts`
11. `tests/game-engine.test.ts`

当前工作区很脏，包含用户此前已完成但未提交的主界面、任务、音频、经济模拟、UI 和平衡修改。严禁使用 `git reset --hard`、`git checkout --`、删除未跟踪文件或覆盖整个文件。先执行 `git status --short` 和 `git diff --stat`，只做历史事件相关增量。

已有基础必须保留：

- 存档已升级到 V7；不得降级或再次无理由升级。
- `GameState.historicalEvents`、V6→V7 迁移、独立 `seed + cursor`、W2/W5 结算里程碑、实际事件/候选保存、检查点深拷贝已经完成。
- `Piece.paidCost` 已进入稳定存档，正常购买记录成本，三合一累加，V6 可推导；宗教改革免费棋子必须写 0。
- `claimHistoricalReward` 用于幂等奖励；`pendingHistoricalDecision` 用于 W3/W6 开波门禁。
- 当前新增基础的引擎测试为 98/98 通过。

按 `HISTORICAL_EVENTS_IMPLEMENTATION_PLAN.md` 的 B→C→D→E→F 批次依次完成。每批要求：

1. 先写或扩展自动测试；
2. 实现该批；
3. 运行 `npm.cmd run typecheck` 和定向测试；
4. 失败就修复，不得跳过；
5. 把已实现、待调数值、测试专用、未实现、延期/否决分别写入 `WORKLOG_V02.md`；
6. 再进入下一批。

关键架构约束：

- 规则必须在引擎、战斗核心和冻结快照中，不得放在 React 本地状态。
- UI 只显示 `GameState` 并调用引擎动作，不得抽随机数或直接发奖励。
- 事件和立场只用保存的独立随机流；不要调用 `Math.random` 抽事件或候选。
- 保存实际事件、实际候选和顺序，不只保存种子。
- 重试、读取、返回检查点、重复结算不得重抽或重复发放。
- 经济修改通过有效规则解析器实现，不得运行时改写 `ECONOMY_RULES` 常量。
- 世界大战只能追加 W4/W7/W9 战争机器，不得替换 W5 洞穴之影或 W10 绝对精神。
- 不实现法国革命街垒。
- 暂定数值必须集中配置并标记待调，模拟后才能确认。
- 保留五张商店、十波、25 名棋子、四大阵营、六小羁绊、地图 16:9、20 个部署 ID 和现有拖放坐标。

明确不做：装备、免费 4 费、额外初始金币、新货币、商店锁定、共享/有限卡池、连败宝箱、重试补偿、新地图、新角色、手机重做、主 UI 重构、临时 AI 美术/音效、打包、发布、Release、GitHub 上传。

浏览器规则非常重要：

- 不要使用 Codex 内置浏览器、内嵌浏览器标签页或其桥接能力。
- 先完成全部代码与自动门禁。
- 最终仅运行仓库现有 `npm.cmd run test:browser`，它面向系统 Chrome；如果系统 Chrome 环境不可用，明确报告为“浏览器验收未验证”，不要用代码检查冒充真实 DOM 验收。
- 不返回整页 DOM 或巨量浏览器日志，只报告断言、失败点和截图路径。

最终必须运行：

```powershell
npm.cmd test
npm.cmd run economy:sim
npm.cmd run balance:sim
npm.cmd run test:browser
```

如模拟脚本输出过大，保存机器可读结果，只在最终报告汇总：种子数、阵容数、确定性哈希、关键曲线、胜率、核心生命、阵亡和异常样本。

最终报告必须包含：

1. 实际实施批次与修改文件；
2. V7 存档与迁移结果；
3. 七个事件和五个立场的最终可玩规则；
4. 五月风暴普通/激进对比；
5. 工业革命与资本积累经济曲线；
6. W4/W7/W9 战争机器压力和奖励数据；
7. 固定阵容胜率、核心生命和阵亡；
8. 是否出现固定最优事件/立场/十人口阵容；
9. 自动测试、TypeScript、工具脚本类型检查、ESLint、production build；
10. 系统 Chrome 真实交互结果，或明确未验证原因；
11. 仍需真人确认的数值；
12. 明确说明未打包、未发布、未上传。

除非发现会破坏现有存档、需要推翻主 UI 或必须重写战斗核心的结构性阻塞，否则不要停下来等待抽象确认，按批次直接实现。

