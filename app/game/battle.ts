import { characterById } from "./characters";
import {
  CombatEventQueue, FIXED_STEP_SECONDS, StatusManager, canGenerateMechanic,
  createTraitSnapshot, finiteNonNegative,
  type CombatEvent, type CombatPhase, type EffectProfile, type EnlightenmentAgenda, type RevolutionNodeId,
  type SourceRouteId, type TimedStatus, type TraitSnapshot,
} from "./combat-core";
import { capGold, chooseResearch, ECONOMY_RULES, effectiveInterestForGold, effectiveSettlementIncome, isDeploySlot, isFieldedSlot, isThroneSlot, normalizeProgress, pickShop, validatePreparationPlan, type BalanceWaveReport, type GameState, type Piece } from "./engine";
import { HISTORICAL_RULES, advanceHistoricalEventMilestones, claimWarMachineWaveReward, cloneHistoricalEventState, effectiveMaxDeploy, frenchRevolutionMultipliers, pendingHistoricalDecision, resolveHistoricalEffectsFromState, resolveWarMachinePlan, warMachineRoutesForWave, type ResolvedHistoricalEffects } from "./historical-events";
import { deploymentById, deploymentPoint, distance, revolutionNodePoint, ROYAL_BARRIER_POINT, routePoint, type Point } from "./positions";
import { encounterDefinition, MAX_WAVES } from "./waves";

export { FIXED_STEP_SECONDS, MAX_WAVES };
export type EnemyKind = "swift" | "ordinary" | "armored" | "caster" | "swarm" | "elite" | "war-machine" | "cave-boss" | "skeptic-boss" | "dialectic-boss" | "boss" | "leviathan-boss";
export type BossEnemyKind = Extract<EnemyKind, `${string}boss` | "boss">;
export type Lane = SourceRouteId;
export type BossPhaseId = "cave-turn" | "skeptic-suspension" | "dialectic-negation" | "dialectic-sublation" | "objective-spirit" | "world-night" | "absolute-knowledge" | "leviathan-covenant" | "leviathan-sovereignty";
export type BossPhaseDefinition = { id: BossPhaseId; name: string; threshold: number; description: string };
export type BossPhaseEvent = { id: BossPhaseId; name: string; threshold: number; triggeredAt: number };
export const ABSOLUTE_SPIRIT_PHASES: ReadonlyArray<BossPhaseDefinition> = [
  { id: "objective-spirit", name: "客观精神", threshold: .75, description: "获得持续 8 秒的既有护盾。" },
  { id: "world-night", name: "世界之夜", threshold: .45, description: "清除硬控制并在 6 秒内加速，战场短暂陷入黑暗。" },
  { id: "absolute-knowledge", name: "绝对知识", threshold: .2, description: "全体友军失去 10 点能量，并清除一半普通护盾。" },
];
export const CAVE_SHADOW_PHASE = { id: "cave-turn" as const, name: "转身之痛", threshold: .5, description: "清除硬控制，4 秒内移动速度提高 20% 并获得控制抗性。" };
export const SKEPTIC_ABYSS_PHASES: ReadonlyArray<BossPhaseDefinition> = [
  { id: "skeptic-suspension", name: "判断悬置", threshold: .55, description: "悬置外界判断，立刻获得最大生命 24% 的护盾。" },
];
export const DIALECTIC_ENGINE_PHASES: ReadonlyArray<BossPhaseDefinition> = [
  { id: "dialectic-negation", name: "否定环节", threshold: .65, description: "清除硬控制并在 5 秒内加速，迫使防线重新组织。" },
  { id: "dialectic-sublation", name: "扬弃重构", threshold: .3, description: "恢复 12% 最大生命，并获得 10% 最大生命护盾。" },
];
export const LEVIATHAN_PHASES: ReadonlyArray<BossPhaseDefinition> = [
  { id: "leviathan-covenant", name: "自然契约", threshold: .7, description: "召集两名常识卫士，从同一路线加入战斗。" },
  { id: "leviathan-sovereignty", name: "主权降临", threshold: .35, description: "召集一名斯多葛重装，并在 6 秒内提高攻击频率。" },
];
export const BOSS_PHASES_BY_KIND: Record<BossEnemyKind, ReadonlyArray<BossPhaseDefinition>> = {
  "cave-boss": [CAVE_SHADOW_PHASE],
  "skeptic-boss": SKEPTIC_ABYSS_PHASES,
  "dialectic-boss": DIALECTIC_ENGINE_PHASES,
  boss: ABSOLUTE_SPIRIT_PHASES,
  "leviathan-boss": LEVIATHAN_PHASES,
};
export const isBossKind = (kind: EnemyKind): kind is BossEnemyKind => kind in BOSS_PHASES_BY_KIND;
export const isFinalBossKind = (kind: EnemyKind) => kind === "boss" || kind === "leviathan-boss";
export const bossPhasesFor = (kind: EnemyKind): ReadonlyArray<BossPhaseDefinition> => isBossKind(kind) ? BOSS_PHASES_BY_KIND[kind] : [];
/** Compatibility export retained for existing UI/test imports. */
export const DOGMA_COLOSSUS_PHASES = ABSOLUTE_SPIRIT_PHASES;

export type EvidenceRecord = { count: number; lastHitBySource: Record<string, number> };
export type Enemy = {
  id: string;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  progress: number;
  lane: Lane;
  sourceRouteId?: SourceRouteId;
  weight: number;
  shield?: number;
  energy?: number;
  maxEnergy?: number;
  rewardValue?: number;
  coreDamageValue?: number;
  blockedBy?: string;
  slowTicks?: number;
  stunTicks?: number;
  armorBreakTicks?: number;
  sealedTicks?: number;
  delayedDamage?: number;
  delayedTicks?: number;
  contradiction?: number;
  contradictionExpiresAt?: number;
  contradictionImmuneUntil?: number;
  evidence?: EvidenceRecord;
  logicHits?: Record<string, number>;
  propositionUntil?: number;
  atomicGroupId?: string;
  isAtom?: boolean;
  bossPhasesTriggered?: BossPhaseId[];
  phaseSpeedUntil?: number;
  phaseAttackUntil?: number;
  phaseShieldUntil?: number;
  phaseShieldAmount?: number;
  warMachineBlockedTicks?: number;
  warMachineSummons?: number;
  warMachineSummonLimit?: number;
};

export type CombatEffect = {
  id: string;
  type: "attack" | "hit" | "core" | "heal" | "debuff" | "enemyHit" | "skill" | "synergy" | "shield" | "echo" | "bossPhase" | "barrierHit" | "barrierBreak";
  enemyId?: string;
  slotId?: string;
  amount?: number;
  age: number;
  derivedEffect?: boolean;
  message?: string;
};

export type UnitWaveStatistics = { characterId?: string; damage: number; damageTaken: number; healing: number; shielding: number; controlTime: number; blockedWeight: number; skillCasts: number; effectiveTargets: number; wastedCasts: number; deaths: number };
export type PhilosopherKingCombatStatistics = {
  pieceId: string; characterId: string; star: Piece["star"]; normalSlot?: Piece["slotId"];
  throneBonus: { damage: number; healing: number; shielding: number };
  barrier: { maxHp: number; damageTaken: number; blockedWeight: number; hits: number; broke: boolean };
};
export type WaveStatistics = {
  enemiesSpawned: number;
  enemiesDefeated: number;
  enemiesLeaked: number;
  coreDamageBySource: Record<string, number>;
  routes: Record<SourceRouteId, { spawned: number; defeated: number; leaked: number }>;
  units: Record<string, UnitWaveStatistics>;
  philosopherKing?: PhilosopherKingCombatStatistics;
};

export type BattleSummary = {
  wave: number; kills: number; coreDamage: number; killGold: number; baseIncome: number;
  interest: number; perfectBonus: number; totalGold: number; elapsedTicks: number; success: boolean;
  experienceGained: number; historicalBonus?: number; synergyTriggers: Record<string, number>; bossPhases: BossPhaseEvent[]; statistics: WaveStatistics;
};
export type BattleStatus = "idle" | "running" | "victory" | "defeat" | "complete";

export type TemporaryBlocker = {
  id: string; nodeId: RevolutionNodeId | "royal-barrier"; point: Point; capacity: number; createdAt: number; expiresAt: number; kind?: "barricade" | "commune" | "royal-barrier";
  sourceId?: string; hp?: number; maxHp?: number; defense?: number;
};

export type DelayedDevice = {
  id: string; sourceId: string; position: Point; radius: number; executeAt: number;
  damage: number; slowDuration: number; copiedEffect?: EffectProfile;
};
export type PsychoanalysisRecord = { sourceId: string; targetId: string; stored: number; expiresAt: number };

/** CombatState is the only authoritative wave state; BattleState remains an API alias. */
export type CombatState = {
  status: BattleStatus;
  phase?: CombatPhase;
  tick: number;
  gameTime?: number;
  spawnRemaining: EnemyKind[];
  spawned?: number;
  routeOffset?: 0 | 1 | 2;
  warMachineRoutes?: SourceRouteId[];
  warMachinesSpawned?: number;
  warMachinesDefeated?: number;
  enemies: Enemy[];
  kills: number;
  goldEarned: number;
  coreDamage: number;
  cooldowns: Record<string, number>;
  enemyCooldowns: Record<string, number>;
  effects: CombatEffect[];
  eventQueue?: CombatEvent[];
  statuses?: TimedStatus[];
  traitSnapshot?: TraitSnapshot;
  structures?: TemporaryBlocker[];
  delayedDevices?: DelayedDevice[];
  lastEvent: string;
  factionCasts: string[];
  greekCastCount: number;
  greekDialogueCount?: number;
  greekDerivedCharges?: number;
  concepts: number;
  germanCastIds: string[];
  germanEchoReady?: number;
  germanAbsoluteEchoReady?: Record<string, boolean>;
  absoluteUntil?: number;
  systemCooldownUntil?: number;
  absoluteUsed: boolean;
  lastGermanTarget?: string;
  frenchArguments: number;
  frenchHeat?: number;
  revolutionCooldownUntil?: number;
  revolutionTriggered?: boolean;
  revolutionStructureUsed?: boolean;
  britishEvidence: number;
  britishLawTriggers?: number;
  evidenceLedger?: Record<string, number>;
  routeFailures?: Partial<Record<SourceRouteId, boolean>>;
  psychoanalysis?: Record<string, PsychoanalysisRecord>;
  phenomenologyCharges?: number;
  contractRescueUsed?: boolean;
  dialecticEnergyCooldownUntil?: number;
  synergyTriggers?: Record<string, number>;
  bossPhaseLog?: BossPhaseEvent[];
  statistics?: WaveStatistics;
  experienceGained?: number;
  lockedInterest?: number;
  lastFrenchTarget?: string;
  summary?: BattleSummary;
};
export type BattleState = CombatState;

export type EnemyTemplate = {
  name: string; glyph: string; maxHp: number; speed: number; coreDamage: number; attack: number;
  attackEvery: number; reward: number; weight: number; className: string; role: string; description: string;
};

export const enemyTemplates: Record<EnemyKind, EnemyTemplate> = {
  swift: { name: "流变追问", glyph: "⚡", maxHp: 76, speed: .035, coreDamage: 7, attack: 9, attackEvery: 8, reward: 0, weight: 1, className: "swift", role: "快速近战", description: "高速穿线的近战单位，迫使防线覆盖入口和侧路；不掉落金币。" },
  ordinary: { name: "常识卫士", glyph: "⚔", maxHp: 108, speed: .019, coreDamage: 12, attack: 13, attackEvery: 10, reward: 0, weight: 1, className: "ordinary", role: "基础近战", description: "基础近战压力，阻挡权重 1；不掉落金币。" },
  caster: { name: "怀疑之矢", glyph: "🏹", maxHp: 118, speed: .016, coreDamage: 16, attack: 17, attackEvery: 9, reward: 0, weight: 1, className: "caster", role: "远程", description: "推进中远程射击高台单位，接触后继续施压前排；不掉落金币。" },
  swarm: { name: "意见群像", glyph: "⋯", maxHp: 62, speed: .025, coreDamage: 8, attack: 8, attackEvery: 7, reward: 0, weight: 1, className: "swift", role: "集群近战", description: "以数量消耗阻挡容量；不掉落金币。" },
  armored: { name: "斯多葛重装", glyph: "🛡", maxHp: 320, speed: .011, coreDamage: 24, attack: 21, attackEvery: 12, reward: 0, weight: 2, className: "armored", role: "重装近战", description: "阻挡重量 2；普通前排可勉强接住一名，高阻挡可承接更多并发压力。" },
  elite: { name: "诡辩猎手", glyph: "⌖", maxHp: 560, speed: .014, coreDamage: 32, attack: 28, attackEvery: 10, reward: 5, weight: 2, className: "elite", role: "精英远程", description: "能远程压制高台并以重量 2 冲击前排；击杀奖励只结算一次。" },
  "war-machine": { name: "工具理性机", glyph: "⚙", maxHp: 620, speed: .0105, coreDamage: 30, attack: 24, attackEvery: 11, reward: 0, weight: 3, className: "war-machine", role: "攻城重装", description: "移动时减伤 50%；被地面棋子持续阻挡后解除减伤并有限召唤援军。" },
  "cave-boss": { name: "洞穴之影", glyph: "◉", maxHp: 560, speed: .014, coreDamage: 32, attack: 28, attackEvery: 10, reward: 5, weight: 2, className: "cave-boss", role: "敏捷Boss", description: "W5 候选Boss；生命首次低于 50% 时触发转身之痛。" },
  "skeptic-boss": { name: "怀疑深渊", glyph: "?", maxHp: 610, speed: .012, coreDamage: 34, attack: 26, attackEvery: 11, reward: 5, weight: 3, className: "cave-boss", role: "护盾Boss", description: "W5 候选Boss；55% 生命时以判断悬置获得高额护盾。" },
  "dialectic-boss": { name: "矛盾机枢", glyph: "⇄", maxHp: 540, speed: .013, coreDamage: 33, attack: 29, attackEvery: 9, reward: 5, weight: 2, className: "cave-boss", role: "再生Boss", description: "W5 候选Boss；先加速否定防线，再以扬弃恢复生命并获得护盾。" },
  boss: { name: "绝对精神", glyph: "☉", maxHp: 1450, speed: .009, coreDamage: 45, attack: 40, attackEvery: 9, reward: 10, weight: 3, className: "boss", role: "阶段Boss", description: "W10 候选Boss；在 75% / 45% / 20% 生命依次触发固定精神阶段。" },
  "leviathan-boss": { name: "契约利维坦", glyph: "♜", maxHp: 1550, speed: .008, coreDamage: 48, attack: 44, attackEvery: 10, reward: 10, weight: 4, className: "boss", role: "召唤Boss", description: "W10 候选Boss；在 70% / 35% 生命召集契约卫队，并在末段提高攻击频率。" },
};

export const ENEMY_UNIT_PRESSURE = {
  base: 2,
  perWave: .5,
  guardScale: 100,
} as const;

export const COMBAT_BALANCE = {
  aristotleSkillMultiplier: 4.2,
  hobbesShieldPerBlockedWeight: 28,
  hobbesReductionPerBlockedWeight: .05,
  hobbesReductionCap: .34,
  dialecticBurstDamage: { 2: 45, 3: 60, 4: 75 },
  dialecticEnergy: 18,
  dialecticStacksRequired: 2,
  dialecticStackDuration: 12,
  phenomenologyOpeningShield: { 2: .08, 3: .12 },
  phenomenologyRescueShield: .25,
  eudaimoniaHealingToShield: .3,
  eudaimoniaShieldCap: .3,
} as const;

/**
 * Enemy attacks are the only incoming source that reads the card's Guard stat.
 * This keeps Guard useful without making low-wave flat subtraction immune, and
 * leaves skill damage-reduction, shields and contract sharing as separate layers.
 */
export function enemyUnitDamage(baseAttack: number, wave: number, targetCharacterId: string, modeMultiplier = 1) {
  const guard = Math.max(0, characterById[targetCharacterId]?.stats.guard ?? 0);
  const pressure = ENEMY_UNIT_PRESSURE.base + Math.max(0, wave - 1) * ENEMY_UNIT_PRESSURE.perWave;
  const guardMultiplier = ENEMY_UNIT_PRESSURE.guardScale / (ENEMY_UNIT_PRESSURE.guardScale + guard);
  return Math.max(1, baseAttack * pressure * guardMultiplier * modeMultiplier);
}

const emptyRouteStatistics = () => ({ upper: { spawned: 0, defeated: 0, leaked: 0 }, lower: { spawned: 0, defeated: 0, leaked: 0 }, side: { spawned: 0, defeated: 0, leaked: 0 } });
const emptyUnitStatistics = (characterId?: string): UnitWaveStatistics => ({ characterId, damage: 0, damageTaken: 0, healing: 0, shielding: 0, controlTime: 0, blockedWeight: 0, skillCasts: 0, effectiveTargets: 0, wastedCasts: 0, deaths: 0 });
const normalizeUnitStatistics = (value?: Partial<UnitWaveStatistics>): UnitWaveStatistics => ({ ...emptyUnitStatistics(value?.characterId), ...value });
const emptyWaveStatistics = (): WaveStatistics => ({ enemiesSpawned: 0, enemiesDefeated: 0, enemiesLeaked: 0, coreDamageBySource: {}, routes: emptyRouteStatistics(), units: {} });
const normalizeWaveStatistics = (value?: Partial<WaveStatistics>): WaveStatistics => ({
  ...emptyWaveStatistics(), ...value,
  coreDamageBySource: value?.coreDamageBySource ?? {},
  routes: { ...emptyRouteStatistics(), ...(value?.routes ?? {}) },
  units: Object.fromEntries(Object.entries(value?.units ?? {}).map(([id, unit]) => [id, normalizeUnitStatistics(unit)])),
  philosopherKing: value?.philosopherKing ? {
    ...value.philosopherKing,
    throneBonus: { damage: value.philosopherKing.throneBonus?.damage ?? 0, healing: value.philosopherKing.throneBonus?.healing ?? 0, shielding: value.philosopherKing.throneBonus?.shielding ?? 0 },
    barrier: { maxHp: value.philosopherKing.barrier?.maxHp ?? 0, damageTaken: value.philosopherKing.barrier?.damageTaken ?? 0, blockedWeight: value.philosopherKing.barrier?.blockedWeight ?? 0, hits: value.philosopherKing.barrier?.hits ?? 0, broke: value.philosopherKing.barrier?.broke === true },
  } : undefined,
});

const routeForSpawn = (index: number, offset = 0): SourceRouteId => (["upper", "lower", "side"] as const)[(index + offset) % 3];

export const effectiveAttackRange = (piece: Piece) => {
  const unit = characterById[piece.characterId];
  if (!unit) return 0;
  return isThroneSlot(piece.slotId) ? PHILOSOPHER_KING_GLOBAL_RANGE : Math.max(unit.combat.range * 9, unit.terrain === "ground" ? 10 : 0);
};

export const PHILOSOPHER_KING_GLOBAL_RANGE = 160;
export type PhilosopherKingEffectKind = "damage" | "heal" | "shield";
export const philosopherKingEffectMultiplier = (piece: Piece, kind: PhilosopherKingEffectKind) => {
  if (!isThroneSlot(piece.slotId)) return 1;
  const role = characterById[piece.characterId]?.role.id;
  if (role === "sniper" || role === "caster") return kind === "damage" ? 1.3 : 1.1;
  if (role === "support") return kind === "heal" || kind === "shield" ? 1.3 : 1.1;
  if (role === "controller") return 1.2;
  return 1.1;
};

const buildBalanceReport = (state: GameState, pieces: Piece[], summary: BattleSummary): BalanceWaveReport => {
  const ledger = state.waveEconomy ?? { purchasesGold: 0, refreshes: 0, xpPurchases: 0, researchGold: 0 };
  const starValue = { 1: 1, 2: 3, 3: 9 } as const;
  const deployed = pieces.filter((piece) => isFieldedSlot(piece.slotId));
  const rosterValue = pieces.reduce((sum, piece) => sum + (characterById[piece.characterId]?.cost ?? 0) * starValue[piece.star], 0);
  return {
    wave: summary.wave,
    success: summary.success,
    elapsedSeconds: Math.round(summary.elapsedTicks * FIXED_STEP_SECONDS * 10) / 10,
    economy: {
      ...ledger,
      startGold: state.waveCheckpoint?.gold ?? state.gold,
      endGold: state.gold,
      baseIncome: summary.baseIncome,
      perfectBonus: summary.perfectBonus,
      interest: summary.interest,
      killGold: summary.killGold,
      totalIncome: summary.totalGold,
    },
    progress: {
      level: state.level,
      xp: state.xp,
      deployed: deployed.length,
      rosterValue,
      oneStar: pieces.filter((piece) => piece.star === 1).length,
      twoStar: pieces.filter((piece) => piece.star === 2).length,
      threeStar: pieces.filter((piece) => piece.star === 3).length,
    },
    routes: summary.statistics.routes,
    units: summary.statistics.units,
    outcome: {
      deaths: Object.values(summary.statistics.units).reduce((sum, unit) => sum + unit.deaths, 0),
      leaks: summary.statistics.enemiesLeaked,
      coreDamage: summary.coreDamage,
    },
    philosopherKing: summary.statistics.philosopherKing ? (() => {
      const king = summary.statistics.philosopherKing!;
      const output = summary.statistics.units[king.pieceId] ?? emptyUnitStatistics(king.characterId);
      return { ...king, output: { damage: output.damage, healing: output.healing, shielding: output.shielding } };
    })() : undefined,
    synergyTriggers: summary.synergyTriggers,
    bossPhases: summary.bossPhases.map((phase) => ({ id: phase.id, name: phase.name, triggeredAt: phase.triggeredAt })),
    coreDamageBySource: summary.statistics.coreDamageBySource,
  };
};

export const idleBattle = (): BattleState => ({
  status: "idle", phase: "preparation", tick: 0, gameTime: 0, spawnRemaining: [], spawned: 0, routeOffset: 0,
  warMachineRoutes: [], warMachinesSpawned: 0, warMachinesDefeated: 0,
  enemies: [], kills: 0, goldEarned: 0, coreDamage: 0, cooldowns: {}, enemyCooldowns: {}, effects: [],
  eventQueue: [], statuses: [], structures: [], delayedDevices: [], lastEvent: "等待行动", factionCasts: [],
  greekCastCount: 0, greekDialogueCount: 0, greekDerivedCharges: 0, concepts: 0, germanCastIds: [], germanEchoReady: 0, germanAbsoluteEchoReady: {}, absoluteUntil: 0,
  systemCooldownUntil: 0, absoluteUsed: false, frenchArguments: 0, frenchHeat: 0,
  revolutionCooldownUntil: 0, revolutionTriggered: false, revolutionStructureUsed: false, britishEvidence: 0, britishLawTriggers: 0, evidenceLedger: {}, routeFailures: {}, psychoanalysis: {}, phenomenologyCharges: 0, contractRescueUsed: false, dialecticEnergyCooldownUntil: 0,
  synergyTriggers: {}, bossPhaseLog: [], statistics: emptyWaveStatistics(), experienceGained: 0, lockedInterest: 0,
});

export const battleOf = (state: GameState): BattleState => {
  const defaults = idleBattle(); const saved = state.battle;
  const summary = saved?.summary ? {
    ...saved.summary,
    experienceGained: saved.summary.experienceGained ?? 0,
    synergyTriggers: saved.summary.synergyTriggers ?? {},
    bossPhases: saved.summary.bossPhases ?? [],
    statistics: normalizeWaveStatistics(saved.summary.statistics),
  } : undefined;
  return {
    ...defaults, ...saved,
    phase: saved?.phase ?? (saved?.status === "running" ? "combat" : "preparation"),
    gameTime: finiteNonNegative(saved?.gameTime ?? (saved?.tick ?? 0) * FIXED_STEP_SECONDS),
    effects: saved?.effects ?? [], eventQueue: saved?.eventQueue ?? [], statuses: saved?.statuses ?? [],
    factionCasts: saved?.factionCasts ?? [], germanCastIds: saved?.germanCastIds ?? [],
    enemyCooldowns: saved?.enemyCooldowns ?? {}, structures: saved?.structures ?? [],
    warMachineRoutes: [...(saved?.warMachineRoutes ?? [])], warMachinesSpawned: saved?.warMachinesSpawned ?? 0, warMachinesDefeated: saved?.warMachinesDefeated ?? 0,
    delayedDevices: saved?.delayedDevices ?? [], evidenceLedger: saved?.evidenceLedger ?? {}, routeFailures: saved?.routeFailures ?? {}, germanAbsoluteEchoReady: saved?.germanAbsoluteEchoReady ?? {}, psychoanalysis: saved?.psychoanalysis ?? {},
    synergyTriggers: saved?.synergyTriggers ?? {}, bossPhaseLog: saved?.bossPhaseLog ?? [], statistics: normalizeWaveStatistics(saved?.statistics), experienceGained: saved?.experienceGained ?? 0, summary,
    enemies: (saved?.enemies ?? []).flatMap((enemy) => enemyTemplates[enemy.kind] ? [{
      ...enemy, lane: enemy.lane ?? "upper", sourceRouteId: enemy.sourceRouteId ?? enemy.lane ?? "upper",
      weight: enemy.weight ?? enemyTemplates[enemy.kind].weight,
      rewardValue: enemy.rewardValue ?? enemyTemplates[enemy.kind].reward,
      coreDamageValue: enemy.coreDamageValue ?? enemyTemplates[enemy.kind].coreDamage,
      energy: finiteNonNegative(enemy.energy ?? 0), maxEnergy: enemy.maxEnergy ?? 100,
    }] : []),
  };
};

function initializePiece(piece: Piece, resetWaveEnergy = false) {
  const unit = characterById[piece.characterId];
  if (!unit) return piece;
  const maxHp = unit.stats.resolve * piece.star;
  const supportOpeningEnergy = unit.role.id === "support" ? Math.ceil(unit.combat.maxEnergy * .4) : 0;
  return {
    ...piece, maxHp, hp: maxHp, maxEnergy: unit.combat.maxEnergy,
    energy: resetWaveEnergy ? supportOpeningEnergy : Math.max(piece.energy ?? 0, supportOpeningEnergy), shield: 0,
    blockBonus: 0, blockBonusTicks: 0, damageReduction: 0, damageReductionTicks: 0,
    tauntTicks: 0, invulnerableTicks: 0, suspendShield: 0, attackSpeedTicks: 0,
    damageMult: 1, attackRateMult: 1,
    nearDeathUsed: false, lastStandConsumed: false, phenomenologyUsed: false, invulnerableUntil: 0, sublationEchoReady: false, contractGroupId: undefined, contractUntil: 0,
  } satisfies Piece;
}

/**
 * Death removes a unit from the active combat collection so it cannot keep
 * attacking, blocking or receiving effects. The purchased roster itself is
 * durable: after a successful wave, rebuild it from the preparation checkpoint
 * and only carry combat fields for units that survived this wave.
 */
function restoreRosterAfterVictory(preparedPieces: Piece[], combatPieces: Piece[]) {
  const combatById = new Map(combatPieces.map((piece) => [piece.id, piece]));
  return preparedPieces.filter((piece) => characterById[piece.characterId]).map((prepared) => {
    const restored = combatById.get(prepared.id) ?? initializePiece(prepared, true);
    const maxHp = restored.maxHp ?? characterById[prepared.characterId].stats.resolve * prepared.star;
    return {
      ...restored,
      characterId: prepared.characterId,
      star: prepared.star,
      slotId: prepared.slotId,
      throneReturnSlot: prepared.throneReturnSlot,
      maxHp,
      hp: maxHp,
      shield: 0,
      contractGroupId: undefined,
      contractUntil: 0,
    } satisfies Piece;
  });
}

const WHOLE_WAVE_TICKS = 100000;
// 城邦危机每路可冻结的地面部署格（A/B 共享汇合与核心前压格）。
const POLIS_LANE_SLOTS: Record<"A" | "B" | "C", string[]> = {
  A: ["deploy-1", "deploy-2", "deploy-5", "deploy-7", "deploy-10", "deploy-11", "deploy-12"],
  B: ["deploy-3", "deploy-4", "deploy-6", "deploy-7", "deploy-10", "deploy-11", "deploy-12"],
  C: ["deploy-8", "deploy-9", "deploy-12"],
};

/** Applies French Revolution (attack/maxHp) and Polis Crisis (block + attack-speed
 *  cost) piece modifiers from the resolved historical effects. Pure: returns new pieces. */
function applyHistoricalPieceModifiers(pieces: Piece[], resolved: ResolvedHistoricalEffects): Piece[] {
  let result = pieces;
  if (resolved.frenchRevolution) {
    const cfg = resolved.frenchRevolution;
    result = result.map((piece) => {
      const unit = characterById[piece.characterId];
      if (!unit) return piece;
      const mult = frenchRevolutionMultipliers(unit.cost, cfg);
      if (mult.damageMult === 1 && mult.maxHpMult === 1) return piece;
      const maxHp = Math.round((piece.maxHp ?? unit.stats.resolve * piece.star) * mult.maxHpMult);
      // Only apply the multiplier once: if hp is missing, use the pre-multiplied baseline.
      const hpBase = piece.hp ?? (piece.maxHp ?? unit.stats.resolve * piece.star);
      return { ...piece, maxHp, hp: Math.round(hpBase * mult.maxHpMult), damageMult: mult.damageMult };
    });
  }
  if (resolved.polisCrisis) {
    const cfg = resolved.polisCrisis;
    const enhanced = new Set<string>();
    for (const lane of ["A", "B", "C"] as const) {
      const lanePieces = result.filter((piece) => isDeploySlot(piece.slotId) && POLIS_LANE_SLOTS[lane].includes(piece.slotId) && characterById[piece.characterId]?.terrain === "ground" && (characterById[piece.characterId]?.block ?? 0) === cfg.targetBaseBlock);
      if (!lanePieces.length) continue;
      const frontmost = lanePieces.reduce((best, piece) => (deploymentById[piece.slotId].point.x > deploymentById[best.slotId].point.x ? piece : best));
      if (enhanced.has(frontmost.id)) continue;
      enhanced.add(frontmost.id);
      // 高阻挡棋子已被上方筛选排除（base block != targetBaseBlock）。
      result = result.map((piece) => piece.id === frontmost.id ? { ...piece, blockBonus: (piece.blockBonus ?? 0) + cfg.blockBonus, blockBonusTicks: WHOLE_WAVE_TICKS, attackRateMult: 1 + cfg.attackSpeedCost } : piece);
    }
  }
  return result;
}

export function startWave(state: GameState) {
  if (state.coreHp <= 0) return { state, message: "哲人之石已失守，请重试本波。", ok: false };
  if (state.wave > MAX_WAVES) return { state, message: "十波关卡已经完成。", ok: false };
  if (!state.pieces.some((piece) => isFieldedSlot(piece.slotId))) return { state, message: "请至少部署一名棋子后再开始波次。", ok: false };
  const pendingDecision = pendingHistoricalDecision(state.historicalEvents, state.wave);
  if (pendingDecision) return { state, message: pendingDecision === "event" ? "第 3 波历史事件尚未确认，无法开波。" : "第 6 波意识形态尚未选择，无法开波。", ok: false };
  const deployCap = effectiveMaxDeploy(state.level, state.historicalEvents);
  const fieldedCount = state.pieces.filter((piece) => isFieldedSlot(piece.slotId)).length;
  if (fieldedCount > deployCap) return { state, message: `当前部署 ${fieldedCount} 名，超过上限 ${deployCap}，请撤回 ${fieldedCount - deployCap} 名棋子。`, ok: false };
  const resetWaveEnergy = state.battle?.status === "victory";
  const validPieces = state.pieces.filter((piece) => characterById[piece.characterId]).map((piece) => initializePiece(piece, resetWaveEnergy));
  let preparationPlan = validatePreparationPlan(state.preparationPlan, validPieces);
  let gold = state.gold; let level = state.level; let xp = state.xp; const automaticResearches: string[] = [];
  while ((preparationPlan.pendingResearchChoices ?? 0) > 0) {
    const choice = preparationPlan.pendingResearchSelections?.includes("mechanics") ? "medicine" : "mechanics";
    const automatic = chooseResearch({ ...state, gold, pieces: validPieces, preparationPlan }, choice);
    preparationPlan = automatic.state.preparationPlan; gold = automatic.state.gold;
    automaticResearches.push(choice === "mechanics" ? "力学" : "医学");
  }
  const resolvedEffects = resolveHistoricalEffectsFromState(state.historicalEvents, state.wave);
  let pieces = applyHistoricalPieceModifiers(validPieces, resolvedEffects);
  let snapshot = createTraitSnapshot(pieces, preparationPlan, resolvedEffects.factionCountCap);
  const enlightenmentTier = snapshot.smallSynergyTiers.enlightenment;
  const agendas: EnlightenmentAgenda[] = enlightenmentTier >= 3 ? (preparationPlan.enlightenmentAgendas?.length ? preparationPlan.enlightenmentAgendas : ["citizen"]) : [];
  if (agendas.length) {
    preparationPlan = { ...preparationPlan, enlightenmentAgendas: agendas, enlightenmentAppliedWave: state.wave };
    snapshot = createTraitSnapshot(pieces, preparationPlan, resolvedEffects.factionCountCap);
  }
  if (agendas.includes("market")) gold = capGold(gold + 2);
  if (agendas.includes("education")) ({ level, xp } = normalizeProgress(level, xp + 4));
  if (agendas.includes("citizen")) pieces = pieces.map((piece) => ({ ...piece, shield: (piece.shield ?? 0) + Math.round((piece.maxHp ?? 0) * .1) }));
  const phenomenologyTier = snapshot.smallSynergyTiers.phenomenology;
  if (phenomenologyTier >= 2) {
    const ratio = COMBAT_BALANCE.phenomenologyOpeningShield[phenomenologyTier as 2 | 3];
    pieces = pieces.map((piece) => ["husserl", "heidegger", "sartre"].includes(piece.characterId) ? { ...piece, shield: (piece.shield ?? 0) + Math.round((piece.maxHp ?? 0) * ratio) } : piece);
  }
  if (snapshot.factionTiers.greece >= 2 && snapshot.rostrumId) {
    pieces = pieces.map((piece) => piece.id === snapshot.rostrumId ? {
      ...piece,
      energy: Math.min(piece.maxEnergy ?? 100, (piece.energy ?? 0) + 15),
      shield: (piece.shield ?? 0) + Math.round((piece.maxHp ?? 0) * .1),
    } : piece);
  }
  if (snapshot.preparationPlan.activeResearches?.some((research) => research.choice === "medicine")) pieces = pieces.map((piece) => ({ ...piece, shield: (piece.shield ?? 0) + Math.round((piece.maxHp ?? 0) * .08) }));
  const philosopherKing = snapshot.philosopherKingId ? pieces.find((piece) => piece.id === snapshot.philosopherKingId) : undefined;
  const kingCard = philosopherKing ? characterById[philosopherKing.characterId] : undefined;
  const royalBarrier = philosopherKing && kingCard ? (() => {
    const baseBlock = Math.max(0, kingCard.block);
    const maxHp = Math.round((philosopherKing.maxHp ?? kingCard.stats.resolve * philosopherKing.star) * (.4 + .1 * baseBlock));
    return { id: `royal-barrier-${state.wave}`, nodeId: "royal-barrier" as const, point: ROYAL_BARRIER_POINT, capacity: Math.min(4, 1 + baseBlock), createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, kind: "royal-barrier" as const, sourceId: philosopherKing.id, hp: maxHp, maxHp, defense: kingCard.stats.guard * .5 };
  })() : undefined;
  const definition = encounterDefinition(state.wave, state.historicalEvents.seed);
  const warMachinePlan = resolveWarMachinePlan(state.historicalEvents, state.wave);
  const warMachineRoutes = warMachinePlan ? warMachineRoutesForWave(state.wave, warMachinePlan.machines) : [];
  const battle: BattleState = {
    ...idleBattle(), status: "running", phase: "combat", spawnRemaining: [...definition.enemies, ...warMachineRoutes.map(() => "war-machine" as const)], routeOffset: definition.laneOffset, warMachineRoutes, structures: royalBarrier ? [royalBarrier] : [],
    traitSnapshot: snapshot, phenomenologyCharges: snapshot.smallSynergyTiers.phenomenology >= 3 ? 2 : snapshot.smallSynergyTiers.phenomenology >= 2 ? 1 : 0, experienceGained: agendas.includes("education") ? 4 : 0, lockedInterest: effectiveInterestForGold(state.gold, state.historicalEvents), synergyTriggers: Object.fromEntries(agendas.map((agenda) => [`enlightenment:${agenda}`, 1])),
    statistics: philosopherKing && kingCard && royalBarrier ? { ...emptyWaveStatistics(), philosopherKing: { pieceId: philosopherKing.id, characterId: philosopherKing.characterId, star: philosopherKing.star, normalSlot: philosopherKing.throneReturnSlot, throneBonus: { damage: 0, healing: 0, shielding: 0 }, barrier: { maxHp: royalBarrier.maxHp ?? 0, damageTaken: 0, blockedWeight: 0, hits: 0, broke: false } } } : emptyWaveStatistics(),
    lastEvent: `第 ${state.wave} 波开始：${definition.title}`,
  };
  const waveCheckpoint = {
    wave: state.wave, gold: state.gold, level: state.level, xp: state.xp, coreHp: state.coreHp,
    shop: [...state.shop], shopFrozen: state.shopFrozen, pieces: state.pieces.map((piece) => ({ ...piece })), preparationPlan: { ...state.preparationPlan, pendingResearchSelections: [...(state.preparationPlan.pendingResearchSelections ?? [])], activeResearches: state.preparationPlan.activeResearches?.map((research) => ({ ...research })), enlightenmentAgendas: [...(state.preparationPlan.enlightenmentAgendas ?? [])] },
    campaignElapsedSeconds: state.campaignElapsedSeconds,
    balanceHistory: state.balanceHistory?.map((report) => ({ ...report })),
    waveEconomy: state.waveEconomy ? { ...state.waveEconomy } : undefined,
    historicalEvents: cloneHistoricalEventState(state.historicalEvents),
  };
  const automaticNotice = automaticResearches.length ? `英国研究未选择，已自动选择${automaticResearches.join("、")}。` : "";
  return { state: { ...state, gold, level, xp, pieces, preparationPlan, battle, waveCheckpoint }, message: `${battle.lastEvent}${automaticNotice}`, ok: true };
}

export function retryWave(state: GameState) {
  const battle = battleOf(state);
  if (battle.status !== "defeat") return { state, message: "当前无需重试。", ok: false };
  const checkpoint = state.waveCheckpoint;
  const pieces = (checkpoint?.pieces ?? state.pieces).filter((piece) => characterById[piece.characterId]).map((piece) => ({ ...piece }));
  return {
    state: {
      ...state,
      gold: checkpoint?.gold ?? state.gold,
      level: checkpoint?.level ?? state.level,
      xp: checkpoint?.xp ?? state.xp,
      wave: checkpoint?.wave ?? state.wave,
      shop: checkpoint ? [...checkpoint.shop] : state.shop,
      shopFrozen: checkpoint?.shopFrozen ?? state.shopFrozen,
      pieces,
      preparationPlan: checkpoint?.preparationPlan ?? state.preparationPlan,
      coreHp: checkpoint?.coreHp ?? 100,
      campaignElapsedSeconds: checkpoint?.campaignElapsedSeconds ?? state.campaignElapsedSeconds,
      balanceHistory: checkpoint?.balanceHistory?.map((report) => ({ ...report })) ?? state.balanceHistory,
      waveEconomy: checkpoint?.waveEconomy ? { ...checkpoint.waveEconomy } : state.waveEconomy,
      historicalEvents: checkpoint?.historicalEvents ? cloneHistoricalEventState(checkpoint.historicalEvents) : state.historicalEvents,
      battle: { ...idleBattle(), lastEvent: `第 ${checkpoint?.wave ?? state.wave} 波准备重试。` },
    },
    message: "阵容与哲人之石已恢复到本波开始前。", ok: true,
  };
}

export function restartCurrentWave(state: GameState) {
  const battle = battleOf(state);
  if (!state.waveCheckpoint) return { state, message: "请先开始本波，才能建立本波重开存档。", ok: false };
  if (battle.status === "complete") return { state, message: "十波已经完成，请整局重开。", ok: false };
  const checkpoint = state.waveCheckpoint;
  return {
    state: {
      ...state, wave: checkpoint.wave, gold: checkpoint.gold, level: checkpoint.level, xp: checkpoint.xp, coreHp: checkpoint.coreHp,
      shop: [...checkpoint.shop], shopFrozen: checkpoint.shopFrozen ?? state.shopFrozen, pieces: checkpoint.pieces.filter((piece) => characterById[piece.characterId]).map((piece) => ({ ...piece })), preparationPlan: checkpoint.preparationPlan ?? state.preparationPlan,
      campaignElapsedSeconds: checkpoint.campaignElapsedSeconds,
      balanceHistory: checkpoint.balanceHistory?.map((report) => ({ ...report })),
      waveEconomy: checkpoint.waveEconomy ? { ...checkpoint.waveEconomy } : undefined,
      historicalEvents: checkpoint.historicalEvents ? cloneHistoricalEventState(checkpoint.historicalEvents) : state.historicalEvents,
      battle: { ...idleBattle(), lastEvent: `第 ${checkpoint.wave} 波已回到准备阶段。` },
    },
    message: `第 ${checkpoint.wave} 波已从波次开始处重开。`, ok: true,
  };
}

const strongestThreat = (enemies: Enemy[]) => [...enemies].filter((enemy) => enemy.hp > 0).sort((a, b) => b.progress - a.progress || b.weight - a.weight || b.hp - a.hp)[0];
const highestHp = (enemies: Enemy[]) => [...enemies].filter((enemy) => enemy.hp > 0).sort((a, b) => b.hp - a.hp || b.progress - a.progress)[0];
const lowestHealthAlly = (pieces: Piece[]) => [...pieces].filter((piece) => (piece.hp ?? 0) > 0).sort((a, b) => (a.hp ?? 0) / Math.max(1, a.maxHp ?? 1) - (b.hp ?? 0) / Math.max(1, b.maxHp ?? 1))[0];

export function resolveBlocking(enemies: Enemy[], pieces: Piece[], structures: TemporaryBlocker[], gameTime: number) {
  const used = new Map<string, number>();
  const alivePieces = pieces.filter((piece) => isDeploySlot(piece.slotId) && (piece.hp ?? 0) > 0 && characterById[piece.characterId]?.terrain === "ground");
  const liveStructures = structures.filter((structure) => structure.expiresAt > gameTime && (structure.hp === undefined || structure.hp > 0));
  const pieceIds = new Set(alivePieces.map((piece) => piece.id));
  const structureIds = new Set(liveStructures.map((structure) => `structure:${structure.id}`));
  // Existing engagements are latched. Capacity is consulted only when a new
  // enemy is assigned; a later, faster enemy can no longer evict one that is
  // already in contact with a living blocker.
  const latched = enemies.map((enemy) => {
    const blocker = enemy.blockedBy;
    const valid = blocker && (blocker.startsWith("structure:") ? structureIds.has(blocker) : pieceIds.has(blocker));
    if (!valid) return { ...enemy, blockedBy: undefined };
    used.set(blocker, (used.get(blocker) ?? 0) + enemy.weight);
    return { ...enemy };
  });
  return [...latched].sort((a, b) => b.progress - a.progress).map((enemy) => {
    if (enemy.blockedBy) return enemy;
    const point = routePoint(enemy.progress, enemy.lane);
    const pieceCandidate = alivePieces
      .filter((piece) => {
        const unit = characterById[piece.characterId]; const capacity = Math.min(5, unit.block + (piece.blockBonus ?? 0));
        const occupied = used.get(piece.id) ?? 0;
        // Every living ground unit can engage at least one enemy at contact.
        // Weight still consumes the real capacity, so an oversized heavy unit
        // saturates a low-block defender while high-block units retain their
        // advantage against several simultaneous lighter enemies.
        return distance(deploymentPoint(piece.slotId), point) < 10 && (occupied === 0 || occupied + enemy.weight <= capacity);
      })
      .sort((a, b) => (b.tauntTicks ?? 0) - (a.tauntTicks ?? 0) || a.id.localeCompare(b.id))[0];
    // The royal barrier is the shared final defence for all three fixed routes.
    // C approaches the core vertically and its centreline is exactly 8 map
    // units from the barrier anchor, so the generic strict < 8 contact check
    // could never engage it. Give only the royal barrier a slightly wider
    // contact envelope; ordinary French structures keep their authored radius.
    const structureCandidate = liveStructures.find((structure) => {
      const contactRadius = structure.kind === "royal-barrier" ? 10 : 8;
      const occupied = used.get(`structure:${structure.id}`) ?? 0;
      return distance(structure.point, point) <= contactRadius && (occupied === 0 || occupied + enemy.weight <= structure.capacity);
    });
    const blockerId = pieceCandidate?.id ?? (structureCandidate ? `structure:${structureCandidate.id}` : undefined);
    if (blockerId) used.set(blockerId, (used.get(blockerId) ?? 0) + enemy.weight);
    return { ...enemy, blockedBy: blockerId };
  });
}

export function advanceBattle(state: GameState, random = Math.random): GameState {
  const battle = battleOf(state); if (battle.status !== "running") return state;
  const tick = battle.tick + 1; const gameTime = Math.round((battle.gameTime! + FIXED_STEP_SECONDS) * 1000) / 1000;
  const snapshot = battle.traitSnapshot ?? createTraitSnapshot(state.pieces, state.preparationPlan);
  const statusManager = new StatusManager(battle.statuses); statusManager.expire(gameTime);
  const queue = new CombatEventQueue(battle.eventQueue);
  let pieces: Piece[] = state.pieces.filter((piece) => characterById[piece.characterId]).map((piece) => {
    const unit = characterById[piece.characterId]; const maximum = piece.maxHp ?? unit.stats.resolve * piece.star;
    return ({
    ...piece, maxHp: maximum, hp: piece.hp ?? maximum, maxEnergy: piece.maxEnergy ?? unit.combat.maxEnergy, energy: piece.energy ?? 0,
    blockBonusTicks: Math.max(0, (piece.blockBonusTicks ?? 0) - 1),
    damageReductionTicks: Math.max(0, (piece.damageReductionTicks ?? 0) - 1),
    tauntTicks: Math.max(0, (piece.tauntTicks ?? 0) - 1),
    invulnerableTicks: Math.max(0, (piece.invulnerableTicks ?? 0) - 1),
    attackSpeedTicks: Math.max(0, (piece.attackSpeedTicks ?? 0) - 1),
  }); });
  pieces = pieces.map((piece) => {
    const fichteBonus = piece.characterId === "fichte" && (piece.shield ?? 0) > 0 ? 1 : 0;
    return {
      ...piece,
      blockBonus: fichteBonus || (piece.blockBonusTicks ?? 0) > 0 ? piece.blockBonus ?? fichteBonus : 0,
      damageReduction: (piece.damageReductionTicks ?? 0) > 0 ? piece.damageReduction : 0,
      contractGroupId: (piece.contractUntil ?? 0) > gameTime ? piece.contractGroupId : undefined,
    };
  });
  const effects = battle.effects.map((effect) => ({ ...effect, age: effect.age + 1 })).filter((effect) => effect.age < 5);
  let enemies = battle.enemies.map((enemy) => {
    // A tick may update evidence, logic hit ledgers and boss phase arrays in
    // place. Clone those nested records so advancing never changes the input
    // GameState retained by React, a replay tool or a deterministic test.
    const copy: Enemy = {
      ...enemy,
      evidence: enemy.evidence ? { count: enemy.evidence.count, lastHitBySource: { ...enemy.evidence.lastHitBySource } } : undefined,
      logicHits: enemy.logicHits ? { ...enemy.logicHits } : undefined,
      bossPhasesTriggered: enemy.bossPhasesTriggered ? [...enemy.bossPhasesTriggered] : undefined,
    };
    if ((copy.phaseShieldUntil ?? 0) > 0 && (copy.phaseShieldUntil ?? 0) <= gameTime) {
      copy.shield = Math.max(0, (copy.shield ?? 0) - Math.min(copy.shield ?? 0, copy.phaseShieldAmount ?? 0));
      copy.phaseShieldAmount = 0; copy.phaseShieldUntil = 0;
    }
    return copy;
  });
  const synergyTriggers = { ...(battle.synergyTriggers ?? {}) };
  const bossPhaseLog = [...(battle.bossPhaseLog ?? [])];
  const priorStatistics = battle.statistics ?? emptyWaveStatistics();
  const statistics: WaveStatistics = {
    enemiesSpawned: priorStatistics.enemiesSpawned,
    enemiesDefeated: priorStatistics.enemiesDefeated,
    enemiesLeaked: priorStatistics.enemiesLeaked,
    coreDamageBySource: { ...priorStatistics.coreDamageBySource },
    routes: Object.fromEntries(Object.entries(priorStatistics.routes).map(([id, value]) => [id, { ...value }])) as WaveStatistics["routes"],
    units: Object.fromEntries(Object.entries(priorStatistics.units).map(([id, value]) => [id, { ...value }])),
    philosopherKing: priorStatistics.philosopherKing ? {
      ...priorStatistics.philosopherKing,
      throneBonus: { ...priorStatistics.philosopherKing.throneBonus },
      barrier: { ...priorStatistics.philosopherKing.barrier },
    } : undefined,
  };
  const unitStatistics = (id: string) => statistics.units[id] ??= emptyUnitStatistics(pieces.find((piece) => piece.id === id)?.characterId);
  const routeStatistics = (route: SourceRouteId) => statistics.routes[route] ??= { spawned: 0, defeated: 0, leaked: 0 };
  const incrementSynergy = (id: string) => { synergyTriggers[id] = (synergyTriggers[id] ?? 0) + 1; };
  const expiredStructures = (battle.structures ?? []).filter((structure) => structure.expiresAt <= gameTime);
  let structures = (battle.structures ?? []).filter((structure) => structure.expiresAt > gameTime && (structure.hp === undefined || structure.hp > 0));
  expiredStructures.filter((structure) => structure.kind === "commune").forEach((structure) => {
    queue.enqueue({ id: `commune-expire-damage-${structure.id}`, kind: "damage", targetKind: "position", position: structure.point, radius: 18, amount: 34, copyable: false, derivedEffect: true });
    queue.enqueue({ id: `commune-expire-slow-${structure.id}`, kind: "slow", targetKind: "position", position: structure.point, radius: 18, duration: 2, potency: .35, copyable: false, derivedEffect: true });
  });
  let delayedDevices = [...(battle.delayedDevices ?? [])];
  const psychoanalysis = Object.fromEntries(Object.entries(battle.psychoanalysis ?? {}).map(([targetId, record]) => [targetId, { ...record }])) as Record<string, PsychoanalysisRecord>;
  Object.values(psychoanalysis).filter((record) => record.expiresAt <= gameTime).forEach((record) => {
    queue.enqueue({ id: `psychoanalysis-expire-${record.targetId}-${tick}`, kind: "damage", sourceId: record.sourceId, targetKind: "enemy", targetId: record.targetId, amount: record.stored * .5, copyable: false, derivedEffect: true });
    delete psychoanalysis[record.targetId];
  });
  let coreHp = state.coreHp; let kills = battle.kills; let goldEarned = battle.goldEarned; let coreDamage = battle.coreDamage;
  let warMachinesSpawned = battle.warMachinesSpawned ?? 0; let warMachinesDefeated = battle.warMachinesDefeated ?? 0;
  let britishEvidence = battle.britishEvidence; let britishLawTriggers = battle.britishLawTriggers ?? 0; const evidenceLedger = { ...(battle.evidenceLedger ?? {}) }; const routeFailures = { ...(battle.routeFailures ?? {}) }; let phenomenologyCharges = battle.phenomenologyCharges ?? (snapshot.smallSynergyTiers.phenomenology >= 3 ? 2 : snapshot.smallSynergyTiers.phenomenology >= 2 ? 1 : 0); let contractRescueUsed = battle.contractRescueUsed ?? false; let dialecticEnergyCooldownUntil = battle.dialecticEnergyCooldownUntil ?? 0;

  const visual = (profile: EffectProfile, amount = profile.amount) => {
    const source = profile.sourceId ? pieces.find((piece) => piece.id === profile.sourceId) : undefined;
    const sourceEnemy = profile.sourceId ? enemies.find((enemy) => enemy.id === profile.sourceId) : undefined;
    const targetEnemy = profile.targetId ? enemies.find((enemy) => enemy.id === profile.targetId) : undefined;
    const targetAlly = profile.targetId ? pieces.find((piece) => piece.id === profile.targetId) : undefined;
    const type: CombatEffect["type"] = profile.derivedEffect ? "echo" : profile.tags?.includes("enemy-hit") ? "enemyHit" : profile.tags?.includes("attack") ? "attack" : profile.kind === "heal" ? "heal" : profile.kind === "shield" ? "shield" : profile.targetKind === "core" ? "core" : profile.kind === "damage" ? "skill" : "debuff";
    effects.push({ id: `fx-${profile.id}-${tick}-${effects.length}`, type, enemyId: targetEnemy?.id ?? (type === "enemyHit" ? sourceEnemy?.id : undefined), slotId: type === "enemyHit" ? targetAlly?.slotId : source?.slotId, amount: amount === undefined ? undefined : Math.round(amount), age: 0, derivedEffect: profile.derivedEffect });
  };

  const triggerBossPhases = (target: Enemy) => {
    if (!isBossKind(target.kind) || target.isAtom || target.hp <= 0) return;
    const triggered = new Set(target.bossPhasesTriggered ?? []);
    const phases = bossPhasesFor(target.kind);
    for (const phase of phases) {
      if (target.hp / Math.max(1, target.maxHp) > phase.threshold || triggered.has(phase.id)) continue;
      triggered.add(phase.id); target.bossPhasesTriggered = [...triggered];
      const record: BossPhaseEvent = { id: phase.id, name: phase.name, threshold: phase.threshold, triggeredAt: gameTime };
      bossPhaseLog.push(record); incrementSynergy(`boss:${phase.id}`);
      effects.push({ id: `boss-phase-${phase.id}-${tick}`, type: "bossPhase", enemyId: target.id, amount: Math.round(phase.threshold * 100), age: 0, message: `${enemyTemplates[target.kind].name} · ${phase.name}` });
      if (phase.id === "cave-turn") { target.stunTicks = 0; statusManager.clearHardControl(target.id); target.phaseSpeedUntil = gameTime + 4; statusManager.add({ id: `cave-resistance-${target.id}`, targetId: target.id, kind: "control-resistance", startedAt: gameTime, expiresAt: gameTime + 4, potency: 1 }); }
      if (phase.id === "skeptic-suspension") { const amount = target.maxHp * .24; target.phaseShieldAmount = amount; target.phaseShieldUntil = gameTime + 10; queue.enqueue({ id: `boss-skeptic-${tick}`, kind: "shield", sourceId: target.id, targetKind: "enemy", targetId: target.id, amount, copyable: false, tags: ["boss-phase"] }); }
      if (phase.id === "dialectic-negation") { target.stunTicks = 0; statusManager.clearHardControl(target.id); target.phaseSpeedUntil = gameTime + 5; }
      if (phase.id === "dialectic-sublation") { target.hp = Math.min(target.maxHp, target.hp + target.maxHp * .12); const amount = target.maxHp * .1; queue.enqueue({ id: `boss-sublation-${tick}`, kind: "shield", sourceId: target.id, targetKind: "enemy", targetId: target.id, amount, copyable: false, tags: ["boss-phase"] }); }
      if (phase.id === "objective-spirit") { const amount = target.maxHp * .18; target.phaseShieldAmount = amount; target.phaseShieldUntil = gameTime + 8; queue.enqueue({ id: `boss-objective-${tick}`, kind: "shield", sourceId: target.id, targetKind: "enemy", targetId: target.id, amount, copyable: false, tags: ["boss-phase"] }); }
      if (phase.id === "world-night") { target.stunTicks = 0; statusManager.clearHardControl(target.id); target.phaseSpeedUntil = gameTime + 6; }
      if (phase.id === "absolute-knowledge") pieces = pieces.map((piece) => snapshot.unitIds.includes(piece.id) && (piece.hp ?? 0) > 0 ? { ...piece, energy: Math.max(0, (piece.energy ?? 0) - 10), shield: (piece.shield ?? 0) * .5 } : piece);
      if (phase.id === "leviathan-covenant" || phase.id === "leviathan-sovereignty") {
        const definition = encounterDefinition(state.wave, state.historicalEvents.seed);
        const kinds: EnemyKind[] = phase.id === "leviathan-covenant" ? ["ordinary", "ordinary"] : ["armored"];
        kinds.forEach((kind, index) => {
          const template = enemyTemplates[kind];
          const summon: Enemy = { id: `${target.id}-${phase.id}-${index + 1}`, kind, hp: Math.round(template.maxHp * definition.healthMultiplier), maxHp: Math.round(template.maxHp * definition.healthMultiplier), progress: Math.max(0, target.progress - .05 * (index + 1)), lane: target.lane, sourceRouteId: target.sourceRouteId ?? target.lane, weight: template.weight, shield: 0, energy: 0, maxEnergy: 100, rewardValue: 0, coreDamageValue: template.coreDamage };
          enemies.push(summon); statistics.enemiesSpawned += 1; routeStatistics(summon.sourceRouteId ?? summon.lane).spawned += 1;
        });
        if (phase.id === "leviathan-sovereignty") target.phaseAttackUntil = gameTime + 6;
      }
    }
  };

  const recordCopyableEffect = (profile: EffectProfile) => {
    if (profile.derivedEffect || profile.copyable === false || !["damage", "heal", "shield", "slow", "silence", "stun", "pause"].includes(profile.kind)) return;
    const source = profile.sourceId ? pieces.find((piece) => piece.id === profile.sourceId) : undefined;
    if (!source) return;
    const index = delayedDevices.findIndex((device) => device.executeAt > gameTime && device.sourceId !== source.id && !device.copiedEffect);
    if (index >= 0) delayedDevices[index] = { ...delayedDevices[index], copiedEffect: { ...profile, amount: profile.amount === undefined ? undefined : profile.amount * .6, potency: profile.potency === undefined ? undefined : profile.potency * .6, duration: profile.duration === undefined ? undefined : profile.duration * .6, derivedEffect: true, copyable: false, throneBonusAmount: undefined } };
  };

  const recordBritishEvidence = (profile: EffectProfile, target: Enemy) => {
    if (!canGenerateMechanic(profile) || snapshot.factionTiers.britain < 2 || !profile.sourceId) return;
    const source = pieces.find((piece) => piece.id === profile.sourceId); if (!source || characterById[source.characterId].faction !== "britain") return;
    if (statusManager.has(target.id, "armor-break", gameTime) && statusManager.has(target.id, "no-shield", gameTime)) return;
    const key = `${source.id}:${target.id}`; const last = evidenceLedger[key] ?? -Infinity;
    if (gameTime - last < .6) return;
    evidenceLedger[key] = gameTime;
    const evidence = target.evidence ?? { count: 0, lastHitBySource: {} };
    evidence.count += 1; evidence.lastHitBySource[source.id] = gameTime; target.evidence = evidence; britishEvidence += 1;
    const threshold = 6;
    if (evidence.count >= threshold) {
      evidence.count = 0;
      statusManager.add({ id: `law-armor-${target.id}-${tick}`, targetId: target.id, sourceId: source.id, kind: "armor-break", startedAt: gameTime, expiresAt: gameTime + 5, potency: .15 });
      statusManager.add({ id: `law-shield-${target.id}-${tick}`, targetId: target.id, sourceId: source.id, kind: "no-shield", startedAt: gameTime, expiresAt: gameTime + 5, potency: 1 });
      britishLawTriggers += 1; incrementSynergy("britain:law"); effects.push({ id: `evidence-${tick}-${target.id}`, type: "synergy", enemyId: target.id, slotId: source.slotId, amount: threshold, age: 0 });
    }
  };

  const recordSmallSynergy = (profile: EffectProfile, target: Enemy) => {
    if (!canGenerateMechanic(profile) || !profile.sourceId || profile.tags?.includes("attack")) return;
    const source = pieces.find((piece) => piece.id === profile.sourceId); if (!source) return;
    if (snapshot.smallSynergyTiers.dialectic >= 2 && ["socrates", "plato", "fichte", "hegel"].includes(source.characterId)) {
      if ((target.contradictionImmuneUntil ?? 0) <= gameTime) {
        const stacks = (target.contradictionExpiresAt ?? 0) > gameTime ? target.contradiction ?? 0 : 0;
        target.contradiction = Math.min(COMBAT_BALANCE.dialecticStacksRequired, stacks + 1); target.contradictionExpiresAt = gameTime + COMBAT_BALANCE.dialecticStackDuration;
        if (target.contradiction >= COMBAT_BALANCE.dialecticStacksRequired) {
          target.contradiction = 0; target.contradictionExpiresAt = 0; target.contradictionImmuneUntil = gameTime + 6; target.energy = Math.max(0, (target.energy ?? 0) - 15); incrementSynergy("dialectic:burst");
          const dialecticTier = snapshot.smallSynergyTiers.dialectic as 2 | 3 | 4;
          queue.enqueue({ id: `dialectic-burst-damage-${tick}-${target.id}`, kind: "damage", sourceId: source.id, targetKind: "enemy", targetId: target.id, amount: COMBAT_BALANCE.dialecticBurstDamage[dialecticTier], derivedEffect: true, copyable: false });
          queue.enqueue({ id: `dialectic-burst-slow-${tick}-${target.id}`, kind: "slow", sourceId: source.id, targetKind: "enemy", targetId: target.id, duration: 2, potency: .35, derivedEffect: true, copyable: false });
          if (snapshot.smallSynergyTiers.dialectic >= 3 && gameTime >= dialecticEnergyCooldownUntil) {
            const recipient = pieces.filter((piece) => snapshot.unitIds.includes(piece.id) && (piece.hp ?? 0) > 0 && ["socrates", "plato", "fichte", "hegel"].includes(piece.characterId)).sort((a, b) => (a.energy ?? 0) - (b.energy ?? 0) || a.id.localeCompare(b.id))[0];
            if (recipient) queue.enqueue({ id: `dialectic-energy-${tick}-${recipient.id}`, kind: "energy", sourceId: source.id, targetKind: "ally", targetId: recipient.id, amount: COMBAT_BALANCE.dialecticEnergy, copyable: false });
            dialecticEnergyCooldownUntil = gameTime + 3.5;
          }
          if (snapshot.smallSynergyTiers.dialectic >= 4) pieces = pieces.map((piece) => piece.id === source.id ? { ...piece, sublationEchoReady: true } : piece);
        }
      }
    }
    if (snapshot.smallSynergyTiers["logical-analysis"] >= 2 && ["aristotle", "russell", "wittgenstein"].includes(source.characterId) && (target.propositionUntil ?? 0) <= gameTime) {
      const hits = Object.fromEntries(Object.entries(target.logicHits ?? {}).filter(([, at]) => gameTime - at <= 6)); hits[source.id] = gameTime; target.logicHits = hits;
      if (Object.keys(hits).length >= 2) {
        target.logicHits = {}; target.propositionUntil = gameTime + 5; incrementSynergy("logical-analysis:proposition");
        statusManager.add({ id: `proposition-armor-${tick}-${target.id}`, targetId: target.id, sourceId: source.id, kind: "armor-break", startedAt: gameTime, expiresAt: gameTime + 5, potency: .15 });
        statusManager.add({ id: `proposition-shield-${tick}-${target.id}`, targetId: target.id, sourceId: source.id, kind: "no-shield", startedAt: gameTime, expiresAt: gameTime + 5, potency: 1 });
      }
    }
  };

  const applyReadyEvents = () => {
    let ready = queue.drainReady(gameTime);
    while (ready.length) {
      const pending = [...ready]; ready = [];
      while (pending.length) {
        const rawProfile = pending.shift()!;
        const king = snapshot.philosopherKingId && rawProfile.sourceId === snapshot.philosopherKingId ? pieces.find((piece) => piece.id === snapshot.philosopherKingId) : undefined;
        const amplify = Boolean(king) && !rawProfile.derivedEffect && rawProfile.throneBonusAmount === undefined && ["damage", "heal", "shield"].includes(rawProfile.kind);
        const throneMultiplier = amplify && king ? philosopherKingEffectMultiplier(king, rawProfile.kind as PhilosopherKingEffectKind) : 1;
        const throneBonusRate = Math.round((throneMultiplier - 1) * 100) / 100;
        const throneBonusAmount = rawProfile.amount === undefined ? 0 : rawProfile.amount * throneBonusRate;
        const profile = amplify && rawProfile.amount !== undefined ? { ...rawProfile, amount: rawProfile.amount + throneBonusAmount, throneBonusAmount } : rawProfile;
        if (profile.targetKind === "position") {
          if (profile.kind === "spawn" && profile.tags?.includes("revolution-structure") && profile.position) {
            const capacity = Math.max(1, Math.floor(profile.amount ?? 2));
            const duration = Math.max(0, profile.duration ?? 5);
            structures = [...structures, { id: profile.id, nodeId: snapshot.revolutionNodeId, point: profile.position, capacity, createdAt: gameTime, expiresAt: gameTime + duration, kind: capacity >= 3 ? "commune" : "barricade" }];
            continue;
          }
          if (profile.kind === "damage" || profile.kind === "slow" || profile.kind === "silence" || profile.kind === "stun" || profile.kind === "pause") {
            const targets = enemies.filter((enemy) => enemy.hp > 0 && profile.position && distance(routePoint(enemy.progress, enemy.lane), profile.position) <= (profile.radius ?? 14));
            targets.forEach((target) => pending.push({ ...profile, id: `${profile.id}-${target.id}`, targetKind: "enemy", targetId: target.id, position: undefined, radius: undefined }));
          }
          continue;
        }
        if (profile.targetKind === "core" && profile.kind === "damage") {
          const amount = finiteNonNegative(profile.amount ?? 0); coreHp = Math.max(0, coreHp - amount); coreDamage += amount; visual(profile, amount); continue;
        }
        if (profile.targetKind === "enemy") {
          let target = profile.targetId ? enemies.find((enemy) => enemy.id === profile.targetId && (profile.kind === "death" || profile.kind === "split" || enemy.hp > 0)) : undefined;
          if (!target && profile.kind === "damage") {
            const candidates = profile.position ? enemies.filter((enemy) => enemy.hp > 0 && distance(routePoint(enemy.progress, enemy.lane), profile.position!) <= (profile.radius ?? 16)) : enemies.filter((enemy) => enemy.hp > 0);
            target = strongestThreat(candidates);
          }
          if (!target) continue;
          if (profile.kind === "damage") {
            const sourcePiece = profile.sourceId ? pieces.find((piece) => piece.id === profile.sourceId) : undefined;
            const damageMult = sourcePiece ? (sourcePiece.damageMult ?? 1) : 1;
            const blockedByGroundPiece = Boolean(target.blockedBy && !target.blockedBy.startsWith("structure:") && pieces.some((piece) => piece.id === target!.blockedBy && characterById[piece.characterId]?.terrain === "ground"));
            const warMachineMultiplier = target.kind === "war-machine" && !blockedByGroundPiece ? 1 - HISTORICAL_RULES.warMachine.damageReductionWhileMoving : 1;
            const multiplier = (1 + Math.max(statusManager.potency(target.id, "armor-break", gameTime), (target.armorBreakTicks ?? 0) > 0 ? .3 : 0)) * damageMult * warMachineMultiplier;
            const amount = finiteNonNegative((profile.amount ?? 0) * multiplier); const absorbed = Math.min(target.shield ?? 0, amount); target.shield = Math.max(0, (target.shield ?? 0) - absorbed); if ((target.phaseShieldAmount ?? 0) > 0) target.phaseShieldAmount = Math.max(0, (target.phaseShieldAmount ?? 0) - absorbed); const healthDamage = amount - absorbed; target.hp -= healthDamage;
            if (profile.sourceId && pieces.some((piece) => piece.id === profile.sourceId)) unitStatistics(profile.sourceId).damage += amount;
            const kingStatistics = statistics.philosopherKing;
            if (kingStatistics && profile.sourceId === kingStatistics.pieceId) kingStatistics.throneBonus.damage += finiteNonNegative((profile.throneBonusAmount ?? 0) * multiplier);
            const analysis = psychoanalysis[target.id]; if (analysis && !profile.derivedEffect) analysis.stored = Math.min(999, analysis.stored + amount * .35);
            recordBritishEvidence(profile, target); recordSmallSynergy(profile, target); recordCopyableEffect(profile); visual({ ...profile, targetId: target.id }, amount); triggerBossPhases(target);
          } else if (profile.kind === "shield") {
            if (!statusManager.has(target.id, "no-shield", gameTime)) target.shield = (target.shield ?? 0) + finiteNonNegative(profile.amount ?? 0);
          } else if (profile.kind === "energy") {
            if (!statusManager.has(target.id, "no-energy", gameTime)) target.energy = Math.min(target.maxEnergy ?? 100, finiteNonNegative((target.energy ?? 0) + (profile.amount ?? 0)));
          } else if (profile.kind === "slow") {
            const duration = profile.duration ?? 1; if (profile.sourceId && pieces.some((piece) => piece.id === profile.sourceId)) unitStatistics(profile.sourceId).controlTime += duration;
            statusManager.add({ id: profile.id, targetId: target.id, sourceId: profile.sourceId, kind: "slow", startedAt: gameTime, expiresAt: gameTime + duration, potency: profile.potency ?? .4, derivedEffect: profile.derivedEffect }); recordSmallSynergy(profile, target); visual({ ...profile, targetId: target.id }); recordCopyableEffect(profile);
          } else if (profile.kind === "silence") {
            const duration = profile.duration ?? 1; if (profile.sourceId && pieces.some((piece) => piece.id === profile.sourceId)) unitStatistics(profile.sourceId).controlTime += duration;
            statusManager.add({ id: profile.id, targetId: target.id, sourceId: profile.sourceId, kind: profile.tags?.includes("no-energy") ? "no-energy" : "silence", startedAt: gameTime, expiresAt: gameTime + duration, potency: 1, derivedEffect: profile.derivedEffect }); recordSmallSynergy(profile, target); visual({ ...profile, targetId: target.id }); recordCopyableEffect(profile);
          } else if (profile.kind === "stun" || profile.kind === "pause") {
            const duration = profile.duration ?? .8; if (profile.sourceId && pieces.some((piece) => piece.id === profile.sourceId)) unitStatistics(profile.sourceId).controlTime += duration;
            if (!statusManager.has(target.id, "control-immune", gameTime)) statusManager.add({ id: profile.id, targetId: target.id, sourceId: profile.sourceId, kind: profile.kind, startedAt: gameTime, expiresAt: gameTime + duration, potency: 1, derivedEffect: profile.derivedEffect }); recordSmallSynergy(profile, target); visual({ ...profile, targetId: target.id }); recordCopyableEffect(profile);
          } else if (profile.kind === "death") {
            const current = enemies.find((enemy) => enemy.id === target!.id); if (!current || current.hp > 0) continue;
            enemies = enemies.filter((enemy) => enemy.id !== current.id); statusManager.removeTarget(current.id); kills += 1; statistics.enemiesDefeated += 1; routeStatistics(current.sourceRouteId ?? current.lane).defeated += 1; goldEarned += finiteNonNegative(current.rewardValue ?? enemyTemplates[current.kind].reward);
            if (current.kind === "war-machine") warMachinesDefeated += 1;
          } else if (profile.kind === "split") {
            if (target.weight < 2) continue;
            const source = profile.sourceId ? pieces.find((piece) => piece.id === profile.sourceId) : undefined; const logicBonus = source?.characterId === "russell" && snapshot.smallSynergyTiers["logical-analysis"] >= 2 ? 1 : 0; const count = target.kind === "boss" ? 3 : Math.min(4, Math.max(2, Math.round(profile.amount ?? ((source?.star ?? 1) + 1)) + logicBonus));
            const mother = target; const rewardTotal = Math.round(mother.rewardValue ?? enemyTemplates[mother.kind].reward); const coreTotal = Math.round(mother.coreDamageValue ?? enemyTemplates[mother.kind].coreDamage);
            const distribute = (total: number, index: number) => Math.floor(total / count) + (index < total % count ? 1 : 0);
            enemies = enemies.filter((enemy) => enemy.id !== mother.id); statusManager.removeTarget(mother.id);
            const atoms = Array.from({ length: count }, (_, index): Enemy => ({
              ...mother, id: `${mother.id}-atom-${index + 1}`, kind: isBossKind(mother.kind) ? mother.kind : "ordinary", hp: mother.hp / count, maxHp: mother.maxHp / count,
              weight: 1, shield: 0, rewardValue: distribute(rewardTotal, index), coreDamageValue: distribute(coreTotal, index),
              blockedBy: undefined, atomicGroupId: mother.atomicGroupId ?? mother.id, isAtom: true,
              sourceRouteId: mother.sourceRouteId ?? mother.lane, progress: Math.max(0, mother.progress - index * .025), evidence: undefined,
            }));
            enemies = [...enemies, ...atoms]; visual({ ...profile, targetId: mother.id }, count);
            if (source?.characterId === "russell" && snapshot.smallSynergyTiers["logical-analysis"] >= 3) atoms.forEach((atom) => statusManager.add({ id: `atom-slow-${tick}-${atom.id}`, targetId: atom.id, sourceId: source.id, kind: "slow", startedAt: gameTime, expiresAt: gameTime + 3, potency: .3, derivedEffect: true }));
          }
          continue;
        }
        if (profile.targetKind === "ally") {
          let target = profile.targetId ? pieces.find((piece) => piece.id === profile.targetId && (profile.kind === "death" || (piece.hp ?? 0) > 0)) : undefined;
          if (!target && profile.kind === "heal") target = lowestHealthAlly(pieces);
          if (!target) continue;
          if (profile.kind === "heal") {
            const before = target.hp ?? target.maxHp ?? 0; const heal = finiteNonNegative(profile.amount ?? 0); const after = Math.min(target.maxHp ?? before, before + heal); target.hp = after;
            const baseAfter = Math.min(target.maxHp ?? before, before + Math.max(0, heal - finiteNonNegative(profile.throneBonusAmount ?? 0)));
            const kingStatistics = statistics.philosopherKing;
            if (kingStatistics && profile.sourceId === kingStatistics.pieceId) kingStatistics.throneBonus.healing += Math.max(0, after - baseAfter);
            const excess = Math.max(0, before + heal - after); if (!profile.derivedEffect && snapshot.smallSynergyTiers.eudaimonia >= 2) { const virtueShield = excess + Math.max(0, after - before) * COMBAT_BALANCE.eudaimoniaHealingToShield; if (virtueShield > 0) { target.shield = Math.min((target.maxHp ?? 0) * COMBAT_BALANCE.eudaimoniaShieldCap, (target.shield ?? 0) + virtueShield); incrementSynergy("eudaimonia:virtuous-heal"); } }
            if (after > before) { visual({ ...profile, targetId: target.id }, after - before); if (profile.sourceId && pieces.some((piece) => piece.id === profile.sourceId)) unitStatistics(profile.sourceId).healing += after - before; } recordCopyableEffect(profile);
          } else if (profile.kind === "shield") {
            const shield = finiteNonNegative(profile.amount ?? 0); target.shield = (target.shield ?? 0) + shield; if (profile.sourceId && pieces.some((piece) => piece.id === profile.sourceId)) unitStatistics(profile.sourceId).shielding += shield; visual({ ...profile, targetId: target.id }); recordCopyableEffect(profile);
            const kingStatistics = statistics.philosopherKing;
            if (kingStatistics && profile.sourceId === kingStatistics.pieceId) kingStatistics.throneBonus.shielding += finiteNonNegative(profile.throneBonusAmount ?? 0);
          } else if (profile.kind === "energy") {
            target.energy = Math.min(target.maxEnergy ?? 100, finiteNonNegative((target.energy ?? 0) + (profile.amount ?? 0)));
          } else if (profile.kind === "damage") {
            let amount = finiteNonNegative(profile.amount ?? 0); if ((target.invulnerableTicks ?? 0) > 0 || (target.invulnerableUntil ?? 0) > gameTime) amount = 0;
            const reduction = (target.damageReductionTicks ?? 0) > 0 ? target.damageReduction ?? 0 : 0; amount *= 1 - Math.min(.8, Math.max(0, reduction));
            const contractIds = ["rousseau", "locke", "hobbes"];
            if (!profile.derivedEffect && !profile.tags?.includes("small-contract") && !profile.tags?.includes("redistributed") && snapshot.smallSynergyTiers.contract >= 2 && contractIds.includes(target.characterId)) {
              const origin = deploymentPoint(target.slotId);
              const linked = pieces.filter((ally) => ally.id !== target!.id && snapshot.unitIds.includes(ally.id) && (ally.hp ?? 0) > 0 && contractIds.includes(ally.characterId) && characterById[ally.characterId].terrain === "ground").filter((ally) => distance(origin, deploymentPoint(ally.slotId)) <= 17);
              amount *= .9;
              const transferred = amount * .2; if (linked.length && transferred > 0) { amount -= transferred; incrementSynergy("contract:redistribution"); linked.forEach((ally) => pending.push({ ...profile, id: `${profile.id}-community-${ally.id}`, targetId: ally.id, amount: transferred / linked.length, derivedEffect: true, copyable: false, tags: [...(profile.tags ?? []), "small-contract"] })); }
            }
            if (!profile.tags?.includes("redistributed") && target.contractGroupId && (target.contractUntil ?? 0) > gameTime) {
              const linked = pieces.filter((piece) => piece.id !== target!.id && piece.contractGroupId === target!.contractGroupId && (piece.hp ?? 0) > 0);
              const transferable = amount * .35; const each = linked.length ? transferable / linked.length : 0;
              if (each > 0) {
                amount -= transferable;
                linked.forEach((ally) => pending.push({ ...profile, id: `${profile.id}-share-${ally.id}`, targetId: ally.id, amount: each, derivedEffect: true, copyable: false, tags: [...(profile.tags ?? []), "redistributed"] }));
              }
            }
            const absorbed = Math.min(target.shield ?? 0, amount); target.shield = Math.max(0, (target.shield ?? 0) - amount); amount -= absorbed;
            let nextHp = (target.hp ?? 0) - amount;
            const canLastStand = target.characterId === "heidegger" || (target.lastStandCharges ?? 0) > 0;
            let protectedByLastStand = false;
            if (nextHp <= 0 && canLastStand && !target.lastStandConsumed) {
              nextHp = 1; target.lastStandConsumed = true; target.nearDeathUsed = true; target.invulnerableTicks = Math.max(target.invulnerableTicks ?? 0, 8); target.tauntTicks = Math.max(target.tauntTicks ?? 0, 18); target.blockBonus = Math.min(5 - characterById[target.characterId].block, (target.blockBonus ?? 0) + 2); target.blockBonusTicks = 18;
              protectedByLastStand = true;
            }
            if (nextHp <= 0 && !protectedByLastStand && snapshot.smallSynergyTiers.phenomenology >= 2 && ["husserl", "heidegger", "sartre"].includes(target.characterId)) {
              if (phenomenologyCharges > 0 && !target.phenomenologyUsed && !target.lastStandConsumed) { nextHp = 1; phenomenologyCharges -= 1; incrementSynergy("phenomenology:suspension"); target.phenomenologyUsed = true; target.invulnerableUntil = gameTime + 1.25; target.shield = Math.min((target.maxHp ?? 0) * COMBAT_BALANCE.phenomenologyRescueShield, (target.shield ?? 0) + (target.maxHp ?? 0) * COMBAT_BALANCE.phenomenologyRescueShield); statusManager.removeTarget(target.id); }
              else { target.shield = Math.min((target.maxHp ?? 0) * .15, (target.shield ?? 0) + (target.maxHp ?? 0) * .08); target.energy = Math.min(target.maxEnergy ?? 100, (target.energy ?? 0) + 8); }
            }
            target.hp = nextHp; unitStatistics(target.id).damageTaken += amount; visual({ ...profile, targetId: target.id }, amount);
            if (!contractRescueUsed && snapshot.smallSynergyTiers.contract >= 3 && contractIds.includes(target.characterId) && nextHp > 0 && nextHp / Math.max(1, target.maxHp ?? 1) < .35) {
              contractRescueUsed = true; incrementSynergy("contract:rescue"); target.shield = (target.shield ?? 0) + (target.maxHp ?? 0) * .2;
              const taunter = pieces.filter((ally) => snapshot.unitIds.includes(ally.id) && (ally.hp ?? 0) > 0 && contractIds.includes(ally.characterId)).sort((a, b) => (b.hp ?? 0) / Math.max(1, b.maxHp ?? 1) - (a.hp ?? 0) / Math.max(1, a.maxHp ?? 1))[0];
              if (taunter) pieces = pieces.map((ally) => ally.id === taunter.id ? { ...ally, tauntTicks: Math.max(ally.tauntTicks ?? 0, 13) } : ally);
            }
          } else if (profile.kind === "death") {
            const current = pieces.find((piece) => piece.id === target!.id); if (!current || (current.hp ?? 0) > 0) continue;
            unitStatistics(current.id).deaths += 1;
            pieces = pieces.filter((piece) => piece.id !== current.id); statusManager.removeTarget(current.id);
          }
        }
      }
      ready = queue.drainReady(gameTime);
    }
  };

  // Resolve delayed devices using their recorded position. Missing targets are safe.
  delayedDevices.filter((device) => device.executeAt <= gameTime).forEach((device) => {
    queue.enqueue({ id: `${device.id}-burst`, kind: "damage", sourceId: device.sourceId, targetKind: "position", amount: device.damage, position: device.position, radius: device.radius, copyable: false });
    queue.enqueue({ id: `${device.id}-slow`, kind: "slow", sourceId: device.sourceId, targetKind: "position", duration: device.slowDuration, potency: .45, position: device.position, radius: device.radius, copyable: false });
    if (device.copiedEffect) queue.enqueue({ ...device.copiedEffect, id: `${device.id}-copy`, executeAt: undefined, sourceId: device.sourceId, derivedEffect: true, copyable: false });
  });
  delayedDevices = delayedDevices.filter((device) => device.executeAt > gameTime);
  applyReadyEvents();

  const spawnRemaining = [...battle.spawnRemaining]; let spawned = battle.spawned ?? 0; const warMachineRoutes = [...(battle.warMachineRoutes ?? [])];
  const definition = encounterDefinition(state.wave, state.historicalEvents.seed);
  const warMachinePlan = resolveWarMachinePlan(state.historicalEvents, state.wave);
  const spawnInterval = definition.spawnInterval;
  if (spawnRemaining.length && tick % spawnInterval === 1) {
    const kind = spawnRemaining.shift()!; const template = enemyTemplates[kind]; const multiplier = definition.healthMultiplier; const lane = kind === "war-machine" ? warMachineRoutes.shift() ?? routeForSpawn(spawned, battle.routeOffset) : routeForSpawn(spawned, battle.routeOffset);
    const warMachineHealthCap = (HISTORICAL_RULES.warMachine.healthMultiplierCapByWave as Record<number, number>)[state.wave] ?? multiplier;
    const healthMultiplier = kind === "war-machine" ? Math.min(multiplier, warMachineHealthCap) : multiplier;
    enemies.push({ id: `w${state.wave}-${tick}`, kind, hp: Math.round(template.maxHp * healthMultiplier), maxHp: Math.round(template.maxHp * healthMultiplier), progress: 0, lane, sourceRouteId: lane, weight: template.weight, shield: 0, energy: 0, maxEnergy: 100, rewardValue: template.reward, coreDamageValue: template.coreDamage, bossPhasesTriggered: isBossKind(kind) ? [] : undefined, ...(kind === "war-machine" ? { warMachineBlockedTicks: 0, warMachineSummons: 0, warMachineSummonLimit: warMachinePlan?.maxSummonsPerMachine ?? 0 } : {}) }); spawned += 1; statistics.enemiesSpawned += 1; routeStatistics(lane).spawned += 1;
    if (kind === "war-machine") warMachinesSpawned += 1;
  }

  // Recompute blocking before movement so expired structures or lost capacity release enemies immediately.
  enemies = resolveBlocking(enemies, pieces, structures, gameTime);
  enemies.filter((enemy) => enemy.blockedBy && !enemy.blockedBy.startsWith("structure:")).forEach((enemy) => { unitStatistics(enemy.blockedBy!).blockedWeight += enemy.weight * FIXED_STEP_SECONDS; });
  const warMachineSummons: Enemy[] = [];
  enemies = enemies.map((enemy) => {
    if (enemy.kind !== "war-machine") return enemy;
    const blockedByGroundPiece = Boolean(enemy.blockedBy && !enemy.blockedBy.startsWith("structure:") && pieces.some((piece) => piece.id === enemy.blockedBy && characterById[piece.characterId]?.terrain === "ground"));
    const blockedTicks = blockedByGroundPiece ? (enemy.warMachineBlockedTicks ?? 0) + 1 : 0;
    const summons = enemy.warMachineSummons ?? 0;
    const limit = enemy.warMachineSummonLimit ?? 0;
    if (blockedTicks < HISTORICAL_RULES.warMachine.sustainedBlockThresholdTicks || summons >= limit) return { ...enemy, warMachineBlockedTicks: blockedTicks };
    const kind = HISTORICAL_RULES.warMachine.summonKind;
    const template = enemyTemplates[kind];
    const lane = enemy.sourceRouteId ?? enemy.lane;
    const summonIndex = summons + 1;
    warMachineSummons.push({
      id: `${enemy.id}-summon-${summonIndex}`,
      kind,
      hp: Math.round(template.maxHp * definition.healthMultiplier),
      maxHp: Math.round(template.maxHp * definition.healthMultiplier),
      progress: Math.max(0, enemy.progress - .04),
      lane,
      sourceRouteId: lane,
      weight: template.weight,
      shield: 0,
      energy: 0,
      maxEnergy: 100,
      rewardValue: 0,
      coreDamageValue: template.coreDamage,
    });
    incrementSynergy("historical:war-machine-summon");
    return { ...enemy, warMachineBlockedTicks: 0, warMachineSummons: summonIndex };
  });
  warMachineSummons.forEach((enemy) => { statistics.enemiesSpawned += 1; routeStatistics(enemy.sourceRouteId ?? enemy.lane).spawned += 1; });
  if (warMachineSummons.length) enemies = [...enemies, ...warMachineSummons];
  if (statistics.philosopherKing) {
    const royalBarrierId = structures.find((structure) => structure.kind === "royal-barrier" && structure.sourceId === statistics.philosopherKing!.pieceId)?.id;
    if (royalBarrierId) statistics.philosopherKing.barrier.blockedWeight += enemies.filter((enemy) => enemy.blockedBy === `structure:${royalBarrierId}`).reduce((sum, enemy) => sum + enemy.weight * FIXED_STEP_SECONDS, 0);
  }
  enemies = enemies.map((enemy) => {
    const legacyControl = (enemy.stunTicks ?? 0) > 0; const paused = legacyControl || statusManager.has(enemy.id, "stun", gameTime) || statusManager.has(enemy.id, "pause", gameTime);
    const slow = Math.max((enemy.slowTicks ?? 0) > 0 ? .58 : 0, statusManager.potency(enemy.id, "slow", gameTime));
    const speedFactor = paused || enemy.blockedBy ? 0 : Math.max(.2, 1 - slow);
    return {
      ...enemy,
      progress: enemy.progress + enemyTemplates[enemy.kind].speed * speedFactor * ((enemy.phaseSpeedUntil ?? 0) > gameTime ? (enemy.kind === "cave-boss" ? 1.2 : 1.45) : 1),
      sealedTicks: Math.max(0, (enemy.sealedTicks ?? 0) - 1), stunTicks: Math.max(0, (enemy.stunTicks ?? 0) - 1),
      slowTicks: Math.max(0, (enemy.slowTicks ?? 0) - 1), armorBreakTicks: Math.max(0, (enemy.armorBreakTicks ?? 0) - 1),
    };
  });
  enemies = resolveBlocking(enemies, pieces, structures, gameTime);

  const activePieces = () => pieces.filter((piece) => isFieldedSlot(piece.slotId) && (piece.hp ?? 0) > 0 && snapshot.unitIds.includes(piece.id));
  const targetsInRange = (piece: Piece) => enemies.filter((enemy) => enemy.hp > 0 && distance(deploymentPoint(piece.slotId), routePoint(enemy.progress, enemy.lane)) <= effectiveAttackRange(piece)).sort((a, b) => b.progress - a.progress);
  const nearbyEnemies = (target: Enemy, radius = 16) => enemies.filter((enemy) => enemy.hp > 0 && distance(routePoint(enemy.progress, enemy.lane), routePoint(target.progress, target.lane)) <= radius);
  const cooldowns = { ...battle.cooldowns }; let factionCasts = [...battle.factionCasts]; let greekCastCount = battle.greekCastCount; let greekDialogueCount = battle.greekDialogueCount ?? 0; let greekDerivedCharges = battle.greekDerivedCharges ?? 0;
  let concepts = battle.concepts; let germanCastIds = [...battle.germanCastIds]; let germanEchoReady = battle.germanEchoReady ?? 0; const germanAbsoluteEchoReady = { ...(battle.germanAbsoluteEchoReady ?? {}) }; let absoluteUntil = battle.absoluteUntil ?? 0; let systemCooldownUntil = battle.systemCooldownUntil ?? 0; let absoluteUsed = battle.absoluteUsed; let lastGermanTarget = battle.lastGermanTarget;
  let frenchHeat = battle.frenchHeat ?? battle.frenchArguments * 2; let revolutionCooldownUntil = battle.revolutionCooldownUntil ?? 0; let revolutionTriggered = battle.revolutionTriggered ?? false; let revolutionStructureUsed = battle.revolutionStructureUsed ?? false; let lastFrenchTarget = battle.lastFrenchTarget;
  const researches = snapshot.preparationPlan.activeResearches ?? [];
  const researchAttackSpeedMultiplier = researches.some((research) => research.choice === "mechanics") ? 1.15 : 1;
  const researchSupportMultiplier = researches.some((research) => research.choice === "medicine") ? 1.25 : 1;

  const enqueue = (profile: EffectProfile) => {
    const supported = !profile.derivedEffect && (profile.kind === "heal" || profile.kind === "shield") && profile.amount !== undefined ? { ...profile, amount: profile.amount * researchSupportMultiplier } : profile;
    queue.enqueue(supported); return supported;
  };
  const afterNormalSkill = (piece: Piece, target: Enemy | undefined, mechanicBonus: number) => {
    const unit = characterById[piece.characterId]; const faction = unit.faction;
    if (!factionCasts.includes(faction)) factionCasts.push(faction);
    if (snapshot.factionTiers.greece >= 2 && factionCasts.length >= 2) {
      const rostrum = snapshot.rostrumId ? pieces.find((ally) => ally.id === snapshot.rostrumId && (ally.hp ?? 0) > 0) : undefined;
      if (rostrum) {
        enqueue({ id: `dialogue-energy-${tick}`, kind: "energy", sourceId: piece.id, targetKind: "ally", targetId: rostrum.id, amount: 8, copyable: false });
        enqueue({ id: `dialogue-shield-${tick}`, kind: "shield", sourceId: piece.id, targetKind: "ally", targetId: rostrum.id, amount: 34, copyable: false });
        effects.push({ id: `dialogue-${tick}`, type: "synergy", slotId: rostrum.slotId, amount: 2, age: 0 });
      }
      greekDialogueCount += 1; incrementSynergy("greece:dialogue"); greekCastCount = 0; factionCasts = [faction];
      const distinctFactions = Object.values(snapshot.factionCounts).filter((count) => count > 0).length;
      if (snapshot.factionTiers.greece >= 4 && distinctFactions >= 3 && greekDialogueCount % 3 === 0 && snapshot.rostrumId && pieces.some((ally) => ally.id === snapshot.rostrumId && (ally.hp ?? 0) > 0)) greekDerivedCharges += 1;
    }
    if (snapshot.factionTiers.germany >= 2 && faction === "germany") {
      concepts += 1; germanCastIds = [...new Set([...germanCastIds, piece.id])]; lastGermanTarget = target?.id ?? lastGermanTarget;
      const threshold = snapshot.factionTiers.germany >= 4 ? 4 : 6;
      if (concepts >= threshold && gameTime >= systemCooldownUntil) {
        concepts -= threshold; systemCooldownUntil = gameTime + 4;
        activePieces().filter((ally) => characterById[ally.characterId].faction === "germany").forEach((ally) => {
          enqueue({ id: `system-shield-${tick}-${ally.id}`, kind: "shield", sourceId: piece.id, targetKind: "ally", targetId: ally.id, amount: 55, copyable: false });
          enqueue({ id: `system-energy-${tick}-${ally.id}`, kind: "energy", sourceId: piece.id, targetKind: "ally", targetId: ally.id, amount: 18, copyable: false });
        });
        if (snapshot.factionTiers.germany >= 4) germanEchoReady += 1;
        incrementSynergy("germany:system");
        effects.push({ id: `concept-${tick}`, type: "synergy", amount: threshold, age: 0 });
      }
      const germanSnapshotIds = snapshot.unitIds.filter((id) => characterById[pieces.find((ally) => ally.id === id)?.characterId ?? ""]?.faction === "germany");
      if (snapshot.factionTiers.germany >= 6 && !absoluteUsed && germanSnapshotIds.length >= 6 && germanSnapshotIds.every((id) => germanCastIds.includes(id))) {
        absoluteUsed = true; absoluteUntil = gameTime + 8; incrementSynergy("germany:absolute");
        germanSnapshotIds.forEach((id) => { germanAbsoluteEchoReady[id] = true; });
        activePieces().filter((ally) => germanSnapshotIds.includes(ally.id)).forEach((ally) => enqueue({ id: `absolute-energy-${tick}-${ally.id}`, kind: "energy", sourceId: piece.id, targetKind: "ally", targetId: ally.id, amount: 55, copyable: false }));
        effects.push({ id: `absolute-${tick}`, type: "synergy", amount: 8, age: 0 });
      }
    }
    if (snapshot.factionTiers.france >= 2 && faction === "france") {
      frenchHeat += Math.min(3, 2 + Math.max(0, mechanicBonus)); lastFrenchTarget = target?.id ?? lastFrenchTarget;
      const threshold = snapshot.factionTiers.france >= 4 ? 6 : 8;
      if (frenchHeat >= threshold && gameTime >= revolutionCooldownUntil) {
        frenchHeat -= threshold; revolutionCooldownUntil = gameTime + 8;
        const point = revolutionNodePoint(snapshot.revolutionNodeId);
        enqueue({ id: `revolution-slow-${tick}`, kind: "slow", sourceId: piece.id, targetKind: "position", position: point, radius: 18, duration: 2.5, potency: .5, copyable: false });
        enqueue({ id: `revolution-energy-${tick}`, kind: "silence", sourceId: piece.id, targetKind: "position", position: point, radius: 18, duration: 2.5, tags: ["no-energy"], copyable: false });
        enemies.filter((enemy) => distance(routePoint(enemy.progress, enemy.lane), point) <= 18).forEach((enemy) => { enemy.shield = 0; });
        effects.push({ id: `revolution-${tick}`, type: "synergy", amount: threshold, age: 0 }); revolutionTriggered = true; incrementSynergy("france:revolution");
        if (snapshot.factionTiers.france >= 4 && !revolutionStructureUsed) {
          const commune = snapshot.factionTiers.france >= 6;
          enqueue({ id: `revolution-structure-${tick}`, kind: "spawn", sourceId: piece.id, targetKind: "position", position: point, amount: commune ? 3 : 2, duration: commune ? 7 : 5, copyable: false, derivedEffect: true, tags: ["revolution-structure"] });
          revolutionStructureUsed = true;
        }
      }
    }
  };

  const castSkill = (piece: Piece, options: { derivedEffect?: boolean; powerScale?: number } = {}) => {
    const unit = characterById[piece.characterId]; if (!unit) return;
    const derivedEffect = options.derivedEffect ?? false; const power = unit.skill.power * piece.star * (piece.empoweredSkill ? 1.35 : 1) * (options.powerScale ?? 1);
    const targets = targetsInRange(piece); const primary = strongestThreat(targets); let skillTarget = primary; let mechanicBonus = 0;
    const queueSizeBefore = queue.snapshot().length; const delayedCountBefore = delayedDevices.length;
    if (!derivedEffect) pieces = pieces.map((ally) => ally.id === piece.id ? { ...ally, energy: 0, empoweredSkill: false, casts: (ally.casts ?? 0) + 1 } : ally);
    effects.push({ id: `${derivedEffect ? "echo" : "skill"}-${tick}-${piece.id}-${effects.length}`, type: derivedEffect ? "echo" : "skill", slotId: piece.slotId, enemyId: primary?.id, amount: Math.round(power * 100), age: 0, derivedEffect });
    if (unit.skill.id === "socratic" && primary) {
      primary.energy = Math.max(0, (primary.energy ?? 0) - 25 * power); enqueue({ id: `socratic-${tick}-${primary.id}`, kind: "pause", sourceId: piece.id, targetKind: "enemy", targetId: primary.id, duration: .8, derivedEffect, copyable: true });
    } else if (unit.skill.id === "plato") {
      const count = piece.star + 1; const candidates = targets.filter((enemy) => !enemy.blockedBy && !statusManager.has(enemy.id, "cave-immunity", gameTime)).sort((a, b) => b.progress - a.progress).slice(0, count);
      candidates.forEach((enemy) => {
        const duration = isBossKind(enemy.kind) ? 1 : [0, 1.5, 1.8, 2.1][piece.star];
        enqueue({ id: `cave-${tick}-${enemy.id}`, kind: "pause", sourceId: piece.id, targetKind: "enemy", targetId: enemy.id, duration, derivedEffect, copyable: true });
        statusManager.add({ id: `cave-immunity-${tick}-${enemy.id}`, targetId: enemy.id, sourceId: piece.id, kind: "cave-immunity", startedAt: gameTime, expiresAt: gameTime + 8, potency: 1, derivedEffect });
      });
    } else if (unit.skill.id === "aristotle") {
      const target = highestHp(targets); if (target) { skillTarget = target; enqueue({ id: `four-causes-${tick}-${target.id}`, kind: "damage", sourceId: piece.id, targetKind: "enemy", targetId: target.id, amount: unit.combat.damage * COMBAT_BALANCE.aristotleSkillMultiplier * power, position: routePoint(target.progress, target.lane), radius: 16, derivedEffect, copyable: true }); target.armorBreakTicks = Math.max(target.armorBreakTicks ?? 0, 18); }
    } else if (unit.skill.id === "epicurus") {
      const ally = lowestHealthAlly(activePieces()); if (ally && (ally.hp ?? 0) < (ally.maxHp ?? 0)) enqueue({ id: `garden-heal-${tick}`, kind: "heal", sourceId: piece.id, targetKind: "ally", targetId: ally.id, amount: 185 * power, derivedEffect, copyable: true }); else if (ally) enqueue({ id: `garden-shield-${tick}`, kind: "shield", sourceId: piece.id, targetKind: "ally", targetId: ally.id, amount: 100 * power, derivedEffect, copyable: true });
    } else if (unit.skill.id === "fichte") {
      enqueue({ id: `fichte-shield-${tick}`, kind: "shield", sourceId: piece.id, targetKind: "ally", targetId: piece.id, amount: 130 * power, derivedEffect, copyable: true }); pieces = pieces.map((ally) => ally.id === piece.id ? { ...ally, tauntTicks: 22, blockBonus: 1, blockBonusTicks: 22 } : ally);
    } else if (unit.skill.id === "husserl") {
      const ally = lowestHealthAlly(activePieces()); if (ally && (ally.hp ?? 0) < (ally.maxHp ?? 0)) enqueue({ id: `reduction-heal-${tick}`, kind: "heal", sourceId: piece.id, targetKind: "ally", targetId: ally.id, amount: 200 * power, derivedEffect, copyable: true }); else if (ally) enqueue({ id: `reduction-shield-${tick}`, kind: "shield", sourceId: piece.id, targetKind: "ally", targetId: ally.id, amount: 120 * power, derivedEffect, copyable: true });
    } else if (unit.skill.id === "schelling" && primary) {
      const point = routePoint(primary.progress, primary.lane); enqueue({ id: `ages-now-${tick}`, kind: "damage", sourceId: piece.id, targetKind: "position", position: point, radius: 18, amount: unit.combat.damage * 1.45 * power, derivedEffect, copyable: true }); enqueue({ id: `ages-past-${tick}`, kind: "slow", sourceId: piece.id, targetKind: "position", position: point, radius: 18, duration: 2.4, potency: .45, derivedEffect, copyable: true }); queue.enqueue({ id: `ages-future-${tick}`, kind: "damage", sourceId: piece.id, targetKind: "position", position: point, radius: 18, amount: unit.combat.damage * 1.8 * power, executeAt: gameTime + 1.2, derivedEffect, copyable: true });
    } else if (unit.skill.id === "heidegger") {
      pieces = pieces.map((ally) => ally.id === piece.id ? { ...ally, invulnerableTicks: 8, tauntTicks: 18, blockBonus: 2, blockBonusTicks: 18 } : ally);
    } else if (unit.skill.id === "kant") {
      const target = enemies.filter((enemy) => enemy.hp > 0 && (isBossKind(enemy.kind) || enemy.kind === "elite")).sort((a, b) => b.progress - a.progress || b.hp - a.hp)[0] ?? highestHp(targets); if (target) { skillTarget = target; const duration = isFinalBossKind(target.kind) ? 1.68 : isBossKind(target.kind) || target.kind === "elite" ? 3.36 : 1.6; statusManager.add({ id: `thing-itself-${tick}`, targetId: target.id, sourceId: piece.id, kind: "silence", startedAt: gameTime, expiresAt: gameTime + duration, potency: 1, derivedEffect }); target.energy = 0; queue.enqueue({ id: `kant-delayed-${tick}`, kind: "damage", sourceId: piece.id, targetKind: "enemy", targetId: target.id, amount: Math.min(180, unit.combat.damage * 1.5 * power), position: routePoint(target.progress, target.lane), radius: 16, executeAt: gameTime + duration, derivedEffect, copyable: true }); mechanicBonus = 1; target.sealedTicks = Math.max(target.sealedTicks ?? 0, isFinalBossKind(target.kind) ? 7 : 14); target.delayedDamage = Math.min(180, Math.round(unit.combat.damage * 1.5 * power)); }
    } else if (unit.skill.id === "hegel" && primary) {
      const point = routePoint(primary.progress, primary.lane); const area = nearbyEnemies(primary, 18); area.forEach((enemy) => enqueue({ id: `sublation-${tick}-${enemy.id}`, kind: "damage", sourceId: piece.id, targetKind: "enemy", targetId: enemy.id, amount: unit.combat.damage * 1.15 * power, derivedEffect, copyable: true })); if (!area.length) enqueue({ id: `sublation-fallback-${tick}`, kind: "damage", sourceId: piece.id, targetKind: "position", position: point, radius: 18, amount: unit.combat.damage * power, derivedEffect, copyable: true });
    } else if (unit.skill.id === "descartes" && primary) {
      statusManager.add({ id: `certainty-${tick}`, targetId: piece.id, sourceId: piece.id, kind: "control-immune", startedAt: gameTime, expiresAt: gameTime + 3, potency: 1, derivedEffect }); enqueue({ id: `cogito-${tick}`, kind: "damage", sourceId: piece.id, targetKind: "enemy", targetId: primary.id, amount: unit.combat.damage * 2.2 * power, derivedEffect, copyable: true, tags: ["ignore-defense"] });
    } else if (unit.skill.id === "rousseau") {
      const ground = activePieces().filter((ally) => characterById[ally.characterId].terrain === "ground").sort((a, b) => distance(deploymentPoint(a.slotId), deploymentPoint(piece.slotId)) - distance(deploymentPoint(b.slotId), deploymentPoint(piece.slotId))).slice(0, piece.star + 1); const linked = ground.length > 1 ? ground : [piece]; const groupId = `contract-${piece.id}-${tick}`; pieces = pieces.map((ally) => linked.some((member) => member.id === ally.id) ? { ...ally, contractGroupId: groupId, contractUntil: gameTime + 6, damageReduction: linked.length === 1 ? .2 : ally.damageReduction, damageReductionTicks: linked.length === 1 ? 25 : ally.damageReductionTicks } : ally); linked.forEach((ally) => enqueue({ id: `contract-shield-${tick}-${ally.id}`, kind: "shield", sourceId: piece.id, targetKind: "ally", targetId: ally.id, amount: 75 * power, derivedEffect, copyable: true }));
    } else if (unit.skill.id === "sartre" && primary) {
      enqueue({ id: `choice-${tick}`, kind: "damage", sourceId: piece.id, targetKind: "enemy", targetId: primary.id, amount: unit.combat.damage * 2.2 * power, derivedEffect, copyable: true }); pieces = pieces.map((ally) => ally.id === piece.id ? { ...ally, attackSpeedTicks: 20 } : ally);
    } else if (unit.skill.id === "foucault" && primary) {
      const point = routePoint(primary.progress, primary.lane); enqueue({ id: `panopticon-slow-${tick}`, kind: "slow", sourceId: piece.id, targetKind: "position", position: point, radius: 18, duration: 3, potency: .45, derivedEffect, copyable: true }); enqueue({ id: `panopticon-damage-${tick}`, kind: "damage", sourceId: piece.id, targetKind: "position", position: point, radius: 18, amount: unit.combat.damage * 1.2 * power, derivedEffect, copyable: true });
    } else if (unit.skill.id === "locke") {
      const ally = lowestHealthAlly(activePieces()); if (ally) enqueue({ id: `rights-shield-${tick}`, kind: "shield", sourceId: piece.id, targetKind: "ally", targetId: ally.id, amount: 130 * power, derivedEffect, copyable: true });
    } else if (unit.skill.id === "hume" && primary) {
      enqueue({ id: `causality-${tick}`, kind: "damage", sourceId: piece.id, targetKind: "enemy", targetId: primary.id, amount: unit.combat.damage * 1.7 * power, derivedEffect, copyable: true }); enqueue({ id: `causality-slow-${tick}`, kind: "slow", sourceId: piece.id, targetKind: "enemy", targetId: primary.id, duration: 2, potency: .35, derivedEffect, copyable: true });
    } else if (unit.skill.id === "hobbes") {
      const blockedWeight = enemies.filter((enemy) => enemy.blockedBy === piece.id).reduce((sum, enemy) => sum + enemy.weight, 0); enqueue({ id: `leviathan-${tick}`, kind: "shield", sourceId: piece.id, targetKind: "ally", targetId: piece.id, amount: (130 + blockedWeight * COMBAT_BALANCE.hobbesShieldPerBlockedWeight) * power, derivedEffect, copyable: true }); pieces = pieces.map((ally) => ally.id === piece.id ? { ...ally, tauntTicks: 24, damageReduction: Math.min(COMBAT_BALANCE.hobbesReductionCap, .12 + blockedWeight * COMBAT_BALANCE.hobbesReductionPerBlockedWeight), damageReductionTicks: 24 } : ally);
    } else if (unit.skill.id === "russell") {
      const target = targets.filter((enemy) => enemy.weight >= 2 && !enemy.isAtom && enemy.kind !== "war-machine").sort((a, b) => b.weight - a.weight || b.hp - a.hp)[0]; if (target) { skillTarget = target; enqueue({ id: `logical-atoms-${tick}`, kind: "split", sourceId: piece.id, targetKind: "enemy", targetId: target.id, amount: Math.min(4, piece.star + 1), derivedEffect, copyable: false }); } else if (primary) { primary.shield = 0; enqueue({ id: `russell-fallback-${tick}`, kind: "damage", sourceId: piece.id, targetKind: "enemy", targetId: primary.id, amount: unit.combat.damage * 3.2 * power, derivedEffect, copyable: true }); mechanicBonus = 1; }
    } else if (unit.skill.id === "bacon" && primary) {
      // Induction's third-hit passive remains intact below; a full energy bar now
      // reaches a real conclusion instead of silently consuming energy.
      enqueue({ id: `induction-conclusion-${tick}-${primary.id}`, kind: "damage", sourceId: piece.id, targetKind: "enemy", targetId: primary.id, amount: unit.combat.damage * 2.2 * power, derivedEffect, copyable: true });
      enqueue({ id: `induction-conclusion-slow-${tick}-${primary.id}`, kind: "slow", sourceId: piece.id, targetKind: "enemy", targetId: primary.id, duration: 1.5, potency: .25, derivedEffect, copyable: true });
    } else if (unit.skill.id === "bentham") {
      const allies = activePieces(); const totalHp = allies.reduce((sum, ally) => sum + (ally.hp ?? 0), 0); const totalMax = allies.reduce((sum, ally) => sum + Math.max(1, ally.maxHp ?? 1), 0);
      if (totalMax > 0) pieces = pieces.map((ally) => allies.some((candidate) => candidate.id === ally.id) ? { ...ally, hp: Math.min(ally.maxHp ?? 0, Math.max(0, (ally.maxHp ?? 0) * totalHp / totalMax)) } : ally);
      const self = pieces.find((ally) => ally.id === piece.id); if (self) enqueue({ id: `utility-heal-${tick}`, kind: "heal", sourceId: piece.id, targetKind: "ally", targetId: piece.id, amount: 100 * power, copyable: false });
    } else if (unit.skill.id === "deleuze" && primary) {
      const linked = nearbyEnemies(primary, 22).slice(0, Math.max(2, piece.star + 1));
      linked.forEach((target) => { enqueue({ id: `rhizome-damage-${tick}-${target.id}`, kind: "damage", sourceId: piece.id, targetKind: "enemy", targetId: target.id, amount: unit.combat.damage * (linked.length === 1 ? 2.4 : 1.15) * power, derivedEffect, copyable: true }); enqueue({ id: `rhizome-slow-${tick}-${target.id}`, kind: "slow", sourceId: piece.id, targetKind: "enemy", targetId: target.id, duration: 1.5, potency: .3, derivedEffect, copyable: true }); });
    } else if (unit.skill.id === "derrida" && primary) {
      if ((primary.shield ?? 0) > 0) { primary.shield = 0; mechanicBonus = 1; }
      else { enqueue({ id: `deconstruct-slow-${tick}-${primary.id}`, kind: "slow", sourceId: piece.id, targetKind: "enemy", targetId: primary.id, duration: 2.4, potency: .45, derivedEffect, copyable: true }); enqueue({ id: `deconstruct-silence-${tick}-${primary.id}`, kind: "silence", sourceId: piece.id, targetKind: "enemy", targetId: primary.id, duration: 2.4, derivedEffect, copyable: true }); }
    } else if (unit.skill.id === "lacan") {
      const target = strongestThreat(enemies); if (target) { skillTarget = target; psychoanalysis[target.id] = { sourceId: piece.id, targetId: target.id, stored: 0, expiresAt: gameTime + 4 }; enqueue({ id: `psychoanalysis-mark-${tick}-${target.id}`, kind: "silence", sourceId: piece.id, targetKind: "enemy", targetId: target.id, duration: .6, derivedEffect, copyable: false }); }
    } else if (unit.skill.id === "wittgenstein" && primary) {
      const special = primary.kind === "caster" || primary.kind === "elite" || isBossKind(primary.kind);
      if (special) enqueue({ id: `unsayable-silence-${tick}-${primary.id}`, kind: "silence", sourceId: piece.id, targetKind: "enemy", targetId: primary.id, duration: 3, derivedEffect, copyable: false });
      else { enqueue({ id: `unsayable-damage-${tick}-${primary.id}`, kind: "damage", sourceId: piece.id, targetKind: "enemy", targetId: primary.id, amount: unit.combat.damage * 2.4 * power, derivedEffect, copyable: false }); enqueue({ id: `unsayable-no-shield-${tick}-${primary.id}`, kind: "silence", sourceId: piece.id, targetKind: "enemy", targetId: primary.id, duration: 3, tags: ["no-shield"], derivedEffect, copyable: false }); }
    } else if (unit.skill.id === "althusser") {
      const point = primary ? routePoint(primary.progress, primary.lane) : revolutionNodePoint("debate-plaza"); delayedDevices.push({ id: `apparatus-${tick}-${piece.id}`, sourceId: piece.id, position: point, radius: 18, executeAt: gameTime + 3, damage: unit.combat.damage * 2.2 * power, slowDuration: 2.5 }); skillTarget = primary;
    }
    if (!derivedEffect) {
      const producedWork = Boolean(skillTarget) || queue.snapshot().length > queueSizeBefore || delayedDevices.length > delayedCountBefore || ["fichte", "heidegger", "rousseau", "bentham"].includes(unit.skill.id);
      const stats = unitStatistics(piece.id);
      if (producedWork) stats.effectiveTargets += Math.max(1, skillTarget ? 1 : 0);
      else stats.wastedCasts += 1;
      const greekEcho = snapshot.factionTiers.greece >= 4 && piece.id === snapshot.rostrumId && greekDerivedCharges > 0;
      const sublationEcho = snapshot.smallSynergyTiers.dialectic >= 4 && piece.sublationEchoReady === true;
      const germanGlobalEcho = snapshot.factionTiers.germany >= 4 && characterById[piece.characterId].faction === "germany" && germanEchoReady > 0;
      const germanAbsoluteEcho = snapshot.factionTiers.germany >= 6 && characterById[piece.characterId].faction === "germany" && germanAbsoluteEchoReady[piece.id] === true;
      if (greekEcho) greekDerivedCharges -= 1;
      if (sublationEcho) pieces = pieces.map((ally) => ally.id === piece.id ? { ...ally, sublationEchoReady: false } : ally);
      if (germanGlobalEcho) germanEchoReady -= 1;
      if (germanAbsoluteEcho) germanAbsoluteEchoReady[piece.id] = false;
      afterNormalSkill(piece, skillTarget, mechanicBonus);
      // Deterministic order: normal skill, Greek rostrum, Germany-4, then Germany-6.
      if (greekEcho) castSkill(piece, { derivedEffect: true, powerScale: .4 });
      if (sublationEcho) castSkill(piece, { derivedEffect: true, powerScale: .3 });
      if (germanGlobalEcho) castSkill(piece, { derivedEffect: true, powerScale: .35 });
      if (germanAbsoluteEcho) castSkill(piece, { derivedEffect: true, powerScale: .5 });
    }
    applyReadyEvents();
  };

  for (const sourceId of snapshot.unitIds) {
    const live = pieces.find((piece) => piece.id === sourceId && (piece.hp ?? 0) > 0 && isFieldedSlot(piece.slotId)); if (!live) continue;
    const unit = characterById[live.characterId]; const current = Math.max(0, (cooldowns[live.id] ?? 0) - 1);
    if ((live.energy ?? 0) >= (live.maxEnergy ?? unit.combat.maxEnergy)) { unitStatistics(live.id).skillCasts += 1; castSkill(live); cooldowns[live.id] = 2; continue; }
    if (current !== 0) { cooldowns[live.id] = current; continue; }
    const target = strongestThreat(targetsInRange(live)); if (!target) { cooldowns[live.id] = 0; continue; }
    const baseRate = (live.attackSpeedTicks ?? 0) > 0 ? Math.max(3, unit.combat.attackEvery - 3) : unit.combat.attackEvery; const rate = Math.max(1, Math.round(baseRate * (live.attackRateMult ?? 1) / researchAttackSpeedMultiplier));
    const inductionHits = live.characterId === "bacon" ? (live.inductionTargetId === target.id ? (live.inductionHits ?? 0) + 1 : 1) : 0;
    if (live.characterId === "bacon") pieces = pieces.map((ally) => ally.id === live.id ? { ...ally, inductionTargetId: target.id, inductionHits: inductionHits >= 3 ? 0 : inductionHits } : ally);
    enqueue({ id: `attack-${tick}-${live.id}`, kind: "damage", sourceId: live.id, targetKind: "enemy", targetId: target.id, amount: unit.combat.damage * live.star, copyable: false, tags: ["attack"] });
    if (live.characterId === "bacon" && inductionHits >= 3) enqueue({ id: `induction-${tick}-${live.id}`, kind: "damage", sourceId: live.id, targetKind: "enemy", targetId: target.id, amount: unit.combat.damage * live.star * 1.3, copyable: false, tags: ["attack", "induction"] });
    enqueue({ id: `attack-energy-${tick}-${live.id}`, kind: "energy", sourceId: live.id, targetKind: "ally", targetId: live.id, amount: unit.combat.attackEnergy, copyable: false });
    cooldowns[live.id] = rate; applyReadyEvents();
  }

  const enemyCooldowns = { ...battle.enemyCooldowns };
  for (const enemy of enemies.filter((candidate) => candidate.blockedBy && !candidate.blockedBy.startsWith("structure:") && candidate.hp > 0)) {
    const current = Math.max(0, (enemyCooldowns[enemy.id] ?? 0) - 1); const target = pieces.find((piece) => piece.id === enemy.blockedBy && (piece.hp ?? 0) > 0);
    if (target && current === 0) {
      const analysis = psychoanalysis[enemy.id]; if (analysis && analysis.stored > 0) { enqueue({ id: `psychoanalysis-cast-${tick}-${enemy.id}`, kind: "damage", sourceId: analysis.sourceId, targetKind: "enemy", targetId: enemy.id, amount: analysis.stored, copyable: false, derivedEffect: true }); delete psychoanalysis[enemy.id]; }
      let amount = enemyUnitDamage(enemyTemplates[enemy.kind].attack, state.wave, target.characterId); if ((target.suspendShield ?? 0) > 0 && enemy.kind === "caster") { target.suspendShield = Math.max(0, (target.suspendShield ?? 0) - 1); amount = 0; }
      const attackRatePressure = 1 + Math.max(0, state.wave - 1) * .055;
      const phaseRate = (enemy.phaseAttackUntil ?? 0) > gameTime ? .65 : 1;
      enqueue({ id: `enemy-hit-${tick}-${enemy.id}`, kind: "damage", sourceId: enemy.id, targetKind: "ally", targetId: target.id, amount, copyable: false, tags: ["enemy-hit"] }); enemyCooldowns[enemy.id] = Math.max(3, Math.round(enemyTemplates[enemy.kind].attackEvery * phaseRate / attackRatePressure));
    } else enemyCooldowns[enemy.id] = current;
  }
  for (const enemy of enemies.filter((candidate) => candidate.blockedBy?.startsWith("structure:") && candidate.hp > 0)) {
    const current = Math.max(0, (enemyCooldowns[enemy.id] ?? 0) - 1);
    const structureId = enemy.blockedBy!.slice("structure:".length);
    const index = structures.findIndex((structure) => structure.id === structureId && structure.kind === "royal-barrier" && (structure.hp ?? 0) > 0);
    if (index >= 0 && current === 0) {
      const structure = structures[index]; const pressure = 1 + Math.max(0, state.wave - 1) * .18;
      const amount = Math.max(1, enemyTemplates[enemy.kind].attack * pressure - (structure.defense ?? 0));
      const hp = Math.max(0, (structure.hp ?? 0) - amount);
      structures[index] = { ...structure, hp };
      const kingStatistics = statistics.philosopherKing;
      if (kingStatistics && kingStatistics.pieceId === structure.sourceId) {
        kingStatistics.barrier.damageTaken += Math.min(structure.hp ?? 0, amount);
        kingStatistics.barrier.hits += 1;
        if (hp <= 0) kingStatistics.barrier.broke = true;
      }
      effects.push({ id: `barrier-${hp > 0 ? "hit" : "break"}-${tick}-${enemy.id}`, type: hp > 0 ? "barrierHit" : "barrierBreak", enemyId: enemy.id, amount: Math.round(amount), age: 0, message: hp > 0 ? "王城屏障承受攻击" : "王城屏障已破碎" });
      const phaseRate = (enemy.phaseAttackUntil ?? 0) > gameTime ? .65 : 1;
      enemyCooldowns[enemy.id] = Math.max(3, Math.round(enemyTemplates[enemy.kind].attackEvery * phaseRate / (1 + Math.max(0, state.wave - 1) * .055)));
    } else enemyCooldowns[enemy.id] = current;
  }
  // Ranged pressure gives highland placement, healing and shielding real
  // defensive value. Casters and elites can harass highlands while advancing;
  // ordinary melee enemies still need contact with a ground blocker to attack.
  for (const enemy of enemies.filter((candidate) => !candidate.blockedBy && (candidate.kind === "caster" || candidate.kind === "elite" || candidate.kind === "cave-boss") && candidate.progress >= .16 && candidate.hp > 0)) {
    const current = Math.max(0, (enemyCooldowns[enemy.id] ?? 0) - 1);
    const target = pieces
      .filter((piece) => isDeploySlot(piece.slotId) && characterById[piece.characterId]?.terrain === "highland" && (piece.hp ?? 0) > 0)
      .sort((left, right) => ((left.hp ?? 0) / Math.max(1, left.maxHp ?? characterById[left.characterId].stats.resolve)) - ((right.hp ?? 0) / Math.max(1, right.maxHp ?? characterById[right.characterId].stats.resolve)) || left.id.localeCompare(right.id))[0];
    if (target && current === 0) {
      const rangedMultiplier = enemy.kind === "caster" ? .72 : .56;
      let amount = enemyUnitDamage(enemyTemplates[enemy.kind].attack, state.wave, target.characterId, rangedMultiplier);
      if ((target.suspendShield ?? 0) > 0 && enemy.kind === "caster") { target.suspendShield = Math.max(0, (target.suspendShield ?? 0) - 1); amount = 0; }
      enqueue({ id: `enemy-ranged-${tick}-${enemy.id}`, kind: "damage", sourceId: enemy.id, targetKind: "ally", targetId: target.id, amount, copyable: false, tags: ["enemy-hit", "ranged-pressure"] });
      const intervalMultiplier = enemy.kind === "caster" ? 1.35 : 1.8;
      enemyCooldowns[enemy.id] = Math.max(4, Math.round(enemyTemplates[enemy.kind].attackEvery * intervalMultiplier));
    } else enemyCooldowns[enemy.id] = current;
  }
  applyReadyEvents();

  enemies.filter((enemy) => enemy.hp <= 0).forEach((enemy) => enqueue({ id: `death-${tick}-${enemy.id}`, kind: "death", targetKind: "enemy", targetId: enemy.id, copyable: false }));
  pieces.filter((piece) => (piece.hp ?? 0) <= 0).forEach((piece) => enqueue({ id: `death-${tick}-${piece.id}`, kind: "death", targetKind: "ally", targetId: piece.id, copyable: false }));
  applyReadyEvents();
  // Death resolution can remove a blocker after the earlier topology pass.
  // Never persist an enemy reference to a piece that died during this tick.
  enemies = resolveBlocking(enemies, pieces, structures, gameTime);

  const leaked = enemies.filter((enemy) => enemy.progress >= 1);
  leaked.forEach((enemy) => {
    routeFailures[enemy.sourceRouteId ?? enemy.lane] = true;
    statistics.enemiesLeaked += 1;
    routeStatistics(enemy.sourceRouteId ?? enemy.lane).leaked += 1;
    const sourceName = enemyTemplates[enemy.kind].name; const leakDamage = enemy.coreDamageValue ?? enemyTemplates[enemy.kind].coreDamage;
    statistics.coreDamageBySource[sourceName] = (statistics.coreDamageBySource[sourceName] ?? 0) + leakDamage;
    enqueue({ id: `core-${tick}-${enemy.id}`, kind: "damage", sourceId: enemy.id, targetKind: "core", amount: enemy.coreDamageValue ?? enemyTemplates[enemy.kind].coreDamage, copyable: false });
    enemies = enemies.filter((candidate) => candidate.id !== enemy.id); statusManager.removeTarget(enemy.id);
  });
  applyReadyEvents();

  const phaseThisTick = bossPhaseLog.findLast((phase) => phase.triggeredAt === gameTime);
  let settledHistoricalEvents = state.historicalEvents;
  let status: BattleStatus = "running"; let phase: CombatPhase = "combat"; let wave = state.wave; let gold = state.gold; let level = state.level; let xp = state.xp; let experienceGained = battle.experienceGained ?? 0; let summary: BattleSummary | undefined; let lastEvent = phaseThisTick ? `Boss 进入阶段：${phaseThisTick.name}` : `第 ${state.wave} 波推进中`;
  if (coreHp <= 0) {
    status = "defeat"; phase = "settlement"; lastEvent = "哲人之石已失守。";
    summary = { wave, kills, coreDamage, killGold: Math.round(goldEarned), baseIncome: 0, interest: 0, perfectBonus: 0, totalGold: 0, elapsedTicks: tick, success: false, experienceGained: battle.experienceGained ?? 0, synergyTriggers: { ...synergyTriggers }, bossPhases: [...bossPhaseLog], statistics };
  } else if (!spawnRemaining.length && !enemies.length && wave === MAX_WAVES && statistics.enemiesLeaked > 0) {
    status = "defeat"; phase = "settlement"; lastEvent = "最终敌对理念突破防线，本局挑战失败。";
    summary = { wave, kills, coreDamage, killGold: Math.round(goldEarned), baseIncome: 0, interest: 0, perfectBonus: 0, totalGold: 0, elapsedTicks: tick, success: false, experienceGained: battle.experienceGained ?? 0, synergyTriggers: { ...synergyTriggers }, bossPhases: [...bossPhaseLog], statistics };
  } else if (!spawnRemaining.length && !enemies.length) {
    const { baseIncome, interest, perfectBonus } = effectiveSettlementIncome(battle.lockedInterest ?? 0, coreDamage === 0, state.historicalEvents);
    // Historical income is claimed atomically with settlement so reloads cannot pay it twice.
    const publicSupply = resolveHistoricalEffectsFromState(state.historicalEvents, state.wave).economy.publicSupply;
    const warMachineClaim = claimWarMachineWaveReward(state.historicalEvents, state.wave, warMachinesDefeated);
    settledHistoricalEvents = warMachineClaim.state;
    const historicalBonus = publicSupply + warMachineClaim.reward;
    const potentialGold = Math.round(goldEarned) + baseIncome + interest + perfectBonus + historicalBonus; const settledGold = capGold(gold + potentialGold); const totalGold = settledGold - gold; gold = settledGold;
    const progress = normalizeProgress(level, xp + ECONOMY_RULES.automaticWaveExperience); level = progress.level; xp = progress.xp; experienceGained += ECONOMY_RULES.automaticWaveExperience;
    summary = { wave, kills, coreDamage, killGold: Math.round(goldEarned), baseIncome, interest, perfectBonus, historicalBonus, totalGold, elapsedTicks: tick, success: true, experienceGained, synergyTriggers: { ...synergyTriggers }, bossPhases: [...bossPhaseLog], statistics };
    phase = "settlement";
    if (wave === MAX_WAVES) { status = "complete"; lastEvent = "十波防守完成。"; }
    else { status = "victory"; wave += 1; lastEvent = `第 ${state.wave} 波已清剿，获得 ${totalGold} 金币。`; }
    pieces = restoreRosterAfterVictory(state.waveCheckpoint?.pieces ?? pieces, pieces);
  }

  const shop = summary?.success ? state.shopFrozen ? [...state.shop] : pickShop(level, random) : state.shop;
  const shopFrozen = summary?.success ? false : state.shopFrozen;
  let preparationPlan = state.preparationPlan;
  if (summary?.success) {
    const nextActive = (preparationPlan.activeResearches ?? []).flatMap((research) => research.wavesRemaining > 1 ? [{ ...research, wavesRemaining: research.wavesRemaining - 1 }] : []);
    const experimentSucceeded = snapshot.factionTiers.britain >= 4 && coreDamage === 0 && britishLawTriggers > 0;
    preparationPlan = {
      ...preparationPlan,
      activeResearches: nextActive,
      pendingResearchChoices: experimentSucceeded && preparationPlan.researchAwardedWave !== state.wave ? snapshot.factionTiers.britain >= 6 ? 2 : 1 : preparationPlan.pendingResearchChoices,
      pendingResearchSelections: experimentSucceeded && preparationPlan.researchAwardedWave !== state.wave ? [] : preparationPlan.pendingResearchSelections,
      researchAwardedWave: experimentSucceeded ? state.wave : preparationPlan.researchAwardedWave,
      politicalArithmeticClaimed: false,
    };
  }
  const nextBattle: BattleState = {
    ...battle, status, phase, tick, gameTime, spawnRemaining, spawned, enemies, kills, goldEarned, coreDamage,
    cooldowns, enemyCooldowns, effects, eventQueue: queue.snapshot(), statuses: statusManager.snapshot(), traitSnapshot: snapshot,
    structures, delayedDevices, lastEvent, factionCasts, greekCastCount, greekDialogueCount, greekDerivedCharges, concepts, germanCastIds,
    germanEchoReady, germanAbsoluteEchoReady, absoluteUntil, systemCooldownUntil, absoluteUsed, lastGermanTarget, frenchArguments: Math.floor(frenchHeat / 2), frenchHeat,
    revolutionCooldownUntil, revolutionTriggered, revolutionStructureUsed, britishEvidence, britishLawTriggers, evidenceLedger, routeFailures, psychoanalysis, phenomenologyCharges, contractRescueUsed, dialecticEnergyCooldownUntil,
    synergyTriggers, bossPhaseLog, statistics, experienceGained, lastFrenchTarget, summary,
    warMachineRoutes, warMachinesSpawned, warMachinesDefeated,
  };
  const campaignElapsedSeconds = summary?.success ? (state.campaignElapsedSeconds ?? 0) + gameTime : state.campaignElapsedSeconds ?? 0;
  const balanceReport = summary ? buildBalanceReport({ ...state, level, xp, gold }, pieces, summary) : undefined;
  const balanceHistory = balanceReport ? [...(state.balanceHistory ?? []), balanceReport].slice(-20) : state.balanceHistory;
  const waveEconomy = summary ? undefined : state.waveEconomy;
  const historicalEvents = summary?.success ? advanceHistoricalEventMilestones(settledHistoricalEvents, summary.wave) : state.historicalEvents;
  return { ...state, pieces, gold, level, xp, wave, coreHp, shop, shopFrozen, preparationPlan, historicalEvents, campaignElapsedSeconds, balanceHistory, waveEconomy, battle: nextBattle };
}
