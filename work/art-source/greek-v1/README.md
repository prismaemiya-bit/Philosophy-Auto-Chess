# 古希腊角色美术 v1

原始交付为 2048×2048 RGB PNG，白色画布，无透明通道。原图在本目录按稳定角色 ID 归档，游戏不直接加载这些大图。

运行时立绘由 `scripts/process-character-art.py` 无生成式重绘地产生。处理过程只移除从画布边缘连通的白底，完整保留美术已经绘制的五边形边框、人物姿态、器物和姓名牌，再将可见画框归一到统一的 512×512 透明画布。阵营描边、星级光效与拖放命中继续由 CSS 提供。

| 角色 ID | 原图 | 输入范围 left,top,right,bottom | 运行时资源 |
| --- | --- | --- | --- |
| plato | `plato-full.png` | `0,0,2048,2048` | `public/assets/characters/plato.webp` |
| socrates | `socrates-full.png` | `0,0,2048,2048` | `public/assets/characters/socrates.webp` |
| aristotle | `aristotle-full.png` | `0,0,2048,2048` | `public/assets/characters/aristotle.webp` |
| epicurus | `epicurus-full.png` | `0,0,2048,2048` | `public/assets/characters/epicurus.webp` |

白色外部背景使用四角连通填充清除，不会把画框内部的白袍和明亮背景误删。四张输出使用相同的 8px 安全边距和 496×496 可视范围，因此无需用生成模型重画、抠复杂发丝或修改原图中的希腊文字。可复现命令使用 `--crop 0,0,2048,2048 --framed-art --frame-padding 8`。

## 原图 SHA-256

- `aristotle-full.png`: `8d7b01fdca343e356b92afbd44a3a256702b67a52bc6215e7ec0f400e0a84892`
- `epicurus-full.png`: `248396de20b12da97bcf0fd0597d62b60549cee1cd6aa0197c746830263e6b36`
- `plato-full.png`: `69cf63adbbb005996ac0a77b6c706691ae8fc9945a4e988cac504a557ad44eea`
- `socrates-full.png`: `83e2f80053c29ff18c9608b0ae14895d3a7afa9f588b9e59930b69765a95a75c`
