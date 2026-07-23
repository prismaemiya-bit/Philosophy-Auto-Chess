# 德国与英国角色美术 v1

本批原图均为作者已经完成的五边形构图。处理只清除与四个画布角连通的外部底色，完整保留人物、文字、器物、银色或金色五边形边框；随后统一输出到带 8px 安全边距的 512×512 透明 WebP。运行时继续使用 `object-fit: contain`，不按透明边界二次裁切。

| 角色 ID | 原图 | 运行时资源 |
| --- | --- | --- |
| fichte | `fichte-full.png` | `public/assets/characters/fichte.webp` |
| husserl | `husserl-full.png` | `public/assets/characters/husserl.webp` |
| schelling | `schelling-full.png` | `public/assets/characters/schelling.webp` |
| heidegger | `heidegger-full.png` | `public/assets/characters/heidegger.webp` |
| kant | `kant-full.png` | `public/assets/characters/kant.webp` |
| hegel | `hegel-full.png` | `public/assets/characters/hegel.webp` |
| locke | `locke-full.png` | `public/assets/characters/locke.webp` |
| hume | `hume-full.png` | `public/assets/characters/hume.webp` |
| hobbes | `hobbes-full.png` | `public/assets/characters/hobbes.webp` |
| russell | `russell-full.png` | `public/assets/characters/russell.webp` |
| bacon | `bacon-full.png` | `public/assets/characters/bacon.webp` |
| bentham | `bentham-full.png` | `public/assets/characters/bentham.webp` |
| wittgenstein | `wittgenstein-full.png` | `public/assets/characters/wittgenstein.webp` |

交付的两张霍布斯图是同一构图的近似重复副本，本批选用文件体积更大的一张归档。罗素原图随后单独交付并按相同规范接入；没有把重复霍布斯图误配给罗素。

可复现命令：

```powershell
node scripts/process-framed-character-art.mjs --source=work/art-source/germany-britain-v1/<character-id>-full.png --out=public/assets/characters/<character-id>.webp --size=512 --padding=8 --threshold=42
```
