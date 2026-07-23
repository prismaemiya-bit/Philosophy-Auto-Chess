# 往哲荣耀上线入口与接口

## 玩家入口

- `/`：正式统一入口。按客户端提示与 User-Agent 选择桌面或手机 UI；可用 `?ui=desktop`、`?ui=mobile` 强制验收。
- `/desktop`：固定桌面 UI 入口。
- `/mobile`：固定手机 UI 入口。

桌面与手机分别由 `DesktopGameExperience`、`MobileGameExperience` 接管入口逻辑。两端共用确定性引擎、角色内容、存档格式与同源 `localStorage`，不得复制或分叉游戏规则。

当前手机端仍复用 `GameClient` 内的核心交互树；后续移动端结构拆分应只下沉到 `MobileGameExperience`，桌面结构拆分只下沉到 `DesktopGameExperience`。正式上线前不得再把平台判断散落回引擎、战斗或存档模块。

## 公开只读接口

- `GET /api/health`：部署探活。返回服务状态、产品名、版本、部署提交和检查时间，禁止缓存。
- `GET /api/release`：启动器、官网或发布页读取的版本契约。返回统一/桌面/手机入口、存档兼容版本和 GitHub 源码地址。

接口不得返回玩家本地存档、身份信息或服务端秘密。当前版本没有账号、排行榜或云存档写接口；这些能力必须在隐私、鉴权和迁移方案确定后单独上线。

## 正式发布顺序

1. 等玩法会话合并并形成唯一候选提交。
2. 重跑 `npm.cmd test`、`npm.cmd run test:release` 和系统 Chrome 桌面/手机门禁。
3. 推送该精确提交到 GitHub；用同一提交创建站点版本，禁止用未提交工作树直接部署。
4. 验证 `/api/health`、`/api/release` 与三个玩家入口。
5. 最后开放公开访问并绑定正式域名。

实机门槛仍包括至少一台 iOS Safari 与一台 Android Chrome；模拟视口通过不能代替真人触控、横竖屏和 PWA 安装验收。
