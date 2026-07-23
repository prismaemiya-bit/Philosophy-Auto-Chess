import { advanceBattle, startWave } from "../app/game/battle";
import { characterById, characters } from "../app/game/characters";
import { BENCH_SLOTS, DEPLOY_SLOTS, ECONOMY_RULES, MAX_LEVEL, buy, gainXp, interestForGold, makeInitialState, maxDeployForLevel, refresh, type GameState, type Piece, type SlotId } from "../app/game/engine";
import { slotTerrain } from "../app/game/positions";

type StrategyId = "save-interest" | "early-reroll" | "fast-level" | "casual-spend";
type ArchetypeId =
  | "balanced"
  | "greece-only"
  | "greece-dialectic"
  | "greece-logical"
  | "greece-enlightenment"
  | "germany-only"
  | "france-only"
  | "britain-only";

const allStrategies: StrategyId[] = ["save-interest", "early-reroll", "fast-level", "casual-spend"];
const seeds = (process.env.IDEA_GARRISON_ECONOMY_SEEDS ?? "101,211,307,401,503,601,701,809")
  .split(",").map(Number).filter(Number.isFinite);
const simulationMaxWave = Math.min(10, Math.max(1, Number(process.env.IDEA_GARRISON_ECONOMY_MAX_WAVE ?? 10) || 10));
const tickLimit = 2400;
const archetypes: Record<ArchetypeId, string[]> = {
  balanced: ["fichte", "aristotle", "epicurus", "plato", "schelling", "heidegger", "kant", "hegel"],
  "greece-only": ["socrates", "plato", "aristotle", "epicurus"],
  "greece-dialectic": ["socrates", "plato", "aristotle", "epicurus", "fichte", "hegel", "kant", "schelling"],
  "greece-logical": ["socrates", "plato", "aristotle", "epicurus", "bentham", "russell", "wittgenstein", "hume"],
  "greece-enlightenment": ["socrates", "plato", "aristotle", "epicurus", "rousseau", "locke", "hume", "kant"],
  "germany-only": ["fichte", "schelling", "kant", "hegel", "husserl", "heidegger"],
  "france-only": ["rousseau", "sartre", "descartes", "foucault", "althusser", "deleuze", "derrida", "lacan"],
  "britain-only": ["locke", "bacon", "hume", "hobbes", "bentham", "russell", "wittgenstein"],
};
const allArchetypes = Object.keys(archetypes) as ArchetypeId[];
const requestedStrategies = new Set((process.env.IDEA_GARRISON_ECONOMY_STRATEGIES ?? "").split(",").filter(Boolean));
const requestedArchetypes = new Set((process.env.IDEA_GARRISON_ECONOMY_ARCHETYPES ?? "").split(",").filter(Boolean));
const strategies = allStrategies.filter((strategy) => !requestedStrategies.size || requestedStrategies.has(strategy));
const selectedArchetypes = allArchetypes.filter((archetype) => !requestedArchetypes.size || requestedArchetypes.has(archetype));

const mulberry32 = (seed: number) => {
  let value = seed >>> 0;
  return () => { value += 0x6d2b79f5; let next = value; next = Math.imul(next ^ next >>> 15, next | 1); next ^= next + Math.imul(next ^ next >>> 7, next | 61); return ((next ^ next >>> 14) >>> 0) / 4294967296; };
};

const copyValue = (piece: Piece) => piece.star === 1 ? 1 : piece.star === 2 ? 3 : 9;
const rosterValue = (pieces: Piece[]) => pieces.reduce((sum, piece) => sum + characterById[piece.characterId].cost * copyValue(piece), 0);

function canonicalizePieceIds(state: GameState): GameState {
  const order = [...state.pieces].sort((left, right) => left.characterId.localeCompare(right.characterId) || right.star - left.star || left.slotId.localeCompare(right.slotId));
  const ids = new Map(order.map((piece, index) => [piece.id, `economy-piece-${String(index + 1).padStart(2, "0")}`]));
  return { ...state, pieces: state.pieces.map((piece) => ({ ...piece, id: ids.get(piece.id) ?? piece.id })) };
}

function fieldBest(state: GameState, priorities: string[]): GameState {
  const capacity = maxDeployForLevel(state.level);
  const rank = (piece: Piece) => { const index = priorities.indexOf(piece.characterId); return piece.star * 100 - (index >= 0 ? index : 100); };
  const ground = [...state.pieces].filter((piece) => characterById[piece.characterId].terrain === "ground").sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));
  const highland = [...state.pieces].filter((piece) => characterById[piece.characterId].terrain === "highland").sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));
  const groundTarget = Math.min(ground.length, Math.max(1, Math.ceil(capacity / 2)));
  const selected = [...ground.slice(0, groundTarget), ...highland.slice(0, Math.max(0, capacity - groundTarget))];
  while (selected.length < capacity) {
    const next = [...ground.slice(groundTarget), ...highland.slice(Math.max(0, capacity - groundTarget))].find((piece) => !selected.includes(piece));
    if (!next) break;
    selected.push(next);
  }
  const selectedIds = new Set(selected.map((piece) => piece.id));
  const groundSlots = DEPLOY_SLOTS.filter((slot) => slotTerrain[slot] === "ground");
  const highlandSlots = DEPLOY_SLOTS.filter((slot) => slotTerrain[slot] === "highland");
  let groundIndex = 0; let highlandIndex = 0; let benchIndex = 0;
  const pieces = state.pieces.map((piece) => {
    if (selectedIds.has(piece.id)) {
      const slotId = characterById[piece.characterId].terrain === "ground" ? groundSlots[groundIndex++] : highlandSlots[highlandIndex++];
      return { ...piece, slotId: slotId as SlotId };
    }
    return { ...piece, slotId: (BENCH_SLOTS[benchIndex++] ?? piece.slotId) as SlotId };
  });
  return { ...state, pieces };
}

function buyTargets(state: GameState, priorities: string[], floor: number, maxPurchases = 99) {
  let current = canonicalizePieceIds(state); let purchases = 0; let changed = true;
  while (changed && purchases < maxPurchases) {
    changed = false;
    for (const characterId of priorities) {
      const index = current.shop.findIndex((id) => id === characterId);
      if (index < 0 || current.gold - characterById[characterId].cost < floor) continue;
      const result = buy(current, index);
      if (!result.ok) continue;
      current = canonicalizePieceIds(result.state); purchases += 1; changed = true; break;
    }
  }
  return current;
}

function prepare(state: GameState, strategy: StrategyId, priorities: string[], random: () => number) {
  let current = state;
  const marketPriorities = [...priorities, ...characters.map((character) => character.id).filter((id) => !priorities.includes(id)).sort((left, right) => characterById[left].cost - characterById[right].cost || left.localeCompare(right))];
  if (strategy === "save-interest") {
    current = buyTargets(current, marketPriorities, current.wave === 1 ? 0 : 15, current.wave === 1 ? 2 : 99);
  } else if (strategy === "early-reroll") {
    current = buyTargets(current, marketPriorities, 3);
    const refreshLimit = current.wave <= 5 ? 4 : 1;
    for (let count = 0; count < refreshLimit && current.gold >= ECONOMY_RULES.refreshCost + 3; count += 1) {
      const rolled = refresh(current, random); if (!rolled.ok) break;
      current = buyTargets(rolled.state, marketPriorities, 3);
    }
  } else if (strategy === "fast-level") {
    current = buyTargets(current, marketPriorities, 6, Math.max(2, maxDeployForLevel(current.level) - current.pieces.length));
    while (current.wave > 1 && current.level < MAX_LEVEL && current.gold >= ECONOMY_RULES.experienceCost + 6) {
      const result = gainXp(current); if (!result.ok) break; current = result.state;
    }
    current = buyTargets(current, marketPriorities, 6);
  } else {
    current = buyTargets(current, marketPriorities, 5);
    if (current.wave > 1 && current.gold >= 14 && current.level < MAX_LEVEL) current = gainXp(current).state;
    if (current.wave > 1 && current.gold >= 12) current = buyTargets(refresh(current, random).state, marketPriorities, 5);
  }
  return fieldBest(current, priorities);
}

function runWave(state: GameState, random: () => number) {
  let current = startWave(state).state;
  let deaths = 0;
  for (let tick = 0; tick < tickLimit && current.battle?.status === "running"; tick += 1) {
    const before = current.pieces.length;
    current = advanceBattle(current, random);
    deaths += Math.max(0, before - current.pieces.length);
  }
  return { state: current, deaths };
}

type WaveRow = {
  wave: number; startGold: number; endGold: number; baseIncome: number; interest: number; overflow: number;
  purchasesGold: number; refreshes: number; refreshGold: number; xpPurchases: number; xpGold: number;
  level: number; xp: number; population: number; stars: [number, number, number]; rosterValue: number;
  success: boolean; coreHp: number; deaths: number;
};

function simulate(strategy: StrategyId, archetype: ArchetypeId, seed: number) {
  const random = mulberry32(seed);
  let state = makeInitialState(random);
  // Economy comparisons must not silently inherit a random event or ideology.
  // The dedicated historical-event simulation owns those cross-effects.
  state = {
    ...state,
    historicalEvents: {
      ...state.historicalEvents,
      eventPresented: true,
      eventResolved: true,
      stanceCandidateIds: ["stance:conservatism", "stance:reformism", "stance:liberalism"],
      stancePresented: true,
      selectedStanceId: "stance:conservatism",
    },
  };
  const priorities = archetypes[archetype];
  const firstSeen: Record<string, number> = {}; const firstTwoStar: Record<string, number> = {}; const firstThreeStar: Record<string, number> = {};
  const waves: WaveRow[] = [];
  for (let wave = 1; wave <= simulationMaxWave; wave += 1) {
    if (state.wave !== wave || state.coreHp <= 0) break;
    state = prepare(state, strategy, priorities, random);
    for (const piece of state.pieces) {
      firstSeen[piece.characterId] ??= wave;
      if (piece.star >= 2) firstTwoStar[piece.characterId] ??= wave;
      if (piece.star >= 3) firstThreeStar[piece.characterId] ??= wave;
    }
    const startGold = state.gold;
    const ledger = state.waveEconomy ?? { purchasesGold: 0, refreshes: 0, xpPurchases: 0, researchGold: 0 };
    const result = runWave(state, random); state = result.state;
    const summary = state.battle?.summary;
    const income = summary ? summary.killGold + summary.baseIncome + summary.interest + summary.perfectBonus : 0;
    const deployed = state.pieces.filter((piece) => piece.slotId.startsWith("deploy-") || piece.slotId === "throne-1").length;
    waves.push({
      wave, startGold, endGold: state.gold, baseIncome: summary?.baseIncome ?? 0, interest: summary?.interest ?? 0,
      overflow: Math.max(0, income - (summary?.totalGold ?? 0)), purchasesGold: ledger.purchasesGold,
      refreshes: ledger.refreshes, refreshGold: ledger.refreshes * ECONOMY_RULES.refreshCost,
      xpPurchases: ledger.xpPurchases, xpGold: ledger.xpPurchases * ECONOMY_RULES.experienceCost,
      level: state.level, xp: state.xp, population: deployed,
      stars: [1, 2, 3].map((star) => state.pieces.filter((piece) => piece.star === star).length) as [number, number, number],
      rosterValue: rosterValue(state.pieces), success: summary?.success === true, coreHp: state.coreHp, deaths: result.deaths,
    });
    if (!summary?.success) break;
    state = { ...state, battle: undefined, waveCheckpoint: undefined };
  }
  return { strategy, archetype, seed, waves, firstSeen, firstTwoStar, firstThreeStar };
}

const runs = strategies.flatMap((strategy) => selectedArchetypes.flatMap((archetype) => seeds.map((seed) => simulate(strategy, archetype, seed))));
const replay = strategies.flatMap((strategy) => selectedArchetypes.flatMap((archetype) => seeds.map((seed) => simulate(strategy, archetype, seed))));
if (JSON.stringify(runs) !== JSON.stringify(replay)) throw new Error("economy simulation is not deterministic");

const checkpoints = [2, 5, 8, 10];
const summary = strategies.map((strategy) => {
  const group = runs.filter((run) => run.strategy === strategy);
  const average = (values: number[]) => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null;
  return {
    strategy,
    runs: group.length,
    reached: Object.fromEntries(checkpoints.map((wave) => [wave, group.filter((run) => run.waves.some((row) => row.wave === wave)).length])),
    cleared: Object.fromEntries(checkpoints.map((wave) => [wave, group.filter((run) => run.waves.find((row) => row.wave === wave)?.success).length])),
    checkpoints: Object.fromEntries(checkpoints.map((wave) => {
      const rows = group.flatMap((run) => run.waves.filter((row) => row.wave === wave));
      return [wave, { gold: average(rows.map((row) => row.endGold)), level: average(rows.map((row) => row.level)), population: average(rows.map((row) => row.population)), stars: [0, 1, 2].map((index) => average(rows.map((row) => row.stars[index]))), rosterValue: average(rows.map((row) => row.rosterValue)), coreHp: average(rows.map((row) => row.coreHp)), coreHpRange: rows.length ? [Math.min(...rows.map((row) => row.coreHp)), Math.max(...rows.map((row) => row.coreHp))] : null, overflow: average(rows.map((row) => row.overflow)) }];
    })),
    fullInterestAtWave2: group.filter((run) => interestForGold(run.waves.find((row) => row.wave === 2)?.startGold ?? 0) === ECONOMY_RULES.maxInterest).length,
    firstEightPopulationWave: average(group.flatMap((run) => { const row = run.waves.find((wave) => wave.population >= 8); return row ? [row.wave] : []; })),
    byArchetype: Object.fromEntries(selectedArchetypes.map((archetype) => {
      const subset = group.filter((run) => run.archetype === archetype);
      const coreIds = archetypes[archetype].slice(0, 2);
      return [archetype, {
        clearedW10: subset.filter((run) => run.waves.find((row) => row.wave === 10)?.success).length,
        reachedW10: subset.filter((run) => run.waves.some((row) => row.wave === 10)).length,
        coreTiming: Object.fromEntries(coreIds.map((id) => [id, { firstSeen: average(subset.flatMap((run) => run.firstSeen[id] ? [run.firstSeen[id]] : [])), firstTwoStar: average(subset.flatMap((run) => run.firstTwoStar[id] ? [run.firstTwoStar[id]] : [])), firstThreeStar: average(subset.flatMap((run) => run.firstThreeStar[id] ? [run.firstThreeStar[id]] : [])) }])),
      }];
    })),
    bySeed: Object.fromEntries(seeds.map((seed) => {
      const subset = group.filter((run) => run.seed === seed);
      return [seed, {
        clearedW10: subset.filter((run) => run.waves.find((row) => row.wave === 10)?.success).length,
        reachedW10: subset.filter((run) => run.waves.some((row) => row.wave === 10)).length,
        archetypes: subset.map((run) => ({
          archetype: run.archetype,
          reachedWave: run.waves.at(-1)?.wave ?? 0,
          cleared: run.waves.find((row) => row.wave === 10)?.success === true,
          finalCoreHp: run.waves.at(-1)?.coreHp ?? 0,
        })),
      }];
    })),
    totals: {
      purchasesGold: average(group.map((run) => run.waves.reduce((sum, row) => sum + row.purchasesGold, 0))),
      refreshGold: average(group.map((run) => run.waves.reduce((sum, row) => sum + row.refreshGold, 0))),
      xpGold: average(group.map((run) => run.waves.reduce((sum, row) => sum + row.xpGold, 0))),
      overflow: average(group.map((run) => run.waves.reduce((sum, row) => sum + row.overflow, 0))),
    },
  };
});

const report = { rules: ECONOMY_RULES, seeds, archetypes: selectedArchetypes, deterministicReplay: true, summary, runs };
console.log(JSON.stringify(process.env.IDEA_GARRISON_ECONOMY_SUMMARY === "1" ? { ...report, runs: undefined } : report, null, 2));
