import { advanceBattle, startWave } from "../app/game/battle";
import { characterById } from "../app/game/characters";
import { makeInitialState, type GameState, type Piece, type SlotId } from "../app/game/engine";

const tickLimit = 2200;

const formations: Record<string, Piece[]> = {
  franceControl: [
    ["rousseau", "deploy-1", 3], ["sartre", "deploy-3", 3], ["descartes", "deploy-13", 3], ["foucault", "deploy-14", 2],
    ["deleuze", "deploy-15", 2], ["derrida", "deploy-18", 2], ["lacan", "deploy-19", 2], ["althusser", "deploy-20", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `fr-${index}`, characterId, slotId, star })) as Piece[],
  mixedResearch: [
    ["fichte", "deploy-1", 2], ["hobbes", "deploy-3", 2], ["rousseau", "deploy-8", 2], ["epicurus", "deploy-10", 2],
    ["hume", "deploy-13", 2], ["russell", "deploy-14", 2], ["bacon", "deploy-15", 2], ["kant", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `mx-${index}`, characterId, slotId, star })) as Piece[],
  germanLate: [
    ["fichte", "deploy-1", 2], ["heidegger", "deploy-3", 2], ["hobbes", "deploy-8", 2], ["socrates", "deploy-10", 2],
    ["husserl", "deploy-13", 2], ["schelling", "deploy-14", 2], ["kant", "deploy-15", 2], ["hegel", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `ge-${index}`, characterId, slotId, star })) as Piece[],
  incoherent: [
    ["epicurus", "deploy-1", 1], ["hobbes", "deploy-3", 1], ["rousseau", "deploy-8", 1], ["locke", "deploy-10", 1],
    ["aristotle", "deploy-13", 1], ["schelling", "deploy-15", 1], ["descartes", "deploy-18", 1], ["hume", "deploy-20", 1],
  ].map(([characterId, slotId, star], index) => ({ id: `bad-${index}`, characterId, slotId, star })) as Piece[],
};

function runWave(state: GameState) {
  let current = startWave(state).state;
  for (let tick = 0; tick < tickLimit && current.battle?.status === "running"; tick += 1) current = advanceBattle(current);
  return current;
}

function rosterValue(pieces: Piece[]) {
  const stars = { 1: 1, 2: 3, 3: 9 } as const;
  return pieces.reduce((sum, piece) => sum + characterById[piece.characterId].cost * stars[piece.star], 0);
}

for (const [name, pieces] of Object.entries(formations)) {
  console.log(`\n== ${name} ==`);
  for (const wave of [3, 5, 8, 10]) {
    const state = runWave({ ...makeInitialState(), wave, level: Math.min(8, Math.max(3, pieces.length)), gold: 16, pieces: pieces.map((piece) => ({ ...piece, slotId: piece.slotId as SlotId })) });
    const summary = state.battle?.summary;
    console.log(JSON.stringify({
      wave,
      status: state.battle?.status,
      coreHp: state.coreHp,
      gold: state.gold,
      level: state.level,
      rosterValue: rosterValue(state.pieces),
      stars: [1, 2, 3].map((star) => state.pieces.filter((piece) => piece.star === star).length),
      income: summary ? { killGold: summary.killGold, baseIncome: summary.baseIncome, interest: summary.interest, perfectBonus: summary.perfectBonus, totalGold: summary.totalGold } : undefined,
      routes: summary?.statistics.routes,
      topUnits: Object.entries(summary?.statistics.units ?? {}).sort(([, a], [, b]) => b.damage - a.damage).slice(0, 3),
    }));
  }
}
