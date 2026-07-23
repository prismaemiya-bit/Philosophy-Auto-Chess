import { advanceBattle, startWave } from "../app/game/battle";
import { characterById } from "../app/game/characters";
import type { PreparationPlan } from "../app/game/combat-core";
import { makeInitialState, type GameState, type Piece, type SlotId } from "../app/game/engine";
import { confirmNormalEvent, chooseRealityStance, chooseReformationReward } from "../app/game/engine";
import { pendingHistoricalDecision } from "../app/game/historical-events";

/** Use formal engine actions to resolve any pending W3 event or W6 stance. */
function resolveHistoricalGate(state: GameState): GameState {
  let current = state;
  const decision = pendingHistoricalDecision(current.historicalEvents, current.wave);
  if (decision === "event") {
    if (current.historicalEvents.eventId === "event:reformation") {
      current = confirmNormalEvent(current).state;
      const candidates = current.historicalEvents.reformationCandidates;
      if (candidates?.length === 3) current = chooseReformationReward(current, candidates[0]!).state;
    } else {
      current = confirmNormalEvent(current).state;
    }
  }
  if (pendingHistoricalDecision(current.historicalEvents, current.wave) === "stance") {
    const stances = current.historicalEvents.stanceCandidateIds;
    if (stances.length === 3) current = chooseRealityStance(current, stances[0]!).state;
  }
  return current;
}

const tickLimit = 2200;
const observationWaves = (process.env.IDEA_GARRISON_SIM_WAVES ?? "3,5,8,9,10").split(",").map(Number).filter((wave) => Number.isInteger(wave) && wave >= 1 && wave <= 10);
const simulationSeeds = (process.env.IDEA_GARRISON_SIM_SEEDS ?? "101,307,503").split(",").map(Number).filter(Number.isFinite);
const mulberry32 = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ next >>> 15, next | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
};

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
  greeceDialecticHybrid: [
    ["socrates", "deploy-1", 2], ["plato", "deploy-3", 2], ["epicurus", "deploy-8", 2], ["fichte", "deploy-10", 2],
    ["aristotle", "deploy-13", 2], ["hegel", "deploy-14", 2], ["kant", "deploy-15", 2], ["schelling", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `gd-${index}`, characterId, slotId, star })) as Piece[],
  greeceLogicalHybrid: [
    ["socrates", "deploy-1", 2], ["plato", "deploy-3", 2], ["epicurus", "deploy-8", 2], ["bentham", "deploy-10", 2],
    ["aristotle", "deploy-13", 2], ["russell", "deploy-14", 2], ["wittgenstein", "deploy-15", 2], ["hume", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `gl-${index}`, characterId, slotId, star })) as Piece[],
  greeceEnlightenmentHybrid: [
    ["socrates", "deploy-1", 2], ["plato", "deploy-3", 2], ["epicurus", "deploy-8", 2], ["rousseau", "deploy-5", 2],
    ["locke", "deploy-9", 2], ["aristotle", "deploy-13", 2], ["hume", "deploy-14", 2], ["kant", "deploy-15", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `ge-${index}`, characterId, slotId, star })) as Piece[],
  britainEvidence: [
    ["locke", "deploy-1", 2], ["hobbes", "deploy-3", 2], ["bentham", "deploy-8", 2], ["locke", "deploy-10", 2],
    ["hume", "deploy-13", 2], ["bacon", "deploy-14", 2], ["russell", "deploy-15", 2], ["wittgenstein", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `br-${index}`, characterId, slotId, star })) as Piece[],
  // Britain remains at its six-unit cap and Logical Analysis stays at two;
  // this isolates Russell from a cheaper highland sniper with the same package.
  britainAristotleInsteadOfRussell: [
    ["locke", "deploy-1", 2], ["hobbes", "deploy-3", 2], ["bentham", "deploy-8", 2], ["locke", "deploy-10", 2],
    ["hume", "deploy-13", 2], ["bacon", "deploy-14", 2], ["aristotle", "deploy-15", 2], ["wittgenstein", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `ba-${index}`, characterId, slotId, star })) as Piece[],
  // Neutral pair: neither candidate activates a faction or small-synergy tier.
  neutralRussell: [
    ["fichte", "deploy-1", 2], ["heidegger", "deploy-3", 2], ["rousseau", "deploy-8", 2], ["sartre", "deploy-10", 2],
    ["descartes", "deploy-13", 2], ["deleuze", "deploy-14", 2], ["derrida", "deploy-15", 2], ["russell", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `nr-${index}`, characterId, slotId, star })) as Piece[],
  neutralAristotle: [
    ["fichte", "deploy-1", 2], ["heidegger", "deploy-3", 2], ["rousseau", "deploy-8", 2], ["sartre", "deploy-10", 2],
    ["descartes", "deploy-13", 2], ["deleuze", "deploy-14", 2], ["derrida", "deploy-15", 2], ["aristotle", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `na-${index}`, characterId, slotId, star })) as Piece[],
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
  francePureTwoStar: [
    ["rousseau", "deploy-1", 2], ["sartre", "deploy-3", 2], ["descartes", "deploy-13", 2], ["foucault", "deploy-14", 2],
    ["deleuze", "deploy-15", 2], ["derrida", "deploy-18", 2], ["lacan", "deploy-19", 2], ["althusser", "deploy-20", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `fp-${index}`, characterId, slotId, star })) as Piece[],
  franceFour: [
    ["rousseau", "deploy-1", 2], ["sartre", "deploy-3", 2], ["descartes", "deploy-13", 2], ["deleuze", "deploy-14", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `f4-${index}`, characterId, slotId, star })) as Piece[],
  franceSix: [
    ["rousseau", "deploy-1", 2], ["sartre", "deploy-3", 2], ["descartes", "deploy-13", 2], ["foucault", "deploy-14", 2],
    ["deleuze", "deploy-15", 2], ["derrida", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `f6-${index}`, characterId, slotId, star })) as Piece[],
  // Both boards keep France six and spend the same gold. Repeated ids do not
  // add trait tiers, so the pair measures two ordinary versus two Fichte fronts.
  franceSixOrdinaryFlex: [
    ["rousseau", "deploy-1", 2], ["sartre", "deploy-3", 2], ["socrates", "deploy-8", 2], ["socrates", "deploy-10", 2],
    ["descartes", "deploy-13", 2], ["foucault", "deploy-14", 2], ["deleuze", "deploy-15", 2], ["derrida", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `fo-${index}`, characterId, slotId, star })) as Piece[],
  franceSixFichteFlex: [
    ["rousseau", "deploy-1", 2], ["sartre", "deploy-3", 2], ["fichte", "deploy-8", 2], ["fichte", "deploy-10", 2],
    ["descartes", "deploy-13", 2], ["foucault", "deploy-14", 2], ["deleuze", "deploy-15", 2], ["derrida", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `ff-${index}`, characterId, slotId, star })) as Piece[],
  // Six all-highland French units preserve France six while the flex pair
  // compares the two three-cost, block-three tanks without extra small traits.
  franceSixHobbesFlex: [
    ["hobbes", "deploy-1", 2], ["hobbes", "deploy-3", 2], ["descartes", "deploy-13", 2], ["foucault", "deploy-14", 2],
    ["althusser", "deploy-15", 2], ["deleuze", "deploy-18", 2], ["derrida", "deploy-19", 2], ["lacan", "deploy-20", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `fh-${index}`, characterId, slotId, star })) as Piece[],
  franceSixHeideggerFlex: [
    ["heidegger", "deploy-1", 2], ["heidegger", "deploy-3", 2], ["descartes", "deploy-13", 2], ["foucault", "deploy-14", 2],
    ["althusser", "deploy-15", 2], ["deleuze", "deploy-18", 2], ["derrida", "deploy-19", 2], ["lacan", "deploy-20", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `fd-${index}`, characterId, slotId, star })) as Piece[],
  franceContract: [
    ["rousseau", "deploy-1", 2], ["sartre", "deploy-3", 2], ["hobbes", "deploy-8", 2], ["locke", "deploy-10", 2],
    ["descartes", "deploy-13", 2], ["deleuze", "deploy-14", 2], ["derrida", "deploy-15", 2], ["hume", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `fc-${index}`, characterId, slotId, star })) as Piece[],
  franceEnlightenment: [
    ["rousseau", "deploy-1", 2], ["sartre", "deploy-3", 2], ["locke", "deploy-8", 2], ["epicurus", "deploy-10", 2],
    ["descartes", "deploy-13", 2], ["hume", "deploy-14", 2], ["kant", "deploy-15", 2], ["deleuze", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `fe-${index}`, characterId, slotId, star })) as Piece[],
  ordinaryFrontline: [
    ["socrates", "deploy-1", 2], ["sartre", "deploy-3", 2], ["rousseau", "deploy-8", 2], ["epicurus", "deploy-10", 2],
    ["hume", "deploy-13", 2], ["russell", "deploy-14", 2], ["bacon", "deploy-15", 2], ["kant", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `of-${index}`, characterId, slotId, star })) as Piece[],
  highBlockFrontline: [
    ["fichte", "deploy-1", 2], ["hobbes", "deploy-3", 2], ["rousseau", "deploy-8", 2], ["epicurus", "deploy-10", 2],
    ["hume", "deploy-13", 2], ["russell", "deploy-14", 2], ["bacon", "deploy-15", 2], ["kant", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `hf-${index}`, characterId, slotId, star })) as Piece[],
  clearWithOrdinaryFront: [
    ["socrates", "deploy-1", 2], ["sartre", "deploy-3", 2], ["rousseau", "deploy-8", 2], ["plato", "deploy-10", 2],
    ["schelling", "deploy-13", 2], ["hegel", "deploy-14", 2], ["deleuze", "deploy-15", 2], ["bacon", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `cl-${index}`, characterId, slotId, star })) as Piece[],
  sustainWithOrdinaryFront: [
    ["socrates", "deploy-1", 2], ["sartre", "deploy-3", 2], ["rousseau", "deploy-8", 2], ["epicurus", "deploy-10", 2],
    ["husserl", "deploy-13", 2], ["locke", "deploy-14", 2], ["hume", "deploy-15", 2], ["bentham", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `su-${index}`, characterId, slotId, star })) as Piece[],
  // Same nominal roster value and the same France 4 / Germany 2 faction tiers.
  // Repeated Fichte/Sartre ids add no trait count, so this isolates whether
  // Eudaimonia 2 earns its two flex slots in an otherwise functional board.
  balancedEudaimonia: [
    ["fichte", "deploy-1", 2], ["sartre", "deploy-3", 2], ["epicurus", "deploy-8", 2], ["bentham", "deploy-10", 2],
    ["descartes", "deploy-13", 2], ["deleuze", "deploy-14", 2], ["derrida", "deploy-15", 2], ["hegel", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `be-${index}`, characterId, slotId, star })) as Piece[],
  balancedNoEudaimonia: [
    ["fichte", "deploy-1", 2], ["sartre", "deploy-3", 2], ["fichte", "deploy-8", 2], ["sartre", "deploy-10", 2],
    ["descartes", "deploy-13", 2], ["deleuze", "deploy-14", 2], ["derrida", "deploy-15", 2], ["hegel", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `bn-${index}`, characterId, slotId, star })) as Piece[],
  // Equal nominal roster value and equal Germany/Britain/France faction tiers.
  // The off-board deliberately spends its package on three high-block tanks;
  // this asks whether Phenomenology 3 can compete without copying that plan.
  balancedPhenomenology: [
    ["husserl", "deploy-1", 2], ["heidegger", "deploy-3", 2], ["sartre", "deploy-8", 2], ["epicurus", "deploy-10", 2],
    ["descartes", "deploy-13", 2], ["bacon", "deploy-14", 2], ["deleuze", "deploy-15", 2], ["wittgenstein", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `bp-${index}`, characterId, slotId, star })) as Piece[],
  balancedHighBlockPackage: [
    ["fichte", "deploy-1", 2], ["heidegger", "deploy-3", 2], ["hobbes", "deploy-8", 2], ["epicurus", "deploy-10", 2],
    ["descartes", "deploy-13", 2], ["bacon", "deploy-14", 2], ["deleuze", "deploy-15", 2], ["wittgenstein", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `bh-${index}`, characterId, slotId, star })) as Piece[],
  descartesKing: [
    ["plato", "deploy-1", 2], ["descartes", "throne-1", 2], ["rousseau", "deploy-8", 2], ["epicurus", "deploy-10", 2],
    ["hume", "deploy-13", 2], ["russell", "deploy-14", 2], ["bacon", "deploy-15", 2], ["hegel", "deploy-18", 2],
  ].map(([characterId, slotId, star], index) => ({ id: `dk-${index}`, characterId, slotId, star, ...(slotId === "throne-1" ? { throneReturnSlot: "deploy-3" } : {}) })) as Piece[],
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
  const prepped = resolveHistoricalGate(state);
  const initialIds = new Set(prepped.pieces.map((piece) => piece.id));
  const minimumHealthRatio: Record<string, number> = Object.fromEntries(prepped.pieces.map((piece) => [piece.id, 1]));
  const firstDeathTick: Record<string, number> = {};
  let current = startWave(prepped).state;
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
  for (const seed of simulationSeeds) {
    console.log(`\n== ${name} / seed ${seed} ==`);
    for (const wave of observationWaves) {
      const base = makeInitialState(mulberry32(seed));
      const preparationPlan: PreparationPlan = name === "franceEnlightenment"
        ? { ...base.preparationPlan, enlightenmentAgendas: ["education", "citizen"] }
        : base.preparationPlan;
      const result = runWave({ ...base, wave, level: Math.min(8, Math.max(3, pieces.length)), gold: 16, pieces: pieces.map((piece) => ({ ...piece, slotId: piece.slotId as SlotId })), preparationPlan });
      const state = result.state;
      const summary = state.battle?.summary;
      const report = state.balanceHistory?.at(-1);
      const unitRows = Object.entries(summary?.statistics.units ?? {});
      console.log(JSON.stringify({
        formation: name,
        seed,
        wave,
        status: state.battle?.status,
        coreHp: state.coreHp,
        gold: state.gold,
        level: state.level,
        rosterValue: rosterValue(state.pieces),
        stars: [1, 2, 3].map((star) => state.pieces.filter((piece) => piece.star === star).length),
        income: summary ? { killGold: summary.killGold, baseIncome: summary.baseIncome, interest: summary.interest, perfectBonus: summary.perfectBonus, totalGold: summary.totalGold } : undefined,
        traitTiers: state.battle?.traitSnapshot ? { factions: state.battle.traitSnapshot.factionTiers, small: state.battle.traitSnapshot.smallSynergyTiers } : undefined,
        synergyTriggers: summary?.synergyTriggers,
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
}
