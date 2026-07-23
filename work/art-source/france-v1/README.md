# 法国角色美术 v1

本批原图均为完整五边形构图。运行时处理只移除与画布边缘连通的白底，不裁切人物、道具、文字或原有黑色边框；随后按与古希腊相同的 `512×512 RGBA`、`8px` 安全边距和 `object-fit: contain` 规则输出。

| 角色 ID | 原图 | 运行时资源 |
| --- | --- | --- |
| descartes | `descartes-full.png` | `public/assets/characters/descartes.webp` |
| rousseau | `rousseau-full.png` | `public/assets/characters/rousseau.webp` |
| sartre | `sartre-full.png` | `public/assets/characters/sartre.webp` |
| foucault | `foucault-full.png` | `public/assets/characters/foucault.webp` |
| althusser | `althusser-full.png` | `public/assets/characters/althusser.webp` |
| deleuze | `deleuze-full.png` | `public/assets/characters/deleuze.webp` |
| derrida | `derrida-full.png` | `public/assets/characters/derrida.webp` |
| lacan | `lacan-full.png` | `public/assets/characters/lacan.webp` |

附件中第 2、3 张图片为同一文件的重复副本，本批按 8 个法国角色使用 8 张唯一素材，未重复占用角色资源。

可复现命令：

```powershell
python scripts/process-character-art.py --source work/art-source/france-v1/<character-id>-full.png --out public/assets/characters/<character-id>.webp --crop 0,0,2048,2048 --size 512 --framed-art --frame-padding 8
```
