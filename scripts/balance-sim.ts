import { advanceBattle, startWave } from "../app/game/battle";
import { characterById } from "../app/game/characters";
import { makeInitialState, type GameState, type Piece, type SlotId } from "../app/game/engine";

const tickLimit = 2200;
const observationWaves = (process.env.IDEA_GARRISON_SIM_WAVES ?? "3,5,8,9,10").split(",").map(Number).filter((wave) => Number.isInteger(wave) && wave >= 1 && wave <= 10);

const formations: Record<string, Piece[]> = {
  earlyGreedy: [
    ["fichte", "deploy-1", 1], ["aristotle", "deploy-13", 1],
  ].map(([characterId, slotId, star], index) => ({ id: `eg-${index}`, characterId, slotId, star })) as Piece[],
  earlySpread: [
    ["fichte", "deploy-1", 1], ["epicurus", "deploy-8", 1], ["aristotle", "deploy-13", 1], ["descartes", "deploy-15", 1],
  ].map(([characterId, slotId, star], index) => ({ id: `es-${index}`, characterId, slotId, star })) as Piece[],
  earlyUpgraded: [
    ["fichte", "deploy-1", 2], ["socrates", "deploy-3", 1], ["aristotle", "deploy-13", 2], ["descartes", "deploy-15", 1],
  ].map(([characterId, slotId, star], index) => ({ id: `eu-${index}`, characterId, slotId, star })) as Piece[],
  greeceControl: [
    ["socrates", "deploy-1", 2], ["plato", "deploy-3", 2], ["epicurus", "deploy-8", 2], ["socrates", "deploy-10", 2],
    ["aristotle", "deploy-13", 2], ["aristotle", "deploy-14", 2], ["plato", "deploy-5", 2], ["epicurus", "deploy-9", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `gr-${index}`, characterId, slotId, star })) as Piece[],
  britainEvidence: [
    ["locke", "deploy-1", 2], ["hobbes", "deploy-3", 2], ["bentham", "deploy-8", 2], ["locke", "deploy-10", 2],
    ["hume", "deploy-13", 2], ["bacon", "deploy-14", 2], ["russell", "deploy-15", 2], ["wittgenstein", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `br-${index}`, characterId, slotId, star })) as Piece[],
  noKingBaseline: [
    ["plato", "deploy-1", 2], ["fichte", "deploy-3", 2], ["rousseau", "deploy-8", 2], ["epicurus", "deploy-10", 2],
    ["hume", "deploy-13", 2], ["russell", "deploy-14", 2], ["bacon", "deploy-15", 2], ["hegel", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `nk-${index}`, characterId, slotId, star })) as Piece[],
  fichteKing: [
    ["plato", "deploy-1", 2], ["fichte", "throne-1", 2], ["rousseau", "deploy-8", 2], ["epicurus", "deploy-10", 2],
    ["hume", "deploy-13", 2], ["russell", "deploy-14", 2], ["bacon", "deploy-15", 2], ["hegel", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `kg-${index}`, characterId, slotId, star, ...(slotId === "throne-1" ? { throneReturnSlot: "deploy-3" } : {}) })) as Piece[],
  franceControl: [
    ["rousseau", "deploy-1", 3], ["sartre", "deploy-3", 3], ["descartes", "deploy-13", 3], ["foucault", "deploy-14", 2],
    ["deleuze", "deploy-15", 2], ["derrida", "deploy-18", 2], ["lacan", "deploy-19", 2], ["althusser", "deploy-20", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `fr-${index}`, characterId, slotId, star })) as Piece[],
  mixedTwoStar: [
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

const requestedFormations = new Set((process.env.IDEA_GARRISON_SIM_FORMATIONS ?? "").split(",").filter(Boolean));

function runWave(state: GameState) {
  const initialIds = new Set(state.pieces.map((piece) => piece.id));
  const minimumHealthRatio: Record<string, number> = Object.fromEntries(state.pieces.map((piece) => [piece.id, 1]));
  const firstDeathTick: Record<string, number> = {};
  let current = startWave(state).state;
  let elapsedTicks = 0;
  for (let tick = 0; tick < tickLimit && current.battle?.status === "running"; tick += 1) {
    current = advanceBattle(current); elapsedTicks = tick + 1;
    const live = new Set(current.pieces.map((piece) => piece.id));
    for (const piece of current.pieces) {
      const ratio = (piece.hp ?? piece.maxHp ?? 1) / Math.max(1, piece.maxHp ?? 1);
      minimumHealthRatio[piece.id] = Math.min(minimumHealthRatio[piece.id] ?? 1, ratio);
    }
    for (const id of initialIds) if (!live.has(id) && firstDeathTick[id] === undefined) { firstDeathTick[id] = tick + 1; minimumHealthRatio[id] = 0; }
  }
  return { state: current, elapsedTicks, minimumHealthRatio, firstDeathTick };
}

function rosterValue(pieces: Piece[]) {
  const stars = { 1: 1, 2: 3, 3: 9 } as const;
  return pieces.reduce((sum, piece) => sum + characterById[piece.characterId].cost * stars[piece.star], 0);
}

for (const [name, pieces] of Object.entries(formations)) {
  if (requestedFormations.size && !requestedFormations.has(name)) continue;
  console.log(`\n== ${name} ==`);
  for (const wave of observationWaves) {
    const result = runWave({ ...makeInitialState(), wave, level: Math.min(8, Math.max(3, pieces.length)), gold: 16, pieces: pieces.map((piece) => ({ ...piece, slotId: piece.slotId as SlotId })) });
    const state = result.state;
    const summary = state.battle?.summary;
    const report = state.balanceHistory?.at(-1);
    const unitRows = Object.entries(summary?.statistics.units ?? {});
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
      remainingEnemies: state.battle?.enemies.filter((enemy) => enemy.hp > 0).length ?? 0,
      postBattle: report ? { economy: report.economy, outcome: report.outcome, philosopherKing: report.philosopherKing } : undefined,
      survivability: {
        elapsedTicks: result.elapsedTicks,
        elapsedSeconds: Number((result.elapsedTicks * .24).toFixed(2)),
        deaths: Object.keys(result.firstDeathTick).length,
        firstDeathTick: result.firstDeathTick,
        minimumHealthRatio: Object.fromEntries(Object.entries(result.minimumHealthRatio).map(([id, ratio]) => [id, Number(ratio.toFixed(3))])),
      },
      topDamage: unitRows.sort(([, a], [, b]) => b.damage - a.damage).slice(0, 3),
      topFrontline: [...unitRows].sort(([, a], [, b]) => (b.damageTaken + b.blockedWeight) - (a.damageTaken + a.blockedWeight)).slice(0, 3),
    }));
  }
}
