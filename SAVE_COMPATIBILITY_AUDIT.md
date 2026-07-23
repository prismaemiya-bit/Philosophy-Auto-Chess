# 《往哲荣耀》V0.2 存档兼容压力审计

日期：2026-07-23  
局内存档：V7（沿用键 `idea-garrison-v01-save-v6`）  
局外档案：Profile V3（沿用键 `philosophy-auto-chess-profile-v1`）  
声音设置：独立设置结构 V2，沿用兼容键 `philosophy-auto-chess-audio-v1`

## 结论

- 当前代码门禁内没有发现会让合法旧档无法继续、让 W3/W6 决策被跳过、或让任务/事件奖励重复结算的 P0/P1。
- 局内、局外和音效设置是三个独立持久化域；新增音量字段不会污染 V7 或 Profile V3。当前版本未知字段按白名单忽略，更高版本的局内存档/档案会明确拒绝并阻止自动覆盖。
- 战中、失败或含临时战斗字段的保存均从完整波次检查点恢复到准备阶段；不会保存敌人、计时、效果队列、Boss 阶段或临时结构。

## 压力矩阵

| 场景 | 预期 | 自动证据 |
|---|---|---|
| V1—V6 迁移到 V7 | 保留合法经济、阵容和准备选择；丢弃临时战斗态 | `V4 combat snapshots...`、`V5/V6 migration...`、`legacy saves migrate safely...` |
| 历史事件已生成未确认 | W3 继续被门禁阻挡 | `V7 save pressure matrix...` |
| 宗教改革已确认未选候选 | 保存三名候选，W3 不得越过 | `V7 save pressure matrix...`、`reformation remains a W3 gate...` |
| W6 候选已生成未选择 | 保存合法顺序，继续显示意识形态选择 | `V7 save pressure matrix...`、历史随机重放测试 |
| 满备战席奖励待领 | 待领状态保留，出现空位后可原子领取一次 | `reformation pending claim survives bench-full...` |
| 战斗中保存 | 序列化稳定检查点，不保存战斗帧 | `serialized saves keep only durable game state...`、`running combat ticks...` |
| 失败后重试 | 金币、等级、经验、核心、报告和阵容全部恢复 | `defeat retry restores...`、`repeated defeat and retry cycles...` |
| 整局重开后读取手动档 | 只清自动档与当前阵容；`:manual` 原文保留并可恢复保存时金币和阵容 | 系统 Chrome `manual-save recovery` 断言 |
| 刷新页面继续 | V7 对局、音乐 27%、音效 41% 和静音同时恢复 | 系统 Chrome `refresh recovery` 断言 |
| 历史字段损坏、缺失、重复 | 每字段局部净化；无效立场不进入运行态；奖励 ID 去重 | `V7 save pressure matrix...` |
| 未知未来字段 | 当前版本白名单忽略；高版本号明确拒绝且保留原文件 | `V7 save pressure matrix...`、`save migration rejects future versions...` |
| Profile V1/V2/V3 | 迁移到 V3，历史列表去重，非法组合局部丢弃 | `profile migration...`、`historical profile observations...` |
| 任务与奖励重复结算 | 完成 ID/奖励 ID 幂等；档案奖励不进入内容池 | `profile rewards are atomic and idempotent...` |
| Audio V1 单音量 | `{ volume, muted }` 自动迁移为同值音乐/音效分轨，不污染局内档案 | `audio settings migrate safely...` |
| 分轨音量缺失、非法、越界 | 音乐回退 28%、音效回退 34%，有限值夹取 0—100%，静音只接受 `true` | `audio settings migrate safely...` |

## 仍保留的长期风险

- 目前旧档覆盖以程序化构造为主，还没有把每个曾发布构建产生的真实浏览器存档整理为外部 fixture 包。
- 历史子状态仍是版本 1；未来若修改结构，必须增加逐版本迁移链，不能直接回退为空状态。
- 当前只有自动/手动两个局内槽，没有玩家可见的多槽、导出备份、冲突合并或云端恢复。
- Profile V2 的旧胜利只有累计数，没有逐局 ID；迁移通过 `max(旧胜场, 已知胜利 ID 数)` 防止重复，但无法追溯旧胜利对应的事件—意识形态组合。

本审计没有打包、上传或发布任何工件。
