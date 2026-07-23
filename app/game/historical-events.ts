import type { FactionId } from "./characters";

export const HISTORICAL_EVENT_STATE_VERSION = 1 as const;
export const REFORMATION_CANDIDATE_COUNT = 3 as const;

export const HISTORICAL_EVENT_IDS = [
  "event:polis_crisis",
  "event:reformation",
  "event:french_revolution",
  "event:may_1968",
  "event:industrial_revolution",
  "event:world_war",
  "event:capital_accumulation",
] as const;

export const HISTORICAL_STANCE_IDS = [
  "stance:conservatism",
  "stance:reformism",
  "stance:radicalism",
  "stance:liberalism",
  "stance:communism",
] as const;

export type HistoricalEventId = (typeof HISTORICAL_EVENT_IDS)[number];
export type HistoricalStanceId = (typeof HISTORICAL_STANCE_IDS)[number];
export type HistoricalEffectId = `${HistoricalEventId | HistoricalStanceId}:${string}`;

export type HistoricalActiveEffect = {
  id: HistoricalEffectId;
  sourceId: HistoricalEventId | HistoricalStanceId;
  startWave: number;
  endWave?: number;
};

export type HistoricalWaveFlags = {
  wave: number;
  normalPurchaseSpend: number;
  freeRefreshesAvailable: number;
  freeRefreshesUsed: number;
  reformistReplacementUsed: boolean;
  liberalFullSaleUsed: boolean;
};

export type HistoricalEventState = {
  version: typeof HISTORICAL_EVENT_STATE_VERSION;
  seed: number;
  cursor: number;
  eventId?: HistoricalEventId;
  eventPresented: boolean;
  eventResolved: boolean;
  stanceCandidateIds: HistoricalStanceId[];
  stancePresented: boolean;
  selectedStanceId?: HistoricalStanceId;
  grantedRewardIds: string[];
  pendingReformationReward?: string[];
  reformationCandidates?: string[];
  reformationChosenId?: string;
  activeEffects: HistoricalActiveEffect[];
  waveOverrideIds: string[];
  warMachineRewardedWaves: number[];
  waveFlags: HistoricalWaveFlags;
};

export type HistoricalEventDefinition = {
  id: HistoricalEventId;
  title: string;
  history: string;
  benefit: string;
  cost: string;
  duration: string;
  compatibleStanceIds: readonly HistoricalStanceId[];
};

export type HistoricalStanceDefinition = {
  id: HistoricalStanceId;
  title: string;
  philosophy: string;
  summary: string;
};

const allStances = [...HISTORICAL_STANCE_IDS];
const without = (...excluded: HistoricalStanceId[]) => allStances.filter((id) => !excluded.includes(id));

export const historicalEventDefinitions: readonly HistoricalEventDefinition[] = [
  { id: "event:polis_crisis", title: "古希腊城邦危机", history: "城邦秩序在争辩与防线之间重新组织。", benefit: "每路最前方的基础阻挡 1 地面棋子获得 +1 阻挡。", cost: "受益棋子的普通攻击间隔增加 10%。", duration: "第 3 波起持续生效", compatibleStanceIds: allStances },
  { id: "event:reformation", title: "宗教改革", history: "旧有权威裂解为互不相同的思想道路。", benefit: "从三个不同阵营的 2 费棋子中免费选择一名。", cost: "一次性选择，免费棋子的实际购入成本为 0。", duration: "第 3 波一次性结算", compatibleStanceIds: without("stance:conservatism", "stance:radicalism") },
  { id: "event:french_revolution", title: "法国大革命", history: "低价理念获得群众动员，高价理念承受秩序冲击。", benefit: "1—2 费棋子攻击与最大生命 +15%。", cost: "4—5 费棋子攻击与最大生命 -10%；3 费不变。", duration: "第 3 波起持续生效", compatibleStanceIds: allStances },
  { id: "event:may_1968", title: "五月风暴", history: "街头与学院扩张了参与边界，也削弱了大阵营垄断。", benefit: "普通形态部署上限 +1。", cost: "希腊最多按 2 人档、其余大阵营最多按 4 人档结算；小羁绊仍按真实角色计算。", duration: "第 3 波起持续生效", compatibleStanceIds: allStances },
  { id: "event:industrial_revolution", title: "工业革命", history: "规模化购买换来一次新的市场组织机会。", benefit: "当波正常购买支出达到 6 金币后获得一次免费刷新。", cost: "每波最多一次且不能结转。", duration: "第 3 波起逐波计算", compatibleStanceIds: without("stance:radicalism") },
  { id: "event:world_war", title: "世界大战", history: "战争机器在既有波次之外进入三条固定路线。", benefit: "击破指定波次的战争机器可获得额外金币。", cost: "W4、W7、W9 追加战争机器及有限召唤压力。", duration: "W4 / W7 / W9", compatibleStanceIds: without("stance:radicalism") },
  { id: "event:capital_accumulation", title: "资本积累", history: "公共分配退居次位，财富只有在储备并继续增殖时才成为力量。", benefit: "利息上限从 +3 提高到 +8；40 金币即可吃满，仍保留 10 金币周转空间。", cost: "每波基础收入从 10 降至 6；必须维持较高储蓄才能弥补缺口。", duration: "第 3 波起持续生效", compatibleStanceIds: without("stance:communism", "stance:radicalism") },
] as const;

export const historicalStanceDefinitions: readonly HistoricalStanceDefinition[] = [
  { id: "stance:conservatism", title: "保守主义", philosophy: "承认历史的震荡，但以延续既有秩序来限制它的后果。", summary: "从第 6 波起，你可以终止事件持续带来的收益与代价；已经获得的一次性奖励不会被追回。" },
  { id: "stance:reformism", title: "改良主义", philosophy: "不一次性推翻秩序，而在既有制度中持续修补可改变之处。", summary: "每一波，你都可以把一个商店槽位换成另一名同费用棋子。" },
  { id: "stance:radicalism", title: "激进主义", philosophy: "追问问题的根部，并把已经发生的断裂推向更彻底的改变。", summary: "你可以把当前事件推向更彻底的形态；具体改变会随本局事件列出。" },
  { id: "stance:liberalism", title: "自由主义", philosophy: "把选择权交还个体，让交换与退出成为调整秩序的方式。", summary: "每一波，你都可以让一名棋子按实际购入成本完整退出；免费棋子不能换取金币。" },
  { id: "stance:communism", title: "共产主义", philosophy: "让共同占有取代私人积累，以公共供给组织集体生存。", summary: "你不再获得利息，取而代之的是每波结算时得到 2 金币公共供给。" },
] as const;

const eventIds = new Set<string>(HISTORICAL_EVENT_IDS);
const stanceIds = new Set<string>(HISTORICAL_STANCE_IDS);
export const historicalEventDefinitionById = new Map(historicalEventDefinitions.map((definition) => [definition.id, definition]));
export const historicalStanceDefinitionById = new Map(historicalStanceDefinitions.map((definition) => [definition.id, definition]));

export function historicalStanceSummaryForEvent(stanceId: HistoricalStanceId, eventId?: HistoricalEventId) {
  if (stanceId !== "stance:radicalism") return historicalStanceDefinitionById.get(stanceId)?.summary ?? stanceId;
  switch (eventId) {
    case "event:may_1968":
      return "你可以把五月风暴推向激进：人口上限 +2；希腊最多按 2 人档、其余大阵营最多按 4 人档结算。";
    case "event:french_revolution":
      return "你可以把法国大革命推向激进：1—2 费棋子攻击与生命 +22%；4—5 费棋子攻击与生命 -15%。";
    case "event:polis_crisis":
      return "你可以把城邦危机推向激进：每路前锋阻挡 +2，普通攻击间隔增加 6%。";
    default:
      return "当前事件没有额外的激进数值；此项只为兼容旧存档保留。";
  }
}

export const isHistoricalEventId = (value: unknown): value is HistoricalEventId => typeof value === "string" && eventIds.has(value);
export const isHistoricalStanceId = (value: unknown): value is HistoricalStanceId => typeof value === "string" && stanceIds.has(value);

export function normalizeHistoricalSeed(value: number) {
  if (!Number.isFinite(value)) return 0x6d2b79f5;
  const seed = Math.floor(value) >>> 0;
  return seed || 0x6d2b79f5;
}

export function historicalSeedFromUnitInterval(value: number) {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(0.9999999999999999, value)) : 0;
  return normalizeHistoricalSeed(Math.floor(normalized * 0x1_0000_0000));
}

export function historicalSeedFromText(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return normalizeHistoricalSeed(hash);
}

export const makeHistoricalWaveFlags = (wave: number): HistoricalWaveFlags => ({
  wave: Math.max(1, Math.floor(wave)),
  normalPurchaseSpend: 0,
  freeRefreshesAvailable: 0,
  freeRefreshesUsed: 0,
  reformistReplacementUsed: false,
  liberalFullSaleUsed: false,
});

export function makeHistoricalEventState(seed: number, wave = 1): HistoricalEventState {
  return {
    version: HISTORICAL_EVENT_STATE_VERSION,
    seed: normalizeHistoricalSeed(seed),
    cursor: 0,
    eventPresented: wave >= 3,
    eventResolved: wave >= 3,
    stanceCandidateIds: [],
    stancePresented: wave >= 6,
    grantedRewardIds: [],
    pendingReformationReward: [],
    reformationCandidates: undefined,
    reformationChosenId: undefined,
    activeEffects: [],
    waveOverrideIds: [],
    warMachineRewardedWaves: [],
    waveFlags: makeHistoricalWaveFlags(wave),
  };
}

export function cloneHistoricalEventState(state: HistoricalEventState): HistoricalEventState {
  return {
    ...state,
    stanceCandidateIds: [...state.stanceCandidateIds],
    grantedRewardIds: [...state.grantedRewardIds],
    pendingReformationReward: state.pendingReformationReward ? [...state.pendingReformationReward] : [],
    reformationCandidates: state.reformationCandidates ? [...state.reformationCandidates] : undefined,
    activeEffects: state.activeEffects.map((effect) => ({ ...effect })),
    waveOverrideIds: [...state.waveOverrideIds],
    warMachineRewardedWaves: [...state.warMachineRewardedWaves],
    waveFlags: { ...state.waveFlags },
  };
}

function draw(state: HistoricalEventState) {
  let next = (state.seed + Math.imul(state.cursor + 1, 0x6d2b79f5)) >>> 0;
  next = Math.imul(next ^ next >>> 15, next | 1);
  next ^= next + Math.imul(next ^ next >>> 7, next | 61);
  const value = ((next ^ next >>> 14) >>> 0) / 0x1_0000_0000;
  return { value, state: { ...state, cursor: state.cursor + 1 } };
}

/** Advance and expose the saved historical RNG as a unit-interval value. */
export function historicalRandom(state: HistoricalEventState) {
  return draw(state);
}

function chooseOne<T>(state: HistoricalEventState, values: readonly T[]) {
  if (!values.length) throw new Error("Cannot choose from an empty historical-event pool.");
  const rolled = draw(state);
  return { value: values[Math.floor(rolled.value * values.length)]!, state: rolled.state };
}

function shuffled<T>(state: HistoricalEventState, values: readonly T[]) {
  const result = [...values];
  let current = state;
  for (let index = result.length - 1; index > 0; index -= 1) {
    const rolled = draw(current); current = rolled.state;
    const other = Math.floor(rolled.value * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return { values: result, state: current };
}

export function advanceHistoricalEventMilestones(state: HistoricalEventState, completedWave: number): HistoricalEventState {
  let current = state.waveFlags.wave === completedWave + 1 ? state : { ...state, waveFlags: makeHistoricalWaveFlags(completedWave + 1) };
  if (completedWave === 2 && !current.eventId && !current.eventPresented) {
    const selected = chooseOne(current, HISTORICAL_EVENT_IDS);
    current = { ...selected.state, eventId: selected.value, eventPresented: false, eventResolved: false };
  }
  if (completedWave === 5 && current.eventId && !current.selectedStanceId && !current.stanceCandidateIds.length && !current.stancePresented) {
    const definition = historicalEventDefinitionById.get(current.eventId);
    if (!definition) return current;
    const candidates = shuffled(current, definition.compatibleStanceIds);
    current = { ...candidates.state, stanceCandidateIds: candidates.values.slice(0, 3), stancePresented: false };
  }
  return current;
}

export function markHistoricalEventPresented(state: HistoricalEventState): HistoricalEventState {
  return state.eventId ? { ...state, eventPresented: true } : state;
}

export function markHistoricalEventResolved(state: HistoricalEventState): HistoricalEventState {
  return state.eventId ? { ...state, eventPresented: true, eventResolved: true } : state;
}

export function chooseHistoricalStance(state: HistoricalEventState, stanceId: HistoricalStanceId): HistoricalEventState {
  if (state.selectedStanceId || !state.stanceCandidateIds.includes(stanceId)) return state;
  return { ...state, selectedStanceId: stanceId, stancePresented: true };
}

export function pendingHistoricalDecision(state: HistoricalEventState, wave: number): "event" | "stance" | undefined {
  if (wave === 3 && state.eventId && (
    !state.eventResolved
    || (state.eventId === "event:reformation" && !state.reformationChosenId)
  )) return "event";
  if (wave === 6 && state.stanceCandidateIds.length === 3 && !state.selectedStanceId) return "stance";
  return undefined;
}

export function claimHistoricalReward(state: HistoricalEventState, rewardId: string) {
  const normalized = rewardId.trim();
  if (!normalized || state.grantedRewardIds.includes(normalized)) return { state, granted: false };
  return { state: { ...state, grantedRewardIds: [...state.grantedRewardIds, normalized] }, granted: true };
}

const REFORMATION_FREE_FACTIONS: FactionId[] = ["greece", "germany", "france", "britain"];

/** Generate 3 distinct-faction 2-cost reformation candidates deterministically.
 *  `poolByFaction` is a lookup from faction to available 2-cost character IDs. */
export function generateReformationCandidates(
  state: HistoricalEventState,
  poolByFaction: (faction: FactionId) => string[],
): HistoricalEventState {
  if (state.reformationCandidates && state.reformationCandidates.length === REFORMATION_CANDIDATE_COUNT) return state;
  let current = state;
  const factionPool = [...REFORMATION_FREE_FACTIONS];
  const chosenFactions: FactionId[] = [];
  while (chosenFactions.length < REFORMATION_CANDIDATE_COUNT && factionPool.length) {
    const factionResult = draw(current); current = factionResult.state;
    const idx = Math.floor(factionResult.value * factionPool.length);
    chosenFactions.push(factionPool.splice(idx, 1)[0]!);
  }
  const candidateIds: string[] = [];
  for (const faction of chosenFactions) {
    const pool = poolByFaction(faction);
    if (!pool.length) continue;
    const charResult = draw(current); current = charResult.state;
    candidateIds.push(pool[Math.floor(charResult.value * pool.length)]!);
  }
  return { ...current, reformationCandidates: candidateIds.length === REFORMATION_CANDIDATE_COUNT ? candidateIds : undefined, reformationChosenId: undefined };
}

/** Record the player's choice among the three reformation candidates. */
export function chooseReformationCandidate(state: HistoricalEventState, chosenCandidateId: string): HistoricalEventState {
  if (!state.reformationCandidates?.includes(chosenCandidateId)) return state;
  if (state.reformationChosenId) return state;
  return { ...state, reformationChosenId: chosenCandidateId };
}

export function migrateHistoricalEventState(input: unknown, wave: number, fallbackSeed: number): HistoricalEventState {
  if (!input || typeof input !== "object") return makeHistoricalEventState(fallbackSeed, wave);
  const raw = input as Partial<HistoricalEventState>;
  if (raw.version !== HISTORICAL_EVENT_STATE_VERSION) return makeHistoricalEventState(fallbackSeed, wave);
  const eventId = isHistoricalEventId(raw.eventId) ? raw.eventId : undefined;
  const stanceCandidateIds = Array.isArray(raw.stanceCandidateIds) ? [...new Set(raw.stanceCandidateIds.filter(isHistoricalStanceId))].slice(0, 3) : [];
  const compatible = eventId ? new Set(historicalEventDefinitionById.get(eventId)?.compatibleStanceIds ?? []) : new Set<HistoricalStanceId>();
  const validCandidates = stanceCandidateIds.filter((id) => compatible.has(id));
  const selectedStanceId = isHistoricalStanceId(raw.selectedStanceId) && validCandidates.includes(raw.selectedStanceId) ? raw.selectedStanceId : undefined;
  const finiteWhole = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
  const uniqueStrings = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))] : [];
  const activeEffects = Array.isArray(raw.activeEffects) ? raw.activeEffects.flatMap((effect) => {
    if (!effect || typeof effect !== "object") return [];
    const candidate = effect as Partial<HistoricalActiveEffect>;
    if (typeof candidate.id !== "string" || (!isHistoricalEventId(candidate.sourceId) && !isHistoricalStanceId(candidate.sourceId))) return [];
    const startWave = finiteWhole(candidate.startWave, 1);
    const endWave = candidate.endWave === undefined ? undefined : Math.max(startWave, finiteWhole(candidate.endWave, startWave));
    return [{ id: candidate.id as HistoricalEffectId, sourceId: candidate.sourceId, startWave, ...(endWave === undefined ? {} : { endWave }) }];
  }) : [];
  const flags = raw.waveFlags && typeof raw.waveFlags === "object" ? raw.waveFlags as Partial<HistoricalWaveFlags> : {};
  const reformationCandidates = Array.isArray(raw.reformationCandidates) && raw.reformationCandidates.length === REFORMATION_CANDIDATE_COUNT
    ? [...new Set(raw.reformationCandidates.filter((c): c is string => typeof c === "string" && c.length > 0))]
    : undefined;
  const reformationChosenId = typeof raw.reformationChosenId === "string" && reformationCandidates?.includes(raw.reformationChosenId)
    ? raw.reformationChosenId
    : undefined;
  return {
    version: HISTORICAL_EVENT_STATE_VERSION,
    seed: normalizeHistoricalSeed(raw.seed ?? fallbackSeed),
    cursor: finiteWhole(raw.cursor),
    eventId,
    eventPresented: eventId ? raw.eventPresented === true : wave >= 3,
    eventResolved: eventId ? raw.eventResolved === true : wave >= 3,
    stanceCandidateIds: validCandidates,
    stancePresented: selectedStanceId ? true : eventId ? raw.stancePresented === true : wave >= 6,
    selectedStanceId,
    grantedRewardIds: uniqueStrings(raw.grantedRewardIds),
    pendingReformationReward: uniqueStrings(raw.pendingReformationReward),
    reformationCandidates: reformationCandidates?.length === REFORMATION_CANDIDATE_COUNT ? reformationCandidates : undefined,
    reformationChosenId,
    activeEffects,
    waveOverrideIds: uniqueStrings(raw.waveOverrideIds),
    warMachineRewardedWaves: Array.isArray(raw.warMachineRewardedWaves) ? [...new Set(raw.warMachineRewardedWaves.map((value) => finiteWhole(value)).filter((value) => [4, 7, 9].includes(value)))] : [],
    waveFlags: {
      wave: finiteWhole(flags.wave, wave) || Math.max(1, wave),
      normalPurchaseSpend: finiteWhole(flags.normalPurchaseSpend),
      freeRefreshesAvailable: finiteWhole(flags.freeRefreshesAvailable),
      freeRefreshesUsed: finiteWhole(flags.freeRefreshesUsed),
      reformistReplacementUsed: flags.reformistReplacementUsed === true,
      liberalFullSaleUsed: flags.liberalFullSaleUsed === true,
    },
  };
}

// ============================================================================
// 批次 B–F 集中可调参数。所有暂定数值在此配置并标记 pending；模拟后确认。
// 规则必须在引擎 / 战斗核心 / 冻结快照中解析，不得运行时改写 ECONOMY_RULES。
// ============================================================================

export type HistoricalFactionId = FactionId;

export const HISTORICAL_RULES = {
  frenchRevolution: {
    lowCostMax: 2,
    highCostMin: 4,
    normal: { lowAttack: 0.15, lowMaxHp: 0.15, highAttack: -0.10, highMaxHp: -0.10 },
    radical: { lowAttack: 0.22, lowMaxHp: 0.22, highAttack: -0.15, highMaxHp: -0.15 },
    pending: true,
  },
  polisCrisis: {
    normal: { blockBonus: 1, attackSpeedCost: 0.10, targetBaseBlock: 1 },
    radical: { blockBonus: 2, attackSpeedCost: 0.06, targetBaseBlock: 1 },
    pending: true,
  },
  may1968: {
    normal: { deployCapBonus: 1, populationCapBonus: 0, factionCountCap: { greece: 2, germany: 4, france: 4, britain: 4 } },
    radical: { deployCapBonus: 0, populationCapBonus: 2, factionCountCap: { greece: 2, germany: 4, france: 4, britain: 4 } },
    pending: true,
  },
  industrialRevolution: {
    freeRefreshSpendThreshold: 6,
    freeRefreshesPerWave: 1,
    pending: true,
  },
  capitalAccumulation: {
    baseIncomeDelta: -4,
    interestCapDelta: 5,
    pending: true,
  },
  liberalism: {
    pending: true,
  },
  communism: {
    noInterest: true,
    publicSupply: 2,
    pending: true,
  },
  reformation: {
    candidateCount: REFORMATION_CANDIDATE_COUNT,
    pending: true,
  },
  warMachine: {
    damageReductionWhileMoving: 0.5,
    healthMultiplierCapByWave: { 4: 2.5, 7: 3, 9: 2 },
    sustainedBlockThresholdTicks: 10,
    summonKind: "ordinary",
    rewardByWave: { 4: 3, 7: 4, 9: 5 },
    plans: {
      4: { machines: 1, maxSummonsPerMachine: 1, distinctRoutes: false },
      7: { machines: 1, maxSummonsPerMachine: 2, distinctRoutes: false },
      9: { machines: 2, maxSummonsPerMachine: 1, distinctRoutes: true },
    },
    pending: true,
  },
} as const;

export type ResolvedHistoricalEffects = {
  eventId?: HistoricalEventId;
  stanceId?: HistoricalStanceId;
  deployCapBonus: number;
  populationCapBonus: number;
  factionCountCap: Partial<Record<FactionId, number>>;
  frenchRevolution?: { lowAttack: number; lowMaxHp: number; highAttack: number; highMaxHp: number };
  polisCrisis?: { blockBonus: number; attackSpeedCost: number; targetBaseBlock: number };
  economy: { baseIncomeDelta: number; interestCapDelta: number; noInterest: boolean; publicSupply: number };
  freeRefreshPerWave: number;
  freeRefreshSpendThreshold: number;
  radical: boolean;
  conservatism: boolean;
  reformism: boolean;
  liberalism: boolean;
  communism: boolean;
  warMachine?: { wave: number; machines: number; maxSummonsPerMachine: number; distinctRoutes: boolean; reward: number };
};

const NEUTRAL_ECONOMY = { baseIncomeDelta: 0, interestCapDelta: 0, noInterest: false, publicSupply: 0 };

export function resolveHistoricalEffects(eventId?: HistoricalEventId, stanceId?: HistoricalStanceId, wave = 1): ResolvedHistoricalEffects {
  const radical = stanceId === "stance:radicalism";
  const conservatism = stanceId === "stance:conservatism";
  const reformism = stanceId === "stance:reformism";
  const liberalism = stanceId === "stance:liberalism";
  const communism = stanceId === "stance:communism";
  const base: ResolvedHistoricalEffects = {
    eventId, stanceId,
    deployCapBonus: 0, populationCapBonus: 0, factionCountCap: {},
    economy: { ...NEUTRAL_ECONOMY },
    freeRefreshPerWave: 0, freeRefreshSpendThreshold: 0,
    radical, conservatism, reformism, liberalism, communism,
    warMachine: undefined,
  };
  if (!eventId) return base;
  // 保守主义同时取消事件的持续收益与代价，回到中性。
  if (conservatism) return base;

  let resolved: ResolvedHistoricalEffects = base;
  switch (eventId) {
    case "event:may_1968": {
      const cfg = radical ? HISTORICAL_RULES.may1968.radical : HISTORICAL_RULES.may1968.normal;
      resolved = { ...base, deployCapBonus: cfg.deployCapBonus, populationCapBonus: cfg.populationCapBonus, factionCountCap: { ...cfg.factionCountCap } };
      break;
    }
    case "event:french_revolution": {
      resolved = { ...base, frenchRevolution: radical ? HISTORICAL_RULES.frenchRevolution.radical : HISTORICAL_RULES.frenchRevolution.normal };
      break;
    }
    case "event:polis_crisis": {
      resolved = { ...base, polisCrisis: radical ? HISTORICAL_RULES.polisCrisis.radical : HISTORICAL_RULES.polisCrisis.normal };
      break;
    }
    case "event:industrial_revolution": {
      const cfg = HISTORICAL_RULES.industrialRevolution;
      resolved = { ...base, freeRefreshPerWave: cfg.freeRefreshesPerWave, freeRefreshSpendThreshold: cfg.freeRefreshSpendThreshold };
      break;
    }
    case "event:capital_accumulation": {
      const cfg = HISTORICAL_RULES.capitalAccumulation;
      resolved = { ...base, economy: { ...base.economy, baseIncomeDelta: cfg.baseIncomeDelta, interestCapDelta: cfg.interestCapDelta } };
      break;
    }
    case "event:world_war": {
      const plan = HISTORICAL_RULES.warMachine.plans[wave as 4 | 7 | 9];
      const cancelled = (wave === 7 || wave === 9) && conservatism;
      if (plan && !cancelled) {
        const reward = (HISTORICAL_RULES.warMachine.rewardByWave as Record<number, number>)[wave] ?? 0;
        resolved = { ...base, warMachine: { wave, ...plan, distinctRoutes: plan.distinctRoutes ?? false, reward } };
      } else {
        resolved = base;
      }
      break;
    }
    case "event:reformation":
    default:
      resolved = base;
      break;
  }

  // 共产主义叠加经济修正（仅当事件允许共产主义时由候选池保证）。
  if (communism) {
    resolved = { ...resolved, economy: { ...resolved.economy, noInterest: HISTORICAL_RULES.communism.noInterest, publicSupply: HISTORICAL_RULES.communism.publicSupply } };
  }
  return resolved;
}

export function resolveHistoricalEffectsFromState(state: HistoricalEventState, wave = state.waveFlags.wave): ResolvedHistoricalEffects {
  return resolveHistoricalEffects(state.eventId, state.selectedStanceId, wave);
}

const DEPLOY_CAPACITY_LOOKUP = [0, 2, 3, 4, 5, 6, 7, 8, 8];
export function effectiveMaxDeploy(level: number, historicalEvents: HistoricalEventState): number {
  const base = DEPLOY_CAPACITY_LOOKUP[Math.min(DEPLOY_CAPACITY_LOOKUP.length - 1, Math.max(1, Math.floor(level)))] ?? 8;
  const resolved = resolveHistoricalEffectsFromState(historicalEvents);
  const bonus = resolved.deployCapBonus + resolved.populationCapBonus;
  return Math.min(20, base + bonus);
}

export function effectivePopulationCap(level: number, historicalEvents: HistoricalEventState): number {
  return effectiveMaxDeploy(level, historicalEvents);
}

export type ResolvedEconomy = { baseIncome: number; maxInterest: number; noInterest: boolean; publicSupply: number };

export function resolveEconomy(historicalEvents: HistoricalEventState, baseIncome = 10, maxInterest = 3): ResolvedEconomy {
  const resolved = resolveHistoricalEffectsFromState(historicalEvents);
  return {
    baseIncome: baseIncome + resolved.economy.baseIncomeDelta,
    maxInterest: maxInterest + resolved.economy.interestCapDelta,
    noInterest: resolved.economy.noInterest,
    publicSupply: resolved.economy.publicSupply,
  };
}

export function effectiveInterest(gold: number, historicalEvents: HistoricalEventState, interestStep = 5): number {
  const economy = resolveEconomy(historicalEvents);
  if (economy.noInterest) return 0;
  return Math.max(0, Math.min(economy.maxInterest, Math.floor(Math.max(0, gold) / interestStep)));
}

export function frenchRevolutionMultipliers(
  cost: number,
  config: { lowAttack: number; lowMaxHp: number; highAttack: number; highMaxHp: number },
  lowCostMax = 2,
  highCostMin = 4,
) {
  if (cost <= lowCostMax) return { damageMult: 1 + config.lowAttack, maxHpMult: 1 + config.lowMaxHp };
  if (cost >= highCostMin) return { damageMult: 1 + config.highAttack, maxHpMult: 1 + config.highMaxHp };
  return { damageMult: 1, maxHpMult: 1 };
}

export type WarMachinePlan = { wave: number; machines: number; maxSummonsPerMachine: number; distinctRoutes: boolean; reward: number };

export function resolveWarMachinePlan(historicalEvents: HistoricalEventState, wave: number): WarMachinePlan | undefined {
  return resolveHistoricalEffectsFromState(historicalEvents, wave).warMachine;
}

export function warMachineRoutesForWave(wave: number, machines: number): Array<"upper" | "lower" | "side"> {
  if (![4, 7, 9].includes(wave) || machines <= 0) return [];
  const preferred = wave === 4 ? ["upper", "lower", "side"] as const
    : wave === 7 ? ["lower", "side", "upper"] as const
      : ["upper", "side", "lower"] as const;
  return Array.from({ length: Math.max(0, machines) }, (_, index) => preferred[index % preferred.length]!);
}

export function claimWarMachineWaveReward(state: HistoricalEventState, wave: number, defeatedMachines: number) {
  const plan = resolveWarMachinePlan(state, wave);
  if (!plan || defeatedMachines < plan.machines) return { state, reward: 0, granted: false };
  const rewardId = `reward:war-machine:${wave}`;
  const alreadyClaimed = state.warMachineRewardedWaves.includes(wave) || state.grantedRewardIds.includes(rewardId);
  if (alreadyClaimed) {
    return {
      state: {
        ...state,
        grantedRewardIds: state.grantedRewardIds.includes(rewardId) ? state.grantedRewardIds : [...state.grantedRewardIds, rewardId],
        warMachineRewardedWaves: state.warMachineRewardedWaves.includes(wave) ? state.warMachineRewardedWaves : [...state.warMachineRewardedWaves, wave],
      },
      reward: 0,
      granted: false,
    };
  }
  const claim = claimHistoricalReward(state, rewardId);
  return {
    state: { ...claim.state, warMachineRewardedWaves: [...claim.state.warMachineRewardedWaves, wave] },
    reward: claim.granted ? plan.reward : 0,
    granted: claim.granted,
  };
}

/** Draws one value from a pool using the saved event stream (advances the cursor). */
export function historicalDraw<T>(state: HistoricalEventState, values: readonly T[]): { state: HistoricalEventState; value: T } {
  if (!values.length) throw new Error("Cannot draw from an empty historical pool.");
  const rolled = draw(state);
  return { state: rolled.state, value: values[Math.floor(rolled.value * values.length)]! };
}
