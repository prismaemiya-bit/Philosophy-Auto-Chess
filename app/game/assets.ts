/** Presentation-only asset registry. Replace values here when final art arrives. */
import type { EnemyKind } from "./battle";

export type AssetRef = { glyph: string; portrait?: string; portraitShape?: "pentagon"; accent: string; label: string; armor?: number; speed?: string; trait?: string };

export const characterAssets: Record<string, AssetRef> = {
  socrates: { glyph: "◎", portrait: "/assets/characters/socrates.webp", portraitShape: "pentagon", accent: "gold", label: "控场" },
  plato: { glyph: "◇", portrait: "/assets/characters/plato.webp", portraitShape: "pentagon", accent: "gold", label: "支援" },
  aristotle: { glyph: "⌁", portrait: "/assets/characters/aristotle.webp", portraitShape: "pentagon", accent: "cyan", label: "狙击" },
  epicurus: { glyph: "✚", portrait: "/assets/characters/epicurus.webp", portraitShape: "pentagon", accent: "green", label: "治疗" },
  fichte: { glyph: "▣", portrait: "/assets/characters/fichte.webp", portraitShape: "pentagon", accent: "blue", label: "重装" }, husserl: { glyph: "◉", portrait: "/assets/characters/husserl.webp", portraitShape: "pentagon", accent: "green", label: "治疗" },
  schelling: { glyph: "✦", portrait: "/assets/characters/schelling.webp", portraitShape: "pentagon", accent: "violet", label: "爆破" }, heidegger: { glyph: "⬡", portrait: "/assets/characters/heidegger.webp", portraitShape: "pentagon", accent: "blue", label: "重装" },
  kant: { glyph: "△", portrait: "/assets/characters/kant.webp", portraitShape: "pentagon", accent: "cyan", label: "控场" }, hegel: { glyph: "◈", portrait: "/assets/characters/hegel.webp", portraitShape: "pentagon", accent: "violet", label: "爆破" },
  descartes: { glyph: "✧", portrait: "/assets/characters/descartes.webp", portraitShape: "pentagon", accent: "cyan", label: "控场" }, rousseau: { glyph: "❖", portrait: "/assets/characters/rousseau.webp", portraitShape: "pentagon", accent: "green", label: "治疗" },
  sartre: { glyph: "◇", portrait: "/assets/characters/sartre.webp", portraitShape: "pentagon", accent: "orange", label: "战士" }, foucault: { glyph: "⌘", portrait: "/assets/characters/foucault.webp", portraitShape: "pentagon", accent: "violet", label: "爆破" },
  locke: { glyph: "▱", portrait: "/assets/characters/locke.webp", portraitShape: "pentagon", accent: "green", label: "支援" }, hume: { glyph: "⌁", portrait: "/assets/characters/hume.webp", portraitShape: "pentagon", accent: "cyan", label: "狙击" },
  hobbes: { glyph: "⬟", portrait: "/assets/characters/hobbes.webp", portraitShape: "pentagon", accent: "blue", label: "重装" }, russell: { glyph: "⊞", portrait: "/assets/characters/russell.webp", portraitShape: "pentagon", accent: "violet", label: "爆破" },
  althusser: { glyph: "◫", portrait: "/assets/characters/althusser.webp", portraitShape: "pentagon", accent: "violet", label: "辅助" },
  bacon: { glyph: "⌁", portrait: "/assets/characters/bacon.webp", portraitShape: "pentagon", accent: "cyan", label: "射手" }, bentham: { glyph: "⊕", portrait: "/assets/characters/bentham.webp", portraitShape: "pentagon", accent: "green", label: "辅助" },
  deleuze: { glyph: "✣", portrait: "/assets/characters/deleuze.webp", portraitShape: "pentagon", accent: "violet", label: "群攻" }, derrida: { glyph: "⌘", portrait: "/assets/characters/derrida.webp", portraitShape: "pentagon", accent: "violet", label: "控制" },
  lacan: { glyph: "◌", portrait: "/assets/characters/lacan.webp", portraitShape: "pentagon", accent: "orange", label: "控制" }, wittgenstein: { glyph: "∴", portrait: "/assets/characters/wittgenstein.webp", portraitShape: "pentagon", accent: "cyan", label: "控制" },
};

export const factionAssets = {
  greece: { glyph: "Ω", accent: "gold", label: "古希腊·理念学园" },
  germany: { glyph: "◇", accent: "blue", label: "德国·体系" },
  france: { glyph: "✦", accent: "red", label: "法国·革命" },
  britain: { glyph: "⌁", accent: "cyan", label: "英国·实验" },
} as const satisfies Record<string, AssetRef>;

export const bossAssetIds = ["cave-boss", "skeptic-boss", "dialectic-boss", "boss", "leviathan-boss"] as const;

export const enemyAssets: Record<EnemyKind, AssetRef> = {
  "war-machine": { glyph: "⚙", accent: "orange", label: "攻城重装", armor: 18, speed: "缓慢", trait: "移动减伤；持续受阻会召唤常识卫士" },
  swift: { glyph: "⚡", accent: "red", label: "快速近战", armor: 0, speed: "很快", trait: "高速穿行" },
  ordinary: { glyph: "⚔", accent: "teal", label: "基础近战", armor: 0, speed: "正常", trait: "阻挡权重 1" },
  caster: { glyph: "🏹", accent: "violet", label: "远程", armor: 4, speed: "较慢", trait: "推进中射击高台" },
  swarm: { glyph: "⋯", accent: "red", label: "集群近战", armor: 0, speed: "较快", trait: "成群消耗阻挡" },
  armored: { glyph: "🛡", accent: "gold", label: "重装近战", armor: 20, speed: "很慢", trait: "阻挡权重 2" },
  elite: { glyph: "⌖", accent: "orange", label: "精英远程", armor: 12, speed: "中等", trait: "远程压制；阻挡权重 2" },
  "cave-boss": { glyph: "◉", accent: "violet", label: "洞穴之影", armor: 12, speed: "中等", trait: "50% 生命触发转身之痛" },
  "skeptic-boss": { glyph: "?", accent: "cyan", label: "怀疑深渊", armor: 18, speed: "较慢", trait: "55% 生命获得 24% 最大生命护盾" },
  "dialectic-boss": { glyph: "⇄", accent: "red", label: "矛盾机枢", armor: 14, speed: "中等", trait: "65% 加速；30% 恢复生命并获得护盾" },
  boss: { glyph: "☉", accent: "orange", label: "绝对精神", armor: 30, speed: "缓慢", trait: "75% / 45% / 20% 生命触发固定精神阶段" },
  "leviathan-boss": { glyph: "♜", accent: "gold", label: "契约利维坦", armor: 34, speed: "很慢", trait: "70% / 35% 生命召集契约卫队" },
};

export const mapAssets = {
  background: "/assets/battlefield-showcase.png",
  replacements: {
    characters: "public/assets/characters/<character-id>.png",
    enemies: "public/assets/enemies/<enemy-kind>.png",
    maps: "public/assets/maps/<map-id>.png",
    effects: "public/assets/effects/<effect-id>.png",
  },
} as const;

export const characterTraits: Record<string, string[]> = {
  socrates: ["古希腊", "辩证法"], plato: ["古希腊", "辩证法", "哲人王"], aristotle: ["古希腊", "逻辑分析"], epicurus: ["古希腊", "幸福论"],
  fichte: ["德国", "辩证法"], husserl: ["德国", "现象学"], schelling: ["德国"], heidegger: ["德国", "现象学"], kant: ["德国", "启蒙"], hegel: ["德国", "辩证法"],
  descartes: ["法国"], rousseau: ["法国", "契约共同体", "启蒙"], sartre: ["法国", "现象学"], foucault: ["法国"], althusser: ["法国"],
  deleuze: ["法国"], derrida: ["法国"], lacan: ["法国"],
  locke: ["英国", "契约共同体", "启蒙"], hume: ["英国", "启蒙"], hobbes: ["英国", "契约共同体"], russell: ["英国", "逻辑分析"],
  bacon: ["英国"], bentham: ["英国", "幸福论"], wittgenstein: ["英国", "逻辑分析"],
};

export const skillDetails: Record<string, string> = {
  socrates: "降低最近威胁敌人的能量，短暂停顿并叠加矛盾。", plato: "冻结尚未接敌的后续敌群；Boss 控制时间缩短且有重复免疫。",
  aristotle: "连续锁定最高生命敌人，末击破甲。", epicurus: "治疗最低生命友军；目标满血时强化其攻速与减伤。",
  fichte: "获得护盾、嘲讽附近敌人，并临时增加阻挡。", husserl: "治疗最低生命友军，并提供一次抵消施法攻击的悬置护盾。",
  schelling: "在密集敌群展开减速、伤害与爆发。", heidegger: "首次濒死时短暂不死、嘲讽并减速周围敌人。",
  kant: "封锁精英或 Boss 的能量和增益，并延后部分伤害。", hegel: "先造成范围伤害并施加矛盾，再引爆和传播已有矛盾。",
  descartes: "对当前目标造成伤害并减速，协助留住快速敌人。", rousseau: "治疗生命比例最低的友军，并给予护盾。",
  sartre: "开战按站位锁定攻击或保护形态，战斗中不重复切换。", foucault: "在敌人最密集处施加区域减速、降攻和充能阻碍。",
  locke: "为低生命友军提供护盾和小幅治疗。", hume: "连续射击最高生命目标，末击造成额外伤害。",
  hobbes: "按当前阻挡总重量获得护盾、防御和嘲讽。", russell: "拆分重量不低于 2 的精英或 Boss；无合法目标时造成高额单体伤害。",
  althusser: "在目标位置建立延迟装置，三秒后必定造成范围伤害和减速。",
  bacon: "连续攻击同一目标；第三次命中造成额外归纳伤害，切换目标后重新计数。",
  bentham: "按最大生命比例重新平均存活友军生命，并治疗自身。",
  deleuze: "连接多个敌人，使伤害与基础减益沿根茎关系传播。",
  derrida: "优先拆除目标护盾或强化；没有可拆内容时削弱目标并延后技能。",
  lacan: "记录高威胁目标受到的伤害，在其施法或记录到期时引爆。",
  wittgenstein: "封锁目标特殊能力；面对无特殊能力目标时改为爆发伤害并禁止获得护盾。",
};
