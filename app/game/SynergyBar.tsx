import { characterById } from "./characters";
import type { GameState } from "./engine";
import { createTraitSnapshot, type EnlightenmentAgenda, type SmallSynergyId } from "./combat-core";

type SynergyItem = { id: string; title: string; count: string; detail: string };
type FactionId = "greece" | "germany" | "france" | "britain";

const factionCopy: Record<FactionId, { name: string; max: number; tierNames: Record<number, string>; details: Record<number, string> }> = {
  greece: {
    name: "古希腊",
    max: 4,
    tierNames: { 2: "理念学园", 4: "学院共识" },
    details: {
      2: "指定一名讲席；两种不同阵营先后正常施法会触发论辩，为讲席补充能量和护盾。",
      4: "三阵营以上时，每三次论辩强化讲席的下一次技能并产生一次派生效果。",
    },
  },
  germany: {
    name: "德国",
    max: 6,
    tierNames: { 2: "体系萌芽", 4: "体系展开", 6: "绝对体系" },
    details: {
      2: "德国单位正常施法积累概念；满 6 层后全体德国单位获得能量与护盾。",
      4: "体系阈值降为 4，触发后下一次德国正常技能会产生低倍率回响。",
      6: "六名德国单位均施法后，每波一次进入绝对体系并强化各自下一次正常技能。",
    },
  },
  france: {
    name: "法国",
    max: 6,
    tierNames: { 2: "革命浪潮", 4: "革命街垒", 6: "革命公社" },
    details: {
      2: "法国单位正常施法积累热度；达到阈值后在革命前线削弱敌人。",
      4: "阈值降低，每波第一次革命浪潮会建立有时限的街垒。",
      6: "街垒升级为革命公社，容量和持续时间提高，消失时减速并伤害附近敌人。",
    },
  },
  britain: {
    name: "英国",
    max: 6,
    tierNames: { 2: "实验定律", 4: "研究成果", 6: "双重研究" },
    details: {
      2: "英国单位命中任意敌人都会积累证据；6 层定律使其防御 -15% 且不能获得护盾。",
      4: "本波核心未受伤且触发过定律时，下个准备阶段获得一项研究成果。",
      6: "可选择两项不同研究；力学和医学持续两波，政治算术每波最多领取一次。",
    },
  },
};

const tierForCount = (faction: FactionId, count: number) => {
  const thresholds = faction === "greece" ? [2, 4] : [2, 4, 6];
  return thresholds.filter((threshold) => count >= threshold).at(-1) ?? 0;
};

export function SynergyBar({ state, selected, onSelect, onChooseEnlightenment }: { state: GameState; selected: string | null; onSelect: (id: string | null) => void; onChooseEnlightenment: (agendas: EnlightenmentAgenda[]) => void }) {
  const deployed = state.pieces.filter((piece) => piece.slotId.startsWith("deploy-"));
  const snapshot = state.battle?.status === "running" ? state.battle.traitSnapshot : undefined;
  const liveFactionCount = (faction: FactionId) => deployed.filter((piece) => characterById[piece.characterId]?.faction === faction).length;
  const factionCount = (faction: FactionId) => snapshot?.factionCounts[faction] ?? liveFactionCount(faction);

  const items: SynergyItem[] = (Object.keys(factionCopy) as FactionId[]).flatMap((faction) => {
    const count = factionCount(faction);
    const tier = snapshot?.factionTiers[faction] ?? tierForCount(faction, count);
    if (tier < 2) return [];
    const copy = factionCopy[faction];
    return [{ id: faction, title: `${copy.name} · ${copy.tierNames[tier]}`, count: `${count}/${copy.max}`, detail: copy.details[tier] }];
  });

  const dialecticIds = new Set(["socrates", "plato", "fichte", "hegel"]);
  const liveDialectic = deployed.filter((piece) => dialecticIds.has(piece.characterId)).length;
  const dialectic = snapshot?.dialecticCount ?? liveDialectic;
  if (dialectic >= 2) {
    const tier = dialectic >= 4 ? 4 : dialectic >= 3 ? 3 : 2;
    const detail = tier === 4
      ? "矛盾爆发后，触发者的下一次技能会产生 30% 强度的派生效果。"
      : tier === 3
        ? "矛盾爆发时为最低能量的辩证法成员回复能量。"
        : "正常技能叠加矛盾；3 层后降低敌人能量并造成减速。";
    items.push({ id: "dialectic", title: `辩证法 · ${tier} 人`, count: `${dialectic}/4`, detail });
  }

  const smallSnapshot = snapshot ?? createTraitSnapshot(state.pieces, state.preparationPlan);
  const smallMemberIds: Record<SmallSynergyId, string[]> = {
    dialectic: ["socrates", "plato", "fichte", "hegel"], contract: ["rousseau", "locke", "hobbes"], enlightenment: ["rousseau", "locke", "hume", "kant"],
    phenomenology: ["husserl", "heidegger", "sartre"], eudaimonia: ["epicurus", "bentham"], "logical-analysis": ["aristotle", "russell", "wittgenstein"],
  };
  const smallCopy: Record<Exclude<SmallSynergyId, "dialectic">, { title: string; max: number; detail: string }> = {
    contract: { title: "契约共同体", max: 3, detail: "相邻地面成员减伤并一次性分摊伤害；三人时首次濒危提供护盾和嘲讽。" },
    enlightenment: { title: "启蒙", max: 4, detail: "准备阶段确定市场、教育或公民议程；未选时默认公民。" },
    phenomenology: { title: "现象学", max: 3, detail: "共享悬置在致死伤害时保护成员；与真实免死遵循全局优先级。" },
    eudaimonia: { title: "幸福论", max: 2, detail: "直接治疗的过量部分转为最多 15% 最大生命的护盾。" },
    "logical-analysis": { title: "逻辑分析", max: 3, detail: "两名成员共同命中后施加命题；三人时强化罗素原子。" },
  };
  (Object.keys(smallCopy) as Array<Exclude<SmallSynergyId, "dialectic">>).forEach((id) => {
    const tier = smallSnapshot.smallSynergyTiers[id]; if (tier < 2 && !(id === "enlightenment" && tier >= 3)) return;
    const copy = smallCopy[id]; const count = smallSnapshot.unitIds.filter((unitId) => state.pieces.some((piece) => piece.id === unitId && smallMemberIds[id].includes(piece.characterId))).length;
    items.push({ id, title: `${copy.title} · ${tier} 人`, count: `${count}/${copy.max}`, detail: copy.detail });
  });

  const toggleAgenda = (agenda: EnlightenmentAgenda) => {
    const current = state.preparationPlan.enlightenmentAgendas ?? [];
    const maximum = smallSnapshot.smallSynergyTiers.enlightenment >= 4 ? 2 : 1;
    const next = current.includes(agenda) ? current.filter((entry) => entry !== agenda) : current.length >= maximum ? [...current.slice(1), agenda] : [...current, agenda];
    onChooseEnlightenment(next);
  };

  if (!items.length) return null;
  return (
    <div className="synergy-readout">
      {items.map((item) => (
        <button key={item.id} className={selected === item.id ? "active" : ""} onClick={() => onSelect(selected === item.id ? null : item.id)}>
          <b>{item.title}</b>
          <span>{item.count}</span>
          {selected === item.id && <em>{item.detail}</em>}
          {selected === item.id && item.id === "enlightenment" && state.battle?.status !== "running" && (
            <div className="enlightenment-agendas" onClick={(event) => event.stopPropagation()}>
              {(["market", "education", "citizen"] as EnlightenmentAgenda[]).map((agenda) => <span key={agenda} role="button" tabIndex={0} className={state.preparationPlan.enlightenmentAgendas?.includes(agenda) ? "active" : ""} onClick={() => toggleAgenda(agenda)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleAgenda(agenda); } }}>{agenda === "market" ? "市场 +1 金币" : agenda === "education" ? "教育 +2 经验" : "公民 本波护盾"}</span>)}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
