import { advanceBattle, startWave } from "../app/game/battle";
import { characterById, characters } from "../app/game/characters";
import {
  BENCH_SLOTS,
  DEPLOY_SLOTS,
  ECONOMY_RULES,
  MAX_LEVEL,
  buy,
  chooseRealityStance,
  chooseReformationReward,
  confirmNormalEvent,
  gainXp,
  liberalFullSale,
  makeInitialState,
  refresh,
  reformistReplace,
  sell,
  useFreeRefresh as consumeFreeRefresh,
  type GameState,
  type Piece,
  type SlotId,
} from "../app/game/engine";
import {
  historicalEventDefinitions,
  effectiveMaxDeploy,
  pendingHistoricalDecision,
  type HistoricalEventId,
  type HistoricalStanceId,
} from "../app/game/historical-events";
import { slotTerrain } from "../app/game/positions";

type StrategyId = "save-interest" | "early-reroll" | "fast-level";
type RosterId = "normal" | "weak-fragmented" | "france-specialized";

type WaveRow = {
  wave: number;
  goldBefore: number;
  goldAfter: number;
  interest: number;
  level: number;
  rosterValue: number;
  deployed: number;
  coreDamage: number;
  coreHp: number;
  success: boolean;
  warMachinesSpawned: number;
  warMachinesDefeated: number;
  warMachineRewardClaimed: boolean;
  historicalBonus: number;
};

type Run = {
  eventId: HistoricalEventId;
  stanceId: HistoricalStanceId;
  strategy: StrategyId;
  roster: RosterId;
  seed: number;
  waves: WaveRow[];
  cleared: boolean;
  firstSignificantDamageWave?: number;
  deadlock?: string;
  pendingReward: boolean;
  freeRefreshUses: number;
  reformistReplacementUses: number;
  liberalSaleUses: number;
};

const strategies: StrategyId[] = ["save-interest", "early-reroll", "fast-level"];
const seeds = (process.env.PHILOSOPHY_HISTORY_SEEDS ?? "101,307,503")
  .split(",")
  .map(Number)
  .filter(Number.isFinite);
const rosters: Record<RosterId, string[]> = {
  normal: ["fichte", "aristotle", "epicurus", "plato", "schelling", "heidegger", "kant", "hegel"],
  "weak-fragmented": ["socrates", "fichte", "descartes", "locke", "schelling", "hobbes", "deleuze", "russell"],
  "france-specialized": ["rousseau", "sartre", "descartes", "foucault", "deleuze", "derrida", "althusser", "lacan"],
};
const tickLimit = 2400;

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

const copyValue = (piece: Piece) => piece.star === 1 ? 1 : piece.star === 2 ? 3 : 9;
const rosterValue = (pieces: Piece[]) => pieces.reduce(
  (sum, piece) => sum + characterById[piece.characterId].cost * copyValue(piece),
  0,
);

function canonicalizePieceIds(state: GameState): GameState {
  const order = [...state.pieces].sort(
    (left, right) => left.characterId.localeCompare(right.characterId)
      || right.star - left.star
      || left.slotId.localeCompare(right.slotId),
  );
  const ids = new Map(order.map((piece, index) => [piece.id, `history-piece-${String(index + 1).padStart(2, "0")}`]));
  return { ...state, pieces: state.pieces.map((piece) => ({ ...piece, id: ids.get(piece.id) ?? piece.id })) };
}

function fieldBest(state: GameState, priorities: string[]): GameState {
  let current = state;
  const capacity = effectiveMaxDeploy(current.level, current.historicalEvents);
  const rank = (piece: Piece) => {
    const index = priorities.indexOf(piece.characterId);
    return piece.star * 100 - (index >= 0 ? index : 100);
  };
  while (current.pieces.length > capacity + BENCH_SLOTS.length) {
    const overflow = [...current.pieces].sort((left, right) => rank(left) - rank(right) || right.id.localeCompare(left.id))[0];
    if (!overflow) break;
    const sold = sell(current, overflow.id);
    if (!sold.ok) break;
    current = sold.state;
  }
  const sorted = [...current.pieces].sort((left, right) => rank(right) - rank(left) || left.id.localeCompare(right.id));
  const selected: Piece[] = [];
  let groundCount = 0;
  let highlandCount = 0;
  const groundSlots = DEPLOY_SLOTS.filter((slot) => slotTerrain[slot] === "ground");
  const highlandSlots = DEPLOY_SLOTS.filter((slot) => slotTerrain[slot] === "highland");
  for (const piece of sorted) {
    if (selected.length >= capacity) break;
    if (characterById[piece.characterId].terrain === "ground" && groundCount < groundSlots.length) {
      selected.push(piece);
      groundCount += 1;
    } else if (characterById[piece.characterId].terrain === "highland" && highlandCount < highlandSlots.length) {
      selected.push(piece);
      highlandCount += 1;
    }
  }
  const selectedIds = new Set(selected.map((piece) => piece.id));
  let groundIndex = 0;
  let highlandIndex = 0;
  let benchIndex = 0;
  return {
    ...current,
    pieces: current.pieces.map((piece) => {
      if (!selectedIds.has(piece.id)) return { ...piece, slotId: (BENCH_SLOTS[benchIndex++] ?? piece.slotId) as SlotId };
      const slotId = characterById[piece.characterId].terrain === "ground"
        ? groundSlots[groundIndex++]
        : highlandSlots[highlandIndex++];
      return { ...piece, slotId: slotId as SlotId };
    }),
  };
}

function buyTargets(state: GameState, priorities: string[], floor: number, maxPurchases = 99) {
  let current = canonicalizePieceIds(state);
  let purchases = 0;
  let changed = true;
  while (changed && purchases < maxPurchases) {
    changed = false;
    for (const characterId of priorities) {
      const index = current.shop.findIndex((id) => id === characterId);
      if (index < 0 || current.gold - characterById[characterId].cost < floor) continue;
      const result = buy(current, index);
      if (!result.ok) continue;
      current = canonicalizePieceIds(result.state);
      purchases += 1;
      changed = true;
      break;
    }
  }
  return current;
}

function forceEventAfterWaveTwo(state: GameState, eventId: HistoricalEventId): GameState {
  return {
    ...state,
    historicalEvents: {
      ...state.historicalEvents,
      eventId,
      eventPresented: false,
      eventResolved: false,
      stanceCandidateIds: [],
      stancePresented: false,
      selectedStanceId: undefined,
      reformationCandidates: undefined,
      reformationChosenId: undefined,
      pendingReformationReward: [],
    },
  };
}

function forceStanceCandidates(state: GameState, eventId: HistoricalEventId, stanceId: HistoricalStanceId): GameState {
  const compatible = historicalEventDefinitions.find((definition) => definition.id === eventId)?.compatibleStanceIds ?? [];
  const stanceCandidateIds = [stanceId, ...compatible.filter((id) => id !== stanceId)].slice(0, 3);
  return {
    ...state,
    historicalEvents: {
      ...state.historicalEvents,
      stanceCandidateIds,
      stancePresented: false,
      selectedStanceId: undefined,
    },
  };
}

function resolveFormalGate(state: GameState, stanceId: HistoricalStanceId) {
  let current = state;
  const pending = pendingHistoricalDecision(current.historicalEvents, current.wave);
  if (pending === "event") {
    const confirmed = confirmNormalEvent(current);
    if (!confirmed.ok) return { state: current, error: confirmed.message };
    current = confirmed.state;
    if (current.historicalEvents.eventId === "event:reformation") {
      const choice = current.historicalEvents.reformationCandidates?.[0];
      if (!choice) return { state: current, error: "reformation candidates were not generated" };
      const rewarded = chooseReformationReward(current, choice);
      if (!rewarded.ok) return { state: current, error: rewarded.message };
      current = rewarded.state;
    }
  }
  if (pendingHistoricalDecision(current.historicalEvents, current.wave) === "stance") {
    const chosen = chooseRealityStance(current, stanceId);
    if (!chosen.ok) return { state: current, error: chosen.message };
    current = chosen.state;
  }
  return { state: current };
}

function prepare(
  state: GameState,
  strategy: StrategyId,
  priorities: string[],
  random: () => number,
) {
  let current = state;
  let freeRefreshUses = 0;
  let reformistReplacementUses = 0;
  let liberalSaleUses = 0;
  const marketPriorities = [
    ...priorities,
    ...characters.map((character) => character.id)
      .filter((id) => !priorities.includes(id))
      .sort((left, right) => characterById[left].cost - characterById[right].cost || left.localeCompare(right)),
  ];

  if (current.historicalEvents.selectedStanceId === "stance:reformism") {
    const index = current.shop.findIndex(Boolean);
    if (index >= 0) {
      const replaced = reformistReplace(current, index);
      if (replaced.ok) {
        current = replaced.state;
        reformistReplacementUses += 1;
      }
    }
  }

  if (strategy === "save-interest") {
    current = buyTargets(current, marketPriorities, current.wave === 1 ? 0 : 15, current.wave === 1 ? 2 : 99);
  } else if (strategy === "early-reroll") {
    current = buyTargets(current, marketPriorities, 3);
    const refreshLimit = current.wave <= 5 ? 4 : 1;
    for (let count = 0; count < refreshLimit && current.gold >= ECONOMY_RULES.refreshCost + 3; count += 1) {
      const rolled = refresh(current, random);
      if (!rolled.ok) break;
      current = buyTargets(rolled.state, marketPriorities, 3);
    }
  } else {
    current = buyTargets(current, marketPriorities, 6, Math.max(2, effectiveMaxDeploy(current.level, current.historicalEvents) - current.pieces.length));
    while (current.wave > 1 && current.level < MAX_LEVEL && current.gold >= ECONOMY_RULES.experienceCost + 6) {
      const result = gainXp(current);
      if (!result.ok) break;
      current = result.state;
    }
    current = buyTargets(current, marketPriorities, 6);
  }

  const freeRefresh = consumeFreeRefresh(current);
  if (freeRefresh.ok) {
    current = buyTargets(freeRefresh.state, marketPriorities, strategy === "save-interest" ? 15 : 3);
    freeRefreshUses += 1;
  }

  if (current.historicalEvents.selectedStanceId === "stance:liberalism") {
    const unwanted = current.pieces.find(
      (piece) => !priorities.includes(piece.characterId) && (piece.paidCost ?? 0) > 0 && current.gold + (piece.paidCost ?? 0) <= ECONOMY_RULES.goldCap,
    );
    if (unwanted) {
      const sold = liberalFullSale(current, unwanted.id);
      if (sold.ok) {
        current = sold.state;
        liberalSaleUses += 1;
      }
    }
  }

  return {
    state: fieldBest(current, priorities),
    freeRefreshUses,
    reformistReplacementUses,
    liberalSaleUses,
  };
}

function simulate(
  eventId: HistoricalEventId,
  stanceId: HistoricalStanceId,
  strategy: StrategyId,
  roster: RosterId,
  seed: number,
): Run {
  const random = mulberry32(seed);
  let state = makeInitialState(random, seed);
  const priorities = rosters[roster];
  const waves: WaveRow[] = [];
  let deadlock: string | undefined;
  let freeRefreshUses = 0;
  let reformistReplacementUses = 0;
  let liberalSaleUses = 0;

  for (let wave = 1; wave <= 10; wave += 1) {
    if (state.wave !== wave || state.coreHp <= 0) break;
    const gate = resolveFormalGate(state, stanceId);
    state = gate.state;
    if (gate.error) {
      deadlock = `W${wave}: ${gate.error}`;
      break;
    }
    const prepared = prepare(state, strategy, priorities, random);
    state = prepared.state;
    freeRefreshUses += prepared.freeRefreshUses;
    reformistReplacementUses += prepared.reformistReplacementUses;
    liberalSaleUses += prepared.liberalSaleUses;
    const goldBefore = state.gold;
    const started = startWave(state);
    if (!started.ok) {
      deadlock = `W${wave}: ${started.message}`;
      break;
    }
    state = started.state;
    for (let tick = 0; tick < tickLimit && state.battle?.status === "running"; tick += 1) {
      state = advanceBattle(state, random);
    }
    if (state.battle?.status === "running") {
      deadlock = `W${wave}: combat exceeded ${tickLimit} ticks`;
      break;
    }
    const summary = state.battle?.summary;
    if (!summary) {
      deadlock = `W${wave}: combat settled without summary`;
      break;
    }
    waves.push({
      wave,
      goldBefore,
      goldAfter: state.gold,
      interest: summary.interest,
      level: state.level,
      rosterValue: rosterValue(state.pieces),
      deployed: state.pieces.filter((piece) => piece.slotId.startsWith("deploy-") || piece.slotId === "throne-1").length,
      coreDamage: summary.coreDamage,
      coreHp: state.coreHp,
      success: summary.success,
      warMachinesSpawned: state.battle?.warMachinesSpawned ?? 0,
      warMachinesDefeated: state.battle?.warMachinesDefeated ?? 0,
      warMachineRewardClaimed: state.historicalEvents.warMachineRewardedWaves.includes(wave),
      historicalBonus: summary.historicalBonus ?? 0,
    });
    if (!summary.success) break;
    if (wave === 2) state = forceEventAfterWaveTwo(state, eventId);
    if (wave === 5) state = forceStanceCandidates(state, eventId, stanceId);
    state = { ...state, battle: undefined, waveCheckpoint: undefined };
  }

  return {
    eventId,
    stanceId,
    strategy,
    roster,
    seed,
    waves,
    cleared: waves.some((row) => row.wave === 10 && row.success),
    firstSignificantDamageWave: waves.find((row) => row.coreDamage >= 10)?.wave,
    deadlock,
    pendingReward: Boolean(state.historicalEvents.pendingReformationReward?.length),
    freeRefreshUses,
    reformistReplacementUses,
    liberalSaleUses,
  };
}

const requestedEvents = new Set((process.env.PHILOSOPHY_HISTORY_EVENTS ?? "").split(",").filter(Boolean));
const selectedEvents = requestedEvents.size
  ? historicalEventDefinitions.filter((event) => requestedEvents.has(event.id))
  : historicalEventDefinitions;
const combinations = selectedEvents.flatMap((event) => event.compatibleStanceIds.map((stanceId) => ({ eventId: event.id, stanceId })));
const runMatrix = () => combinations.flatMap(({ eventId, stanceId }) => strategies.flatMap((strategy) => (
  (Object.keys(rosters) as RosterId[]).flatMap((roster) => seeds.map((seed) => simulate(eventId, stanceId, strategy, roster, seed)))
)));
const runs = runMatrix();
const replay = runMatrix();
if (JSON.stringify(runs) !== JSON.stringify(replay)) throw new Error("historical event simulation is not deterministic");

const average = (values: number[]) => values.length
  ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
  : null;
const summarize = (group: Run[]) => ({
  runs: group.length,
  clears: group.filter((run) => run.cleared).length,
  clearRate: Number((group.filter((run) => run.cleared).length / Math.max(1, group.length)).toFixed(4)),
  deadlocks: group.filter((run) => run.deadlock).length,
  pendingRewards: group.filter((run) => run.pendingReward).length,
  firstSignificantDamageWave: average(group.flatMap((run) => run.firstSignificantDamageWave ? [run.firstSignificantDamageWave] : [])),
  averageFinalCoreHp: average(group.map((run) => run.waves.at(-1)?.coreHp ?? 0)),
});
const by = <T extends string>(values: readonly T[], select: (run: Run) => T) => Object.fromEntries(
  values.map((value) => [value, summarize(runs.filter((run) => select(run) === value))]),
);
const waveCurve = Object.fromEntries(Array.from({ length: 10 }, (_, index) => index + 1).map((wave) => {
  const rows = runs.flatMap((run) => run.waves.filter((row) => row.wave === wave));
  return [wave, {
    reached: rows.length,
    success: rows.filter((row) => row.success).length,
    goldBefore: average(rows.map((row) => row.goldBefore)),
    goldAfter: average(rows.map((row) => row.goldAfter)),
    interest: average(rows.map((row) => row.interest)),
    level: average(rows.map((row) => row.level)),
    rosterValue: average(rows.map((row) => row.rosterValue)),
    deployed: average(rows.map((row) => row.deployed)),
    coreDamage: average(rows.map((row) => row.coreDamage)),
  }];
}));
const warMachinePressure = Object.fromEntries([4, 7, 9].map((wave) => {
  const rows = runs.filter((run) => run.eventId === "event:world_war").flatMap((run) => run.waves.filter((row) => row.wave === wave));
  return [wave, {
    reached: rows.length,
    success: rows.filter((row) => row.success).length,
    averageCoreDamage: average(rows.map((row) => row.coreDamage)),
    spawned: rows.reduce((sum, row) => sum + row.warMachinesSpawned, 0),
    defeated: rows.reduce((sum, row) => sum + row.warMachinesDefeated, 0),
    rewardsClaimed: rows.filter((row) => row.warMachineRewardClaimed).length,
    historicalBonusIncludingPublicSupply: rows.reduce((sum, row) => sum + row.historicalBonus, 0),
  }];
}));

const report = {
  deterministicReplay: true,
  seeds,
  strategies,
  rosters: Object.keys(rosters),
  eventStanceCombinations: combinations.length,
  totalRuns: runs.length,
  overall: summarize(runs),
  byEvent: by(historicalEventDefinitions.map((event) => event.id), (run) => run.eventId),
  byEventAndStrategy: Object.fromEntries(historicalEventDefinitions.map((event) => [
    event.id,
    Object.fromEntries(strategies.map((strategy) => [
      strategy,
      summarize(runs.filter((run) => run.eventId === event.id && run.strategy === strategy)),
    ])),
  ])),
  byCombination: Object.fromEntries(combinations.map(({ eventId, stanceId }) => {
    const key = `${eventId}+${stanceId}`;
    return [key, summarize(runs.filter((run) => run.eventId === eventId && run.stanceId === stanceId))];
  })),
  byCombinationAndStrategy: Object.fromEntries(combinations.map(({ eventId, stanceId }) => {
    const key = `${eventId}+${stanceId}`;
    return [key, Object.fromEntries(strategies.map((strategy) => [
      strategy,
      summarize(runs.filter((run) => run.eventId === eventId && run.stanceId === stanceId && run.strategy === strategy)),
    ]))];
  })),
  byStance: by(["stance:conservatism", "stance:reformism", "stance:radicalism", "stance:liberalism", "stance:communism"], (run) => run.stanceId),
  byStrategy: by(strategies, (run) => run.strategy),
  byRoster: by(Object.keys(rosters) as RosterId[], (run) => run.roster),
  waveCurve,
  warMachinePressure,
  actions: {
    freeRefreshUses: runs.reduce((sum, run) => sum + run.freeRefreshUses, 0),
    reformistReplacementUses: runs.reduce((sum, run) => sum + run.reformistReplacementUses, 0),
    liberalSaleUses: runs.reduce((sum, run) => sum + run.liberalSaleUses, 0),
  },
  failures: runs.filter((run) => run.deadlock || run.pendingReward).map((run) => ({
    eventId: run.eventId,
    stanceId: run.stanceId,
    strategy: run.strategy,
    roster: run.roster,
    seed: run.seed,
    deadlock: run.deadlock,
    pendingReward: run.pendingReward,
  })),
};

console.log(JSON.stringify(report, null, 2));
