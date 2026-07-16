"use client";

import { useEffect, useState } from "react";
import { enemyTemplates, type BattleState, type BattleSummary, type Enemy } from "./battle";
import { characterById } from "./characters";
import type { Piece } from "./engine";

export function unitBuffs(piece: Piece | undefined, battle: BattleState) {
  if (!piece) return [] as string[];
  const unit = characterById[piece.characterId]; if (!unit) return [] as string[];
  const buffs: string[] = [];
  if (unit.faction === "germany" && battle.concepts > 0) buffs.push("◆");
  if (unit.faction === "greece" && battle.factionCasts.includes("greece")) buffs.push("◌");
  if (unit.faction === "france" && battle.frenchArguments > 0) buffs.push("✦");
  if (unit.faction === "britain" && battle.britishEvidence > 0) buffs.push("▤");
  if ((piece.shield ?? 0) > 0) buffs.push("⬡");
  if (piece.empoweredSkill) buffs.push("✧");
  return buffs;
}

export function UnitCombatStatus({ piece, target }: { piece?: Piece; target?: Enemy }) {
  if (!piece) return null;
  const unit = characterById[piece.characterId]; if (!unit) return null;
  const energy = piece.energy ?? 0; const maximum = piece.maxEnergy ?? unit.combat.maxEnergy;
  return <div className="unit-combat-status"><span>能量 <b>{energy}/{maximum}</b></span><span>技能 <b>{energy >= maximum ? "就绪" : "充能中"}</b></span><span>当前目标 <b>{target ? enemyTemplates[target.kind].name : "范围内无目标"}</b></span></div>;
}

export function WaveToast({ summary }: { summary: BattleSummary }) {
  const [expanded, setExpanded] = useState(true);
  useEffect(() => { const timer = window.setTimeout(() => setExpanded(false), 1000); return () => window.clearTimeout(timer); }, []);
  return <div className={`wave-toast ${expanded ? "expanded" : "collapsed"}`}><b>{summary.success ? "波次肃清" : "防线失守"}</b><span>{summary.success ? `+${summary.totalGold} 金币` : `核心损伤 ${summary.coreDamage}`}</span></div>;
}
