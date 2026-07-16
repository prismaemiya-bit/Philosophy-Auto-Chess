# 系统 Chrome 验收

本项目不依赖 Codex 内置浏览器。自动交互使用系统 Chrome、独立临时用户目录和 Chrome DevTools Protocol，不安装 Playwright/Puppeteer，也不会读取日常 Chrome 配置。

## 自动交互

```powershell
npm.cmd run test:browser
```

覆盖：购买、部署、撤回、拖入商店出售、开波、法国革命节点、英国研究卡、启蒙议程。成功后截图写入 `artifacts/browser-interactions-1920x1080.png`。这个命令是发布前独立门禁；默认 `npm test` 保持无 GUI、可用于 CI。

若 Chrome 不在默认位置：

```powershell
$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
npm.cmd run test:browser
```

## 最短人工验收

1. 双击 `打开往哲荣耀.cmd`（当前开发目录也可运行 `start-game.cmd`），访问它打开的本地地址。
2. 购买一名角色，依次拖到合法地图格、备战席、商店；确认黄色合法格与鼠标位置一致，商店出现“拖入出售”。
3. 放入至少 2 名法国角色，点击法国共鸣，改选三个革命节点，确认地图标记随选择改变。
4. 完成英国 4/6 的研究条件后，在准备阶段选择力学/医学/政治算术；确认战斗中锁定且不出现 A/B/C 敌人路线文案。
5. 放入 3/4 名启蒙成员，选择一项/两项议程并开波，确认选择冻结。
6. 在 1920×1080 下检查地图、右侧控制栏、底部备战与商店无重叠；完成一次 W10，确认 75%/45%/20% 阶段提示、日志和复盘均出现。

自动截图只证明浏览器运行和 DOM/交互断言通过，不替代人工画面审美与拖动手感验收。
