import { enemyAssets, characterAssets, characterTraits, skillDetails } from "./assets";
import { enemyTemplates, type Enemy } from "./battle";
import { characterById } from "./characters";
import type { Piece } from "./engine";

export function BattleInspector({ piece, enemy }: { piece?: Piece; enemy?: Enemy }) {
  const unit = piece ? characterById[piece.characterId] : undefined;
  if (piece && unit) {
    const asset = characterAssets[unit.id];
    return <aside className={`battle-inspector unit accent-${asset?.accent}`}>
      <div className="inspector-title"><span>{asset?.glyph ?? unit.portrait}</span><div><small>已选部署单位</small><strong>{unit.name}　{piece.star}★</strong></div></div>
      <div className="inspector-tags">{characterTraits[unit.id]?.map((trait) => <b key={trait}>{trait}</b>)}<b>{unit.terrain === "ground" ? "地面" : "高台"}</b></div>
      <div className="inspector-stats"><span>费用 <b>{unit.cost}</b></span><span>射程 <b>{unit.combat.range}</b></span><span>阻挡 <b>{unit.block + (piece.blockBonus ?? 0)}</b></span><span>生命 <b>{Math.ceil(piece.hp ?? unit.stats.resolve)}/{piece.maxHp ?? unit.stats.resolve}</b></span></div>
      <p><b>{unit.skill.name}</b>：{skillDetails[unit.id] ?? unit.skill.summary}</p><em>圆形虚线为攻击范围；地面单位可阻挡，高台单位阻挡为 0。</em>
    </aside>;
  }
  if (enemy) {
    const template = enemyTemplates[enemy.kind]; const asset = enemyAssets[enemy.kind];
    return <aside className={`battle-inspector enemy accent-${asset.accent}`}>
      <div className="inspector-title"><span>{asset.glyph}</span><div><small>{enemy.lane === "upper" ? "入口 A / 汇合上路" : enemy.lane === "lower" ? "入口 B / 汇合下路" : "入口 C / 独立侧路"}</small><strong>{template.name}</strong></div></div>
      <div className="inspector-tags"><b>{asset.label}</b><b>{enemy.blockedBy ? "正在被阻挡" : "行进中"}</b></div>
      <div className="inspector-stats"><span>生命 <b>{Math.max(0, Math.ceil(enemy.hp))}/{enemy.maxHp}</b></span><span>护甲 <b>{asset.armor ?? 0}</b></span><span>速度 <b>{asset.speed}</b></span><span>权重 <b>{enemy.weight}</b></span></div>
      <p><b>特性</b>：{asset.trait}。抵达哲人之石造成 {template.coreDamage} 点损伤。</p>{enemy.kind === "boss" && <p><b>阶段</b>：{enemy.bossPhasesTriggered?.length ? enemy.bossPhasesTriggered.join(" → ") : "尚未触发"}。阶段效果仍遵循固定路线、阻挡和事件队列。</p>}<em>{enemy.blockedBy ? "敌人已被地面单位接战，会停下攻击。" : "点击另一敌人或部署单位切换查看。"}</em>
    </aside>;
  }
  return null;
}
