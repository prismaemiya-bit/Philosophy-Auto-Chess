import { characters, type FactionId } from "./characters";
import type { BattleState } from "./battle";
import type { EnlightenmentAgenda, PreparationPlan, ResearchChoice, RevolutionNodeId, SourceRouteId } from "./combat-core";
import { REFORMATION_CANDIDATE_COUNT, claimHistoricalReward, historicalSeedFromText, historicalSeedFromUnitInterval, makeHistoricalEventState, migrateHistoricalEventState, markHistoricalEventResolved, chooseHistoricalStance, effectiveMaxDeploy, historicalDraw, historicalRandom, generateReformationCandidates, chooseReformationCandidate, resolveEconomy, effectiveInterest, resolveHistoricalEffectsFromState, type HistoricalStanceId, type HistoricalEventState } from "./historical-events";
import { DEPLOYMENT_SLOT_IDS, slotTerrain, type DeploymentSlotId } from "./positions";

export const BENCH_SLOTS = ["bench-1", "bench-2", "bench-3", "bench-4", "bench-5", "bench-6", "bench-7", "bench-8", "bench-9"] as const;
export type BenchSlotId = (typeof BENCH_SLOTS)[number];
export const DEPLOY_SLOTS = [...DEPLOYMENT_SLOT_IDS] as const;
export const THRONE_SLOT = "throne-1" as const;
export type SlotId = BenchSlotId | DeploymentSlotId | typeof THRONE_SLOT;
export type Piece = { id: string; characterId: string; star: 1 | 2 | 3; slotId: SlotId; throneReturnSlot?: SlotId; paidCost?: number; hp?: number; maxHp?: number; energy?: number; maxEnergy?: number; shield?: number; blockBonus?: number; blockBonusTicks?: number; damageReduction?: number; damageReductionTicks?: number; tauntTicks?: number; empoweredSkill?: boolean; sublationEchoReady?: boolean; nearDeathUsed?: boolean; lastStandConsumed?: boolean; lastStandCharges?: number; phenomenologyUsed?: boolean; invulnerableTicks?: number; invulnerableUntil?: number; suspendShield?: number; attackSpeedTicks?: number; casts?: number; inductionTargetId?: string; inductionHits?: number; contractGroupId?: string; contractUntil?: number; damageMult?: number; attackRateMult?: number };
export type WaveCheckpoint = {
  wave: number;
  gold: number;
  level: number;
  xp: number;
  coreHp: number;
  shop: Array<string | null>;
  shopFrozen?: boolean;
  pieces: Piece[];
  preparationPlan?: PreparationPlan;
  campaignElapsedSeconds?: number;
  balanceHistory?: BalanceWaveReport[];
  waveEconomy?: EconomyLedger;
  historicalEvents?: HistoricalEventState;
};
export type EconomyLedger = { purchasesGold: number; refreshes: number; xpPurchases: number; researchGold: number };
export type BalanceWaveReport = {
  wave: number; success: boolean; elapsedSeconds: number;
  economy: EconomyLedger & { startGold: number; endGold: number; baseIncome: number; perfectBonus: number; interest: number; killGold: number; totalIncome: number };
  progress: { level: number; xp: number; deployed: number; rosterValue: number; oneStar: number; twoStar: number; threeStar: number };
  routes: Record<SourceRouteId, { spawned: number; defeated: number; leaked: number }>;
  units: Record<string, import("./battle").UnitWaveStatistics>;
  outcome: { deaths: number; leaks: number; coreDamage: number };
  philosopherKing?: {
    pieceId: string; characterId: string; star: Piece["star"]; normalSlot?: SlotId;
    output: { damage: number; healing: number; shielding: number };
    throneBonus: { damage: number; healing: number; shielding: number };
    barrier: { maxHp: number; damageTaken: number; blockedWeight: number; hits: number; broke: boolean };
  };
  synergyTriggers: Record<string, number>;
  bossPhases: Array<{ id: string; name: string; triggeredAt: number }>;
  coreDamageBySource: Record<string, number>;
};
export const SAVE_VERSION = 7;
export class UnsupportedSaveVersionError extends Error {
  readonly saveVersion: number;
  constructor(saveVersion: number) {
    super(`Save version ${saveVersion} is newer than supported version ${SAVE_VERSION}.`);
    this.name = "UnsupportedSaveVersionError";
    this.saveVersion = saveVersion;
  }
}
export type GameState = { saveVersion: number; gold: number; level: number; xp: number; wave: number; coreHp: number; shop: Array<string | null>; shopFrozen: boolean; pieces: Piece[]; preparationPlan: PreparationPlan; historicalEvents: HistoricalEventState; campaignElapsedSeconds?: number; balanceHistory?: BalanceWaveReport[]; waveEconomy?: EconomyLedger; battle?: BattleState; waveCheckpoint?: WaveCheckpoint };
export type PersistedGameState = Omit<GameState, "battle" | "waveCheckpoint" | "pieces"> & { pieces: Array<Pick<Piece, "id" | "characterId" | "star" | "slotId" | "throneReturnSlot" | "paidCost">> };

export const MAX_LEVEL = 8;
const XP_REQUIREMENTS = [0, 4, 8, 12, 16, 20, 32, 48];
const DEPLOY_CAPACITY = [0, 2, 3, 4, 5, 6, 7, 8, 8];
const SHOP_ODDS: Record<number, number[]> = { 1: [72, 25, 3, 0], 2: [58, 33, 9, 0], 3: [42, 40, 18, 0], 4: [28, 42, 26, 4], 5: [17, 36, 34, 13], 6: [8, 24, 40, 28], 7: [4, 18, 40, 38], 8: [2, 12, 38, 48] };
export const shopOddsForLevel = (level: number) => [...(SHOP_ODDS[Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)))] ?? SHOP_ODDS[1])];
export const ECONOMY_RULES = { startingGold: 8, goldCap: 50, refreshCost: 2, experienceCost: 4, experienceAmount: 4, automaticWaveExperience: 4, baseIncome: 10, perfectDefenseBonus: 1, interestStep: 5, maxInterest: 3 } as const;
const initialShop = ["fichte", "socrates", "epicurus", "plato", "aristotle"];
const legacyCharacterIds: Record<string, string> = {
  archivist: "hegel", questioner: "fichte", forger: "schelling", wayfarer: "kant",
  dialectician: "plato", oracle: "husserl", sentinel: "aristotle", inquisitor: "heidegger",
};
const slotIds = new Set<string>([...BENCH_SLOTS, ...DEPLOY_SLOTS, THRONE_SLOT]);
export const isSlotId = (slotId: unknown): slotId is SlotId => typeof slotId === "string" && slotIds.has(slotId);
export const isDeploySlot = (slotId: unknown): slotId is DeploymentSlotId => typeof slotId === "string" && slotId.startsWith("deploy-") && slotIds.has(slotId);
export const isThroneSlot = (slotId: unknown): slotId is typeof THRONE_SLOT => slotId === THRONE_SLOT;
export const isFieldedSlot = (slotId: unknown): slotId is DeploymentSlotId | typeof THRONE_SLOT => isDeploySlot(slotId) || isThroneSlot(slotId);
export const hasPhilosopherKingUnlock = (pieces: Piece[]) => pieces.some((piece) => isFieldedSlot(piece.slotId) && piece.characterId === "plato" && piece.star >= 2);
export const xpRequired = (level: number) => XP_REQUIREMENTS[Math.min(level, XP_REQUIREMENTS.length - 1)] ?? 28;
export const maxDeployForLevel = (level: number) => DEPLOY_CAPACITY[Math.min(MAX_LEVEL, Math.max(1, level))] ?? 8;
export const saleRefund = (cost: number, star: Piece["star"]) => {
  const copyCount = star === 1 ? 1 : star === 2 ? 3 : 9;
  const mergeDiscount = star === 1 ? 0 : star === 2 ? 1 : 2;
  return Math.max(1, cost * copyCount - mergeDiscount);
};
export function normalizeProgress(levelValue: number, xpValue: number) {
  let level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(levelValue)));
  let xp = Math.max(0, Math.floor(xpValue));
  while (level < MAX_LEVEL && xp >= xpRequired(level)) { xp -= xpRequired(level); level += 1; }
  // At the cap retain a valid in-level value rather than displaying impossible
  // progress imported from an earlier save.
  if (level === MAX_LEVEL) xp = Math.min(xp, Math.max(0, xpRequired(level) - 1));
  return { level, xp };
}
export const capGold = (gold: number) => Math.max(0, Math.min(ECONOMY_RULES.goldCap, Math.floor(gold)));
export const interestForGold = (gold: number) => Math.min(ECONOMY_RULES.maxInterest, Math.floor(Math.max(0, gold) / ECONOMY_RULES.interestStep));
export const makeInitialState = (random = Math.random, historicalSeed?: number): GameState => {
  const shop = pickShop(1, random);
  const seed = historicalSeed ?? historicalSeedFromUnitInterval(random());
  return { saveVersion: SAVE_VERSION, gold: ECONOMY_RULES.startingGold, level: 1, xp: 0, wave: 1, coreHp: 100, shop, shopFrozen: false, pieces: [], preparationPlan: {}, historicalEvents: makeHistoricalEventState(seed), campaignElapsedSeconds: 0 };
};
export const settlementIncome = (lockedInterest: number, coreUndamaged: boolean) => ({ baseIncome: ECONOMY_RULES.baseIncome, interest: Math.max(0, Math.min(ECONOMY_RULES.maxInterest, Math.floor(lockedInterest))), perfectBonus: coreUndamaged ? ECONOMY_RULES.perfectDefenseBonus : 0 });

/** Settlement income adjusted for historical event economy modifiers. */
export function effectiveSettlementIncome(lockedInterest: number, coreUndamaged: boolean, historicalEvents: HistoricalEventState) {
  const economy = resolveEconomy(historicalEvents);
  return {
    baseIncome: economy.baseIncome,
    interest: economy.noInterest ? 0 : Math.max(0, Math.min(economy.maxInterest, Math.floor(lockedInterest))),
    perfectBonus: coreUndamaged ? ECONOMY_RULES.perfectDefenseBonus : 0,
  };
}

/** Effective interest computation incorporating historical event economy modifiers. */
export function effectiveInterestForGold(gold: number, historicalEvents: HistoricalEventState): number {
  return effectiveInterest(gold, historicalEvents);
}

/** Effective refresh cost considering historical event effects. */
export function effectiveRefreshCost(): number {
  return ECONOMY_RULES.refreshCost;
}

const nodes: RevolutionNodeId[] = ["debate-plaza", "side-gate", "core-front"];
const researchChoices: ResearchChoice[] = ["mechanics", "medicine", "political-arithmetic"];
const enlightenmentAgendas: EnlightenmentAgenda[] = ["market", "education", "citizen"];
const stablePiece = (piece: Piece): PersistedGameState["pieces"][number] => ({ id: piece.id, characterId: piece.characterId, star: piece.star, slotId: piece.slotId, throneReturnSlot: piece.slotId === THRONE_SLOT && isDeploySlot(piece.throneReturnSlot ?? "bench-1") ? piece.throneReturnSlot : undefined, paidCost: typeof piece.paidCost === "number" && Number.isFinite(piece.paidCost) ? Math.max(0, Math.floor(piece.paidCost)) : undefined });
const sanitizeEconomyLedger = (ledger: unknown): EconomyLedger => {
  const raw = ledger && typeof ledger === "object" ? ledger as Partial<EconomyLedger> : {};
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return { purchasesGold: number(raw.purchasesGold), refreshes: number(raw.refreshes), xpPurchases: number(raw.xpPurchases), researchGold: number(raw.researchGold) };
};

/** Persist only durable preparation data. A running/failed wave rolls back to its checkpoint. */
export function createPersistedState(state: GameState): PersistedGameState {
  const mustRollback = state.battle?.status === "running" || state.battle?.status === "defeat";
  const checkpoint = mustRollback ? state.waveCheckpoint : undefined;
  const pieces = checkpoint?.pieces ?? state.pieces;
  return {
    saveVersion: SAVE_VERSION,
    gold: checkpoint?.gold ?? state.gold,
    level: checkpoint?.level ?? state.level,
    xp: checkpoint?.xp ?? state.xp,
    wave: checkpoint?.wave ?? state.wave,
    coreHp: checkpoint?.coreHp ?? state.coreHp,
    shop: [...(checkpoint?.shop ?? state.shop)],
    shopFrozen: checkpoint?.shopFrozen ?? state.shopFrozen,
    pieces: pieces.map(stablePiece),
    preparationPlan: validatePreparationPlan(checkpoint?.preparationPlan ?? state.preparationPlan, pieces),
    campaignElapsedSeconds: Math.max(0, checkpoint?.campaignElapsedSeconds ?? state.campaignElapsedSeconds ?? 0),
    balanceHistory: (checkpoint?.balanceHistory ?? state.balanceHistory ?? []).slice(-20),
    waveEconomy: checkpoint
      ? checkpoint.waveEconomy ? sanitizeEconomyLedger(checkpoint.waveEconomy) : undefined
      : state.waveEconomy ? sanitizeEconomyLedger(state.waveEconomy) : undefined,
    historicalEvents: checkpoint?.historicalEvents ?? state.historicalEvents,
  };
}

export const serializeGameState = (state: GameState) => JSON.stringify(createPersistedState(state));

/** Sanitizes persisted choices without reading React/UI state. */
export function validatePreparationPlan(plan: unknown, pieces: Piece[]): PreparationPlan {
  const raw = plan && typeof plan === "object" ? plan as Partial<PreparationPlan> : {};
  const deployed = pieces.filter((piece) => isFieldedSlot(piece.slotId));
  const deployedCharacterIds = new Set(deployed.map((piece) => piece.characterId));
  const factionCount = (faction: string) => [...deployedCharacterIds].filter((characterId) => characters.find((unit) => unit.id === characterId)?.faction === faction).length;
  // A rostrum is a run-level choice. Moving its philosopher to the bench must
  // not erase it and cause another automatic prompt; combat snapshots still
  // fall back deterministically whenever that philosopher is not deployed.
  const greekRostrum = typeof raw.rostrumId === "string" && pieces.some((piece) => piece.id === raw.rostrumId && characters.find((unit) => unit.id === piece.characterId)?.faction === "greece") ? raw.rostrumId : undefined;
  const british = factionCount("britain");
  const enlightenmentCount = ["rousseau", "locke", "hume", "kant"].filter((characterId) => deployedCharacterIds.has(characterId)).length;
  const rawPending = typeof raw.pendingResearchChoices === "number" && Number.isFinite(raw.pendingResearchChoices) ? raw.pendingResearchChoices : 0;
  const pendingResearchChoices = british >= 4 ? Math.min(british >= 6 ? 2 : 1, Math.max(0, Math.floor(rawPending))) as 0 | 1 | 2 : 0;
  const pendingResearchSelections = Array.isArray(raw.pendingResearchSelections) ? [...new Set(raw.pendingResearchSelections.filter((choice): choice is ResearchChoice => typeof choice === "string" && researchChoices.includes(choice)))].slice(0, pendingResearchChoices) : [];
  const activeResearches = Array.isArray(raw.activeResearches) ? raw.activeResearches.flatMap((research) => research && typeof research === "object" && (research as { choice?: unknown }).choice !== "political-arithmetic" && researchChoices.includes((research as { choice?: ResearchChoice }).choice ?? "" as ResearchChoice) && Number.isFinite((research as { wavesRemaining?: unknown }).wavesRemaining) && Number((research as { wavesRemaining: number }).wavesRemaining) > 0 ? [{ choice: (research as { choice: Exclude<ResearchChoice, "political-arithmetic"> }).choice, wavesRemaining: Math.min(2, Math.floor((research as { wavesRemaining: number }).wavesRemaining)) }] : []).slice(0, 2) : [];
  return {
    rostrumId: greekRostrum,
    // Do not silently mark France as chosen before the player ever fields the
    // trait. createTraitSnapshot owns the deterministic debate-plaza fallback.
    revolutionNodeId: typeof raw.revolutionNodeId === "string" && nodes.includes(raw.revolutionNodeId) ? raw.revolutionNodeId : undefined,
    pendingResearchChoices,
    pendingResearchSelections,
    activeResearches,
    politicalArithmeticClaimed: raw.politicalArithmeticClaimed === true,
    researchAwardedWave: typeof raw.researchAwardedWave === "number" && Number.isFinite(raw.researchAwardedWave) ? Math.max(0, Math.floor(raw.researchAwardedWave)) : undefined,
    enlightenmentAgendas: Array.isArray(raw.enlightenmentAgendas) ? [...new Set(raw.enlightenmentAgendas.filter((agenda): agenda is EnlightenmentAgenda => typeof agenda === "string" && enlightenmentAgendas.includes(agenda)))].slice(0, enlightenmentCount >= 4 ? 2 : 1) : [],
    enlightenmentAppliedWave: typeof raw.enlightenmentAppliedWave === "number" && Number.isFinite(raw.enlightenmentAppliedWave) ? Math.max(0, Math.floor(raw.enlightenmentAppliedWave)) : undefined,
  };
}

export function updatePreparationPlan(state: GameState, patch: Partial<PreparationPlan>) {
  if (state.battle?.status === "running") return { state, message: "准备方案只能在准备阶段修改。", ok: false };
  const preparationPlan = validatePreparationPlan({ ...state.preparationPlan, ...patch }, state.pieces);
  return { state: { ...state, preparationPlan }, message: "准备方案已更新。", ok: true };
}

export function chooseResearch(state: GameState, choice: ResearchChoice) {
  if (state.battle?.status === "running") return { state, message: "研究成果只能在准备阶段领取。", ok: false };
  const pending = state.preparationPlan.pendingResearchChoices ?? 0;
  const selections = state.preparationPlan.pendingResearchSelections ?? [];
  if (!pending || !researchChoices.includes(choice)) return { state, message: "当前没有可领取的研究成果。", ok: false };
  if (selections.includes(choice)) return { state, message: "同一次研究结论不能选择重复方向。", ok: false };
  const deployedBritishIds = new Set(state.pieces.filter((piece) => isFieldedSlot(piece.slotId) && characters.find((unit) => unit.id === piece.characterId)?.faction === "britain").map((piece) => piece.characterId));
  const duration = deployedBritishIds.size >= 6 ? 2 : 1;
  const alreadyClaimed = state.preparationPlan.politicalArithmeticClaimed === true;
  if (choice === "political-arithmetic" && alreadyClaimed) return { state, message: "政治算术每波只能领取一次。", ok: false };
  const activeResearches = choice === "political-arithmetic" ? state.preparationPlan.activeResearches ?? [] : [...(state.preparationPlan.activeResearches ?? []).filter((research) => research.choice !== choice), { choice, wavesRemaining: duration }];
  const researchGold = choice === "political-arithmetic" ? 2 : 0;
  const gold = capGold(state.gold + researchGold);
  const ledger = sanitizeEconomyLedger(state.waveEconomy);
  const remaining = pending - 1;
  const preparationPlan = validatePreparationPlan({ ...state.preparationPlan, pendingResearchChoices: remaining, pendingResearchSelections: remaining ? [...selections, choice] : [], activeResearches, politicalArithmeticClaimed: alreadyClaimed || choice === "political-arithmetic" }, state.pieces);
  return { state: { ...state, gold, preparationPlan, waveEconomy: researchGold ? { ...ledger, researchGold: ledger.researchGold + researchGold } : state.waveEconomy }, message: "研究成果已领取。", ok: true };
}

export function chooseEnlightenmentAgendas(state: GameState, agendas: EnlightenmentAgenda[]) {
  if (state.battle?.status === "running") return { state, message: "启蒙议程只能在准备阶段选择。", ok: false };
  const deployed = state.pieces.filter((piece) => isFieldedSlot(piece.slotId));
  const deployedCharacterIds = new Set(deployed.map((piece) => piece.characterId));
  const count = ["rousseau", "locke", "hume", "kant"].filter((characterId) => deployedCharacterIds.has(characterId)).length;
  if (count < 3) return { state, message: "启蒙羁绊尚未激活。", ok: false };
  const valid = [...new Set(agendas.filter((agenda) => enlightenmentAgendas.includes(agenda)))].slice(0, count >= 4 ? 2 : 1);
  const preparationPlan = validatePreparationPlan({ ...state.preparationPlan, enlightenmentAgendas: valid }, state.pieces);
  return { state: { ...state, preparationPlan }, message: "启蒙议程已确定。", ok: true };
}

/** Converts saved data from the original template roster to the current roster. */
export function migrateState(raw: unknown): GameState {
  if (!raw || typeof raw !== "object") return makeInitialState();
  const incoming = raw as Partial<GameState>;
  const incomingVersion = (incoming as { saveVersion?: unknown }).saveVersion;
  if (typeof incomingVersion === "number" && Number.isFinite(incomingVersion) && incomingVersion > SAVE_VERSION) {
    throw new UnsupportedSaveVersionError(incomingVersion);
  }
  const unsafeBattle = incoming.battle?.status === "running" || incoming.battle?.status === "defeat";
  const checkpoint = unsafeBattle && incoming.waveCheckpoint && typeof incoming.waveCheckpoint === "object" ? incoming.waveCheckpoint : undefined;
  const saved: Partial<GameState> = checkpoint ? {
    ...incoming,
    gold: checkpoint.gold,
    level: checkpoint.level,
    xp: checkpoint.xp,
    wave: checkpoint.wave,
    coreHp: checkpoint.coreHp,
    shop: checkpoint.shop,
    shopFrozen: checkpoint.shopFrozen,
    pieces: checkpoint.pieces,
    preparationPlan: checkpoint.preparationPlan,
    campaignElapsedSeconds: checkpoint.campaignElapsedSeconds,
    balanceHistory: checkpoint.balanceHistory,
    waveEconomy: checkpoint.waveEconomy,
    historicalEvents: checkpoint.historicalEvents,
    battle: undefined,
    waveCheckpoint: undefined,
  } : { ...incoming, battle: undefined, waveCheckpoint: undefined };
  const resolveId = (id: unknown) => typeof id === "string" ? legacyCharacterIds[id] ?? id : "";
  const isKnownId = (id: string) => characters.some((unit) => unit.id === id);
  const fallback = makeInitialState(() => 0);
  const number = (value: unknown, fallbackValue: number) => typeof value === "number" && Number.isFinite(value) ? value : fallbackValue;
  const progress = normalizeProgress(number(saved.level, fallback.level), number(saved.xp, fallback.xp));
  const shop = (Array.isArray(saved.shop) ? saved.shop : []).slice(0, 5).map((candidate) => {
    const id = resolveId(candidate); return isKnownId(id) ? id : null;
  });
  while (shop.length < 5) shop.push(initialShop[shop.length] ?? null);
  const rawPieces = (Array.isArray(saved.pieces) ? saved.pieces : []).slice(0, BENCH_SLOTS.length + DEPLOY_SLOTS.length + 1).flatMap((piece, index) => {
    if (!piece || typeof piece !== "object") return [];
    const candidate = piece as Partial<Piece>;
    const characterId = resolveId(candidate.characterId);
    if (!isKnownId(characterId) || !isSlotId(candidate.slotId)) return [];
    const star: Piece["star"] = candidate.star === 2 || candidate.star === 3 ? candidate.star : 1;
    const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : `migrated-piece-${index + 1}`;
    const throneReturnSlot = candidate.slotId === THRONE_SLOT && isDeploySlot(candidate.throneReturnSlot) ? candidate.throneReturnSlot : undefined;
    // Rebuild from the V6 stable field allowlist. Never spread imported
    // runtime combat fields such as hp, energy, shields or effect markers.
    const copyCount = star === 1 ? 1 : star === 2 ? 3 : 9;
    const paidCost = typeof candidate.paidCost === "number" && Number.isFinite(candidate.paidCost)
      ? Math.max(0, Math.floor(candidate.paidCost))
      : (characters.find((unit) => unit.id === characterId)?.cost ?? 0) * copyCount;
    return [{ id, characterId, star, slotId: candidate.slotId, ...(throneReturnSlot ? { throneReturnSlot } : {}), paidCost }];
  });
  const historicalFallbackSeed = historicalSeedFromText(JSON.stringify({
    saveVersion: incomingVersion,
    gold: saved.gold,
    level: saved.level,
    xp: saved.xp,
    wave: saved.wave,
    shop,
    pieces: rawPieces.map(stablePiece),
  }));
  const historicalEvents = migrateHistoricalEventState(saved.historicalEvents, Math.max(1, number(saved.wave, fallback.wave)), historicalFallbackSeed);
  const migrationDeployCap = effectiveMaxDeploy(progress.level, historicalEvents);
  // Map V0.1 moved highlands and added new positions. Preserve legal stable
  // positions, otherwise use a unique compatible slot without exceeding the
  // current population cap. Corrupt surplus entries are discarded rather
  // than retaining duplicate slot references.
  const occupied = new Set<SlotId>();
  const usedIds = new Set<string>();
  let fieldedCount = 0;
  let pieces = rawPieces.flatMap((rawPiece) => {
    const baseId = rawPiece.id;
    let id = baseId; let suffix = 2;
    while (usedIds.has(id)) { id = `${baseId}-${suffix}`; suffix += 1; }
    usedIds.add(id);
    const piece = { ...rawPiece, id };
    const terrain = characters.find((unit) => unit.id === piece.characterId)?.terrain;
    const requestedIsBench = BENCH_SLOTS.some((slot) => slot === piece.slotId);
    const canKeepRequested = !occupied.has(piece.slotId) && (
      requestedIsBench
      || (isDeploySlot(piece.slotId) && fieldedCount < migrationDeployCap && terrain !== undefined && slotTerrain[piece.slotId] === terrain)
      || (isThroneSlot(piece.slotId) && fieldedCount < migrationDeployCap)
    );
    let slotId: SlotId | undefined = canKeepRequested ? piece.slotId : undefined;
    if (!slotId) {
      const bench = BENCH_SLOTS.find((slot) => !occupied.has(slot));
      const deploy = fieldedCount < migrationDeployCap && terrain
        ? DEPLOY_SLOTS.find((slot) => slotTerrain[slot] === terrain && !occupied.has(slot))
        : undefined;
      slotId = isFieldedSlot(piece.slotId) ? deploy ?? bench : bench ?? deploy;
    }
    if (!slotId) return [];
    occupied.add(slotId);
    if (isFieldedSlot(slotId)) fieldedCount += 1;
    return [{ ...piece, slotId }];
  });
  if (!hasPhilosopherKingUnlock(pieces)) {
    const king = pieces.find((piece) => isThroneSlot(piece.slotId));
    if (king) {
      const occupiedSlots = new Set(pieces.filter((piece) => piece.id !== king.id).map((piece) => piece.slotId));
      const bench = BENCH_SLOTS.find((slot) => !occupiedSlots.has(slot));
      const original = king.throneReturnSlot && isDeploySlot(king.throneReturnSlot) && !occupiedSlots.has(king.throneReturnSlot) ? king.throneReturnSlot : undefined;
      const terrain = characters.find((unit) => unit.id === king.characterId)?.terrain;
      const compatible = DEPLOY_SLOTS.find((slot) => !occupiedSlots.has(slot) && slotTerrain[slot] === terrain);
      const safeSlot = bench ?? original ?? compatible;
      if (safeSlot) pieces = pieces.map((piece) => piece.id === king.id ? { ...piece, slotId: safeSlot, throneReturnSlot: undefined } : piece);
      else pieces = pieces.filter((piece) => piece.id !== king.id);
    }
  }
  return {
    saveVersion: SAVE_VERSION, gold: capGold(number(saved.gold, fallback.gold)), level: progress.level,
    xp: progress.xp, wave: Math.max(1, number(saved.wave, fallback.wave)),
    coreHp: Math.max(0, Math.min(100, number(saved.coreHp, fallback.coreHp))), shop, shopFrozen: saved.shopFrozen === true, pieces,
    preparationPlan: validatePreparationPlan(saved.preparationPlan, pieces),
    campaignElapsedSeconds: Math.max(0, number(saved.campaignElapsedSeconds, 0)),
    balanceHistory: Array.isArray(saved.balanceHistory) ? saved.balanceHistory.slice(-20) as BalanceWaveReport[] : [],
    waveEconomy: saved.waveEconomy ? sanitizeEconomyLedger(saved.waveEconomy) : undefined,
    historicalEvents,
    battle: undefined, waveCheckpoint: undefined,
  };
}

let serial = 0;
const pieceId = () => `piece-${Date.now()}-${++serial}`;
const rollCost = (level: number, random = Math.random()) => { const odds = SHOP_ODDS[Math.min(MAX_LEVEL, Math.max(1, level))]; let total = 0; for (let index = 0; index < odds.length; index += 1) { total += odds[index]; if (random * 100 < total) return index + 1; } return 1; };
export const pickShop = (level: number, random = Math.random) => Array.from({ length: 5 }, () => { const cost = rollCost(level, random()); const pool = characters.filter((unit) => unit.cost === cost); const usable = pool.length ? pool : characters.filter((unit) => unit.cost === 1); return usable[Math.floor(random() * usable.length)].id; });
const firstOpenBench = (pieces: Piece[]) => BENCH_SLOTS.find((slot) => !pieces.some((piece) => piece.slotId === slot));
const deployed = (pieces: Piece[]) => pieces.filter((piece) => isFieldedSlot(piece.slotId)).length;
const canUseSlot = (characterId: string, slot: SlotId) => {
  if (!isDeploySlot(slot)) return true;
  const terrain = characters.find((unit) => unit.id === characterId)?.terrain;
  return terrain === "ground" ? slotTerrain[slot] === "ground" : slotTerrain[slot] === "highland";
};

const paidCostFallback = (piece: Pick<Piece, "characterId" | "star">) => {
  const cost = characters.find((unit) => unit.id === piece.characterId)?.cost ?? 0;
  return cost * (piece.star === 1 ? 1 : piece.star === 2 ? 3 : 9);
};

function mergeAll(pieces: Piece[]) {
  let current = [...pieces]; let combined = false; let changed = true;
  while (changed) {
    changed = false;
    for (const star of [1, 2] as const) {
      const groups = new Map<string, Piece[]>();
      current.filter((piece) => piece.star === star).forEach((piece) => { const key = `${piece.characterId}:${star}`; groups.set(key, [...(groups.get(key) ?? []), piece]); });
      const group = [...groups.values()].find((items) => items.length >= 3);
      if (!group) continue;
      // Preserve the tactically meaningful copy. A fielded unit must never be
      // consumed merely because an older bench copy happens to appear first.
      const candidates = [...group].sort((left, right) => Number(isThroneSlot(right.slotId)) - Number(isThroneSlot(left.slotId)) || Number(isDeploySlot(right.slotId)) - Number(isDeploySlot(left.slotId)) || left.id.localeCompare(right.id)).slice(0, 3);
      const [base, ...removed] = candidates;
      const paidCost = candidates.reduce((sum, piece) => sum + Math.max(0, piece.paidCost ?? paidCostFallback(piece)), 0);
      current = current.filter((piece) => !removed.some((unit) => unit.id === piece.id)).map((piece) => piece.id === base.id ? { ...piece, star: (star + 1) as 2 | 3, paidCost } : piece);
      combined = true; changed = true; break;
    }
  }
  return { pieces: current, combined };
}

export function buy(state: GameState, shopIndex: number) {
  if (state.battle?.status === "running") return { state, message: "锁阵后不能购买棋子。", ok: false };
  const characterId = state.shop[shopIndex]; const character = characters.find((unit) => unit.id === characterId); const openBench = firstOpenBench(state.pieces);
  if (!character || !openBench) return { state, message: "备战区已满，无法购买。", ok: false };
  if (state.gold < character.cost) return { state, message: "金币不足。", ok: false };
  const merged = mergeAll([...state.pieces, { id: pieceId(), characterId: character.id, star: 1 as const, slotId: openBench, paidCost: character.cost }]);
  const shop = state.shop.map((id, index) => index === shopIndex ? null : id);
  const preparationPlan = validatePreparationPlan(state.preparationPlan, merged.pieces);
  const ledger = sanitizeEconomyLedger(state.waveEconomy);
  const flags = state.historicalEvents.waveFlags;
  const normalPurchaseSpend = flags.normalPurchaseSpend + character.cost;
  const effects = resolveHistoricalEffectsFromState(state.historicalEvents);
  const freeRefreshesAvailable = effects.freeRefreshSpendThreshold > 0 && normalPurchaseSpend >= effects.freeRefreshSpendThreshold
    ? Math.max(flags.freeRefreshesAvailable, effects.freeRefreshPerWave)
    : flags.freeRefreshesAvailable;
  const historicalEvents = { ...state.historicalEvents, waveFlags: { ...flags, normalPurchaseSpend, freeRefreshesAvailable } };
  return { state: { ...state, gold: state.gold - character.cost, pieces: merged.pieces, shop, preparationPlan, waveEconomy: { ...ledger, purchasesGold: ledger.purchasesGold + character.cost }, historicalEvents }, message: merged.combined ? "三枚同名棋子已合成为更高星级。" : `已购入 ${character.name}。`, ok: true };
}
export function refresh(state: GameState, random = Math.random) {
  if (state.battle?.status === "running") return { state, message: "战斗中不能刷新商店。", ok: false };
  if (state.gold < ECONOMY_RULES.refreshCost) return { state, message: `金币不足，刷新需要 ${ECONOMY_RULES.refreshCost} 金币。`, ok: false };
  const ledger = sanitizeEconomyLedger(state.waveEconomy);
  return { state: { ...state, gold: state.gold - ECONOMY_RULES.refreshCost, shop: pickShop(state.level, random), shopFrozen: false, waveEconomy: { ...ledger, refreshes: ledger.refreshes + 1 } }, message: "商店已刷新。", ok: true };
}
export function toggleShopFreeze(state: GameState) {
  if (state.battle?.status === "running") return { state, message: "战斗中不能更改商店冻结状态。", ok: false };
  const shopFrozen = !state.shopFrozen;
  return { state: { ...state, shopFrozen }, message: shopFrozen ? "商店已冻结；下波结算时保留当前五个槽位。" : "商店已解冻；下波结算时正常更新。", ok: true };
}
export function gainXp(state: GameState) {
  if (state.battle?.status === "running") return { state, message: "战斗中不能购买经验。", ok: false };
  if (state.wave === 1) return { state, message: "第一波为接触校验，经验购买将在第二波准备阶段开放。", ok: false };
  if (state.level >= MAX_LEVEL) return { state, message: "已达到最高等级。", ok: false };
  if (state.gold < ECONOMY_RULES.experienceCost) return { state, message: `金币不足，购买经验需要 ${ECONOMY_RULES.experienceCost} 金币。`, ok: false };
  const progress = normalizeProgress(state.level, state.xp + ECONOMY_RULES.experienceAmount); const upgraded = progress.level > state.level;
  const { level, xp } = progress;
  const ledger = sanitizeEconomyLedger(state.waveEconomy);
  return { state: { ...state, gold: state.gold - ECONOMY_RULES.experienceCost, xp, level, waveEconomy: { ...ledger, xpPurchases: ledger.xpPurchases + 1 } }, message: upgraded ? `理念阶位提升至 ${level}，最大部署人数增加。` : `获得 ${ECONOMY_RULES.experienceAmount} 点经验。`, ok: true };
}
export function move(state: GameState, pieceIdToMove: string, targetSlot: SlotId) {
  const source = state.pieces.find((piece) => piece.id === pieceIdToMove);
  if (!source || source.slotId === targetSlot) return { state, message: "", ok: false };
  if (state.battle?.status === "running") return { state, message: "阵容已锁定，战斗结束后才能移动棋子。", ok: false };
  const target = state.pieces.find((piece) => piece.slotId === targetSlot);
  if (isThroneSlot(targetSlot)) {
    if (!isDeploySlot(source.slotId)) return { state, message: "只有已部署棋子可以被任命为哲人王。", ok: false };
    if (target) return { state, message: "王座同时只能容纳一名哲人王。", ok: false };
    if (!hasPhilosopherKingUnlock(state.pieces)) return { state, message: "需要先将二阶柏拉图部署上场，才能解锁王座。", ok: false };
    const pieces = state.pieces.map((piece) => piece.id === source.id ? { ...piece, slotId: THRONE_SLOT, throneReturnSlot: source.slotId } : piece);
    return { state: { ...state, pieces, preparationPlan: validatePreparationPlan(state.preparationPlan, pieces) }, message: `${characters.find((unit) => unit.id === source.characterId)?.name ?? "棋子"}已被任命为哲人王。`, ok: true };
  }
  if (isThroneSlot(source.slotId) && target) return { state, message: "请将哲人王拖到空的普通部署格或备战位。", ok: false };
  if (!canUseSlot(source.characterId, targetSlot) || (target && !canUseSlot(target.characterId, source.slotId))) return { state, message: "近战只能部署在地面格，远程只能部署在高台格。", ok: false };
  if (!target && isDeploySlot(targetSlot) && !isFieldedSlot(source.slotId) && deployed(state.pieces) >= effectiveMaxDeploy(state.level, state.historicalEvents)) return { state, message: `当前部署上限为 ${effectiveMaxDeploy(state.level, state.historicalEvents)} 名棋子。`, ok: false };
  let pieces = state.pieces.map((piece) => piece.id === source.id ? { ...piece, slotId: targetSlot, throneReturnSlot: isThroneSlot(source.slotId) ? undefined : piece.throneReturnSlot } : target && piece.id === target.id ? { ...piece, slotId: source.slotId } : piece);
  if (!hasPhilosopherKingUnlock(pieces)) {
    const king = pieces.find((piece) => isThroneSlot(piece.slotId));
    if (king) {
      const bench = firstOpenBench(pieces);
      const original = king.throneReturnSlot && isDeploySlot(king.throneReturnSlot) && !pieces.some((piece) => piece.slotId === king.throneReturnSlot) ? king.throneReturnSlot : undefined;
      const safeSlot = bench ?? original;
      if (!safeSlot) return { state, message: "王座关闭后没有安全位置安置哲人王；请先腾出备战位或原部署格。", ok: false };
      pieces = pieces.map((piece) => piece.id === king.id ? { ...piece, slotId: safeSlot, throneReturnSlot: undefined } : piece);
    }
  }
  const merged = mergeAll(pieces);
  const preparationPlan = validatePreparationPlan(state.preparationPlan, merged.pieces);
  return { state: { ...state, pieces: merged.pieces, preparationPlan }, message: merged.combined ? "位置交换完成，并触发三合一升星。" : target ? "棋子位置已交换。" : "棋子已移动。", ok: true };
}
export function sell(state: GameState, pieceIdToSell: string) {
  if (state.battle?.status === "running") return { state, message: "锁阵后不能出售棋子。", ok: false };
  const piece = state.pieces.find((unit) => unit.id === pieceIdToSell); const character = piece && characters.find((unit) => unit.id === piece.characterId);
  if (!piece || !character) return { state, message: "", ok: false };
  // One-star resale always returns at least its card cost. Merged units use
  // their real three/nine-copy investment with a small merge discount.
  const refund = saleRefund(character.cost, piece.star);
  let pieces = state.pieces.filter((unit) => unit.id !== piece.id);
  if (!hasPhilosopherKingUnlock(pieces)) {
    const king = pieces.find((unit) => isThroneSlot(unit.slotId));
    if (king) {
      const bench = firstOpenBench(pieces);
      const original = king.throneReturnSlot && isDeploySlot(king.throneReturnSlot) && !pieces.some((unit) => unit.slotId === king.throneReturnSlot) ? king.throneReturnSlot : undefined;
      const safeSlot = bench ?? original;
      if (!safeSlot) return { state, message: "出售柏拉图会关闭王座，但当前没有安全位置安置哲人王。", ok: false };
      pieces = pieces.map((unit) => unit.id === king.id ? { ...unit, slotId: safeSlot, throneReturnSlot: undefined } : unit);
    }
  }
  const preparationPlan = validatePreparationPlan(state.preparationPlan, pieces);
  return { state: { ...state, gold: capGold(state.gold + refund), pieces, preparationPlan }, message: `已出售 ${character.name}，获得 ${refund} 金币。`, ok: true };
}

// ============================================================================
// 历史事件引擎动作（批次 B）。规则在这里集中转换；UI 只调用、不结算。
// ============================================================================

export function confirmNormalEvent(state: GameState) {
  if (state.battle?.status === "running") return { state, message: "战斗中不能确认历史事件。", ok: false };
  if (!state.historicalEvents.eventId) return { state, message: "当前没有待确认的历史事件。", ok: false };
  const recoverableReformation = state.historicalEvents.eventId === "event:reformation" && state.historicalEvents.reformationCandidates?.length !== REFORMATION_CANDIDATE_COUNT && !state.historicalEvents.reformationChosenId;
  if (state.historicalEvents.eventResolved && !recoverableReformation) return { state, message: "历史事件已经确认。", ok: false };
  let historicalEvents = state.historicalEvents.eventResolved ? state.historicalEvents : markHistoricalEventResolved(state.historicalEvents);
  // For reformation: generate the three choose-one candidates now.
  if (historicalEvents.eventId === "event:reformation" && !historicalEvents.reformationCandidates?.length) {
    historicalEvents = generateReformationCandidates(historicalEvents, (faction: FactionId) =>
      characters.filter((unit) => unit.faction === faction && unit.cost === 2).map((unit) => unit.id),
    );
  }
  return { state: { ...state, historicalEvents }, message: "历史事件已确认，可继续准备。", ok: true };
}

export function chooseRealityStance(state: GameState, stanceId: HistoricalStanceId) {
  if (state.battle?.status === "running") return { state, message: "意识形态只能在准备阶段选择。", ok: false };
  if (!state.historicalEvents.stanceCandidateIds.includes(stanceId)) return { state, message: "该立场不在第 6 波候选列表中。", ok: false };
  if (state.historicalEvents.selectedStanceId) return { state, message: "意识形态已经选择。", ok: false };
  const historicalEvents = chooseHistoricalStance(state.historicalEvents, stanceId);
  return { state: { ...state, historicalEvents }, message: "意识形态已确定。", ok: true };
}

const REFORMATION_REWARD_ID = "reward:reformation";

/** Player chooses one of the three reformation candidates and receives the piece (paidCost 0).
 *  Candidates must have been generated by confirmNormalEvent first. */
export function chooseReformationReward(state: GameState, chosenCharacterId: string) {
  if (state.battle?.status === "running") return { state, message: "宗教改革奖励只能在准备阶段领取。", ok: false };
  if (state.historicalEvents.eventId !== "event:reformation") return { state, message: "当前事件不是宗教改革。", ok: false };
  if (!state.historicalEvents.eventResolved) return { state, message: "请先确认第 3 波历史事件。", ok: false };
  const candidates = state.historicalEvents.reformationCandidates;
  if (!candidates || candidates.length !== REFORMATION_CANDIDATE_COUNT) return { state, message: "宗教改革候选尚未生成，请先确认历史事件。", ok: false };
  if (state.historicalEvents.reformationChosenId && state.historicalEvents.reformationChosenId !== chosenCharacterId) {
    return { state, message: "已选择宗教改革棋子，不可更改。", ok: false };
  }
  if (!candidates.includes(chosenCharacterId)) return { state, message: "所选棋子不在宗教改革候选列表中。", ok: false };

  // Store choice (idempotent).
  let historicalEvents = chooseReformationCandidate(state.historicalEvents, chosenCharacterId);

  // If already claimed, try to claim pending piece.
  if (historicalEvents.grantedRewardIds.includes(REFORMATION_REWARD_ID)) {
    return claimPendingReformationReward({ ...state, historicalEvents });
  }

  // Grant the chosen piece.
  const openBench = firstOpenBench(state.pieces);
  const character = characters.find((unit) => unit.id === chosenCharacterId);
  if (!character) return { state, message: "无效的棋子 ID。", ok: false };

  let pieces = state.pieces;
  let pendingCharId: string | undefined;
  if (openBench) {
    pieces = [...pieces, { id: pieceId(), characterId: chosenCharacterId, star: 1 as const, slotId: openBench, paidCost: 0 }];
  } else {
    pendingCharId = chosenCharacterId;
  }

  const rewardClaim = claimHistoricalReward(historicalEvents, REFORMATION_REWARD_ID);
  historicalEvents = { ...rewardClaim.state, ...(pendingCharId ? { pendingReformationReward: [pendingCharId] } : {}) };
  const message = pendingCharId
    ? "备战区已满，已选宗教改革棋子待空出后领取。"
    : `已免费领取 ${character.name}（paidCost 为 0）。`;
  return { state: { ...state, pieces, historicalEvents }, message, ok: true };
}

/** Claims the chosen reformation piece that could not be placed earlier. */
export function claimPendingReformationReward(state: GameState) {
  const pending = state.historicalEvents.pendingReformationReward;
  if (!pending?.length) return { state, message: "没有待领取的宗教改革棋子。", ok: false };
  const openBench = firstOpenBench(state.pieces);
  if (!openBench) return { state: { ...state }, message: "备战区已满，宗教改革棋子仍待领取。", ok: false };
  const chosenId = pending[0]!;
  const pieces = [...state.pieces, { id: pieceId(), characterId: chosenId, star: 1 as const, slotId: openBench, paidCost: 0 }];
  const historicalEvents = { ...state.historicalEvents, pendingReformationReward: [] };
  const character = characters.find((unit) => unit.id === chosenId);
  return { state: { ...state, pieces, historicalEvents }, message: `已领取待领的 ${character?.name ?? chosenId}。`, ok: true };
}

// ============================================================================
// Phase 2: Economy event engine actions
// ============================================================================

/** Reformism: once per wave, replace a shop slot with another piece of the same cost. */
export function reformistReplace(state: GameState, shopIndex: number) {
  if (state.battle?.status === "running") return { state, message: "战斗中不能替换棋子。", ok: false };
  if (state.historicalEvents.selectedStanceId !== "stance:reformism") return { state, message: "只有改良主义立场允许替换。", ok: false };
  if (state.historicalEvents.waveFlags.reformistReplacementUsed) return { state, message: "本波已使用过改良主义替换。", ok: false };
  const currentCharacterId = state.shop[shopIndex];
  if (!currentCharacterId) return { state, message: "该商店槽位为空。", ok: false };
  const current = characters.find((unit) => unit.id === currentCharacterId);
  if (!current) return { state, message: "无效的棋子。", ok: false };

  // Find the same-cost pool (excluding the current piece).
  const pool = characters.filter((unit) => unit.cost === current.cost && unit.id !== current.id);
  if (!pool.length) return { state, message: "没有同费用棋子可替换。", ok: false };

  // Use the historical event random stream.
  const draw = historicalDraw(state.historicalEvents, pool.map((unit) => unit.id));
  const newShop = state.shop.map((id, idx) => idx === shopIndex ? draw.value : id);
  const historicalEvents = { ...draw.state, waveFlags: { ...draw.state.waveFlags, reformistReplacementUsed: true } };
  return { state: { ...state, shop: newShop, historicalEvents }, message: `改良替换：${current.name} → ${pool.find((u) => u.id === draw.value)?.name ?? draw.value}。`, ok: true };
}

/** Industrial Revolution: track normal purchase spend and grant free refresh. */
export function getFreeRefreshesAvailable(state: GameState): number {
  const effects = resolveHistoricalEffectsFromState(state.historicalEvents);
  const threshold = effects.freeRefreshSpendThreshold;
  if (threshold <= 0) return 0;
  const flags = state.historicalEvents.waveFlags;
  const earned = flags.normalPurchaseSpend >= threshold ? effects.freeRefreshPerWave : 0;
  const remaining = Math.max(flags.freeRefreshesAvailable, earned) - flags.freeRefreshesUsed;
  return Math.max(0, remaining);
}

/** Use one industrial revolution free refresh (zero gold cost). */
export function useFreeRefresh(state: GameState) {
  if (state.battle?.status === "running") return { state, message: "战斗中不能刷新商店。", ok: false };
  if (getFreeRefreshesAvailable(state) <= 0) return { state, message: "本波没有可用的免费刷新次数。", ok: false };
  const flags = state.historicalEvents.waveFlags;
  let historicalEvents = state.historicalEvents;
  const random = () => {
    const next = historicalRandom(historicalEvents);
    historicalEvents = next.state;
    return next.value;
  };
  const shop = pickShop(state.level, random);
  historicalEvents = { ...historicalEvents, waveFlags: { ...flags, freeRefreshesUsed: flags.freeRefreshesUsed + 1 } };
  return { state: { ...state, shop, shopFrozen: false, historicalEvents }, message: "已使用工业革命免费刷新（不消耗金币）。", ok: true };
}

/** Liberalism: once per wave, sell a piece for its full paidCost instead of standard saleRefund. */
export function liberalFullSale(state: GameState, pieceIdToSell: string) {
  if (state.battle?.status === "running") return { state, message: "锁阵后不能出售棋子。", ok: false };
  if (state.historicalEvents.selectedStanceId !== "stance:liberalism") return { state, message: "只有自由主义立场允许完整退款。", ok: false };
  if (state.historicalEvents.waveFlags.liberalFullSaleUsed) return { state, message: "本波已使用过自由主义完整退款。", ok: false };
  const piece = state.pieces.find((unit) => unit.id === pieceIdToSell);
  const character = piece && characters.find((unit) => unit.id === piece.characterId);
  if (!piece || !character) return { state, message: "", ok: false };

  const refund = piece.paidCost ?? 0;
  if (refund <= 0) return { state, message: `${character.name} 为免费棋子，完整退款为 0，建议使用普通出售。`, ok: false };
  if (state.gold + refund > ECONOMY_RULES.goldCap) {
    const requiredSpace = state.gold + refund - ECONOMY_RULES.goldCap;
    return { state, message: `请先消费至少 ${requiredSpace} 金币再完整退款，避免超过 ${ECONOMY_RULES.goldCap} 金币上限。`, ok: false };
  }

  let pieces = state.pieces.filter((unit) => unit.id !== piece.id);
  if (!hasPhilosopherKingUnlock(pieces)) {
    const king = pieces.find((unit) => isThroneSlot(unit.slotId));
    if (king) {
      const bench = firstOpenBench(pieces);
      const safeSlot = bench ?? (king.throneReturnSlot && isDeploySlot(king.throneReturnSlot) && !pieces.some((u) => u.slotId === king.throneReturnSlot) ? king.throneReturnSlot : undefined);
      if (!safeSlot) return { state, message: "自由主义出售会关闭王座，但当前没有安全位置安置哲人王。", ok: false };
      pieces = pieces.map((unit) => unit.id === king.id ? { ...unit, slotId: safeSlot, throneReturnSlot: undefined } : unit);
    }
  }
  const preparationPlan = validatePreparationPlan(state.preparationPlan, pieces);
  const historicalEvents = { ...state.historicalEvents, waveFlags: { ...state.historicalEvents.waveFlags, liberalFullSaleUsed: true } };
  return { state: { ...state, gold: state.gold + refund, pieces, preparationPlan, historicalEvents }, message: `自由主义完整退款：${character.name} 返还 ${refund} 金币。`, ok: true };
}
