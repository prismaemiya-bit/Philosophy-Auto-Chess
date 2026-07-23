import { characterById } from "./characters";
import { createTraitSnapshot } from "./combat-core";
import { isFieldedSlot, isThroneSlot, type GameState } from "./engine";
import { isUnlockId, type UnlockId } from "./content-registry";
import { historicalEventDefinitionById, isHistoricalEventId, isHistoricalStanceId, type HistoricalEventId, type HistoricalStanceId } from "./historical-events";

export const PROFILE_VERSION = 3;

export class UnsupportedProfileVersionError extends Error {}

export type ProfileAction = "refresh" | "buy-xp";
export type MissionId = "first-defense" | "mixed-lineup" | "resonance" | "savings" | "scholar" | "first-boss" | "full-lineup" | "philosopher-king" | "complete-campaign" | "first-historical-event" | "first-ideology" | "first-world-war" | "first-war-machine-defeat" | "capital-accumulation-victory" | "communism-victory" | "three-ideologies" | "historical-combinations";

export type HistoricalCombinationId = `${HistoricalEventId}+${HistoricalStanceId}`;

export type WarMachineProfileRecord = {
  runWaveId: string;
  wave: number;
  encountered: number;
  defeated: number;
};

export type HistoricalProfile = {
  viewedEventIds: HistoricalEventId[];
  chosenStanceIds: HistoricalStanceId[];
  completedCombinationIds: HistoricalCombinationId[];
  warMachineWaves: WarMachineProfileRecord[];
  victoryRunIds: string[];
  victoriesByStance: Partial<Record<HistoricalStanceId, number>>;
};

export type ProfileStats = {
  runsStarted: number;
  highestWaveCleared: number;
  victories: number;
  maxGold: number;
  maxLevel: number;
  maxPopulation: number;
  maxFactionDiversity: number;
  refreshes: number;
  xpPurchases: number;
  factionsFielded: string[];
  synergiesActivated: string[];
  philosopherKingFielded: boolean;
};

export type PlayerProfile = {
  profileVersion: typeof PROFILE_VERSION;
  stats: ProfileStats;
  history: HistoricalProfile;
  completedMissionIds: MissionId[];
  unlockedContentIds: UnlockId[];
  claimedRewardIds: string[];
};

export type MissionReward = { type: "unlock"; unlockId: UnlockId } | { type: "archive"; label: string };

export type MissionDefinition = {
  id: MissionId;
  category: "入门" | "运营" | "阵容" | "征程" | "历史";
  title: string;
  detail: string;
  target: number;
  progress: (profile: PlayerProfile) => number;
  reward?: MissionReward;
};

export const missionDefinitions: MissionDefinition[] = [
  { id: "first-defense", category: "入门", title: "守住第一问", detail: "完成任意一局的第 1 波。", target: 1, progress: ({ stats }) => stats.highestWaveCleared >= 1 ? 1 : 0 },
  { id: "mixed-lineup", category: "阵容", title: "跨越学派", detail: "曾在场上同时部署至少两个阵营。", target: 2, progress: ({ stats }) => Math.min(2, stats.maxFactionDiversity) },
  { id: "resonance", category: "阵容", title: "第一次共鸣", detail: "激活任意阵营或小羁绊。", target: 1, progress: ({ stats }) => stats.synergiesActivated.length > 0 ? 1 : 0 },
  { id: "savings", category: "运营", title: "保留余地", detail: "在任意准备阶段持有 20 金币。", target: 20, progress: ({ stats }) => Math.min(20, stats.maxGold) },
  { id: "scholar", category: "运营", title: "理念进阶", detail: "在一局中达到等级 5。", target: 5, progress: ({ stats }) => Math.min(5, stats.maxLevel) },
  { id: "first-boss", category: "征程", title: "洞穴之外", detail: "守住第 5 波 Boss。", target: 5, progress: ({ stats }) => Math.min(5, stats.highestWaveCleared) },
  { id: "full-lineup", category: "阵容", title: "八席论辩", detail: "在场上同时部署 8 名棋子。", target: 8, progress: ({ stats }) => Math.min(8, stats.maxPopulation) },
  { id: "philosopher-king", category: "阵容", title: "哲人王", detail: "将一名棋子部署到哲人王王座。", target: 1, progress: ({ stats }) => stats.philosopherKingFielded ? 1 : 0 },
  { id: "complete-campaign", category: "征程", title: "往哲荣耀", detail: "完成十波防守。", target: 1, progress: ({ stats }) => stats.victories > 0 ? 1 : 0 },
  { id: "first-historical-event", category: "历史", title: "历史向我们走来", detail: "首次看见一个历史事件。", target: 1, progress: ({ history }) => Math.min(1, history.viewedEventIds.length), reward: { type: "archive", label: "档案印记：见证" } },
  { id: "first-ideology", category: "历史", title: "思想选择自身", detail: "首次确定一种意识形态。", target: 1, progress: ({ history }) => Math.min(1, history.chosenStanceIds.length), reward: { type: "archive", label: "档案印记：抉择" } },
  { id: "first-world-war", category: "历史", title: "工具理性的阴影", detail: "首次经历世界大战的战争机器波次。", target: 1, progress: ({ history }) => Math.min(1, history.warMachineWaves.length), reward: { type: "archive", label: "档案印记：警醒" } },
  { id: "first-war-machine-defeat", category: "历史", title: "机器并非命运", detail: "首次击败一台战争机器。", target: 1, progress: ({ history }) => Math.min(1, history.warMachineWaves.reduce((sum, record) => sum + record.defeated, 0)), reward: { type: "archive", label: "档案印记：反抗" } },
  { id: "capital-accumulation-victory", category: "历史", title: "穿过积累", detail: "在资本积累事件下完成十波征程。", target: 1, progress: ({ history }) => history.completedCombinationIds.some((id) => id.startsWith("event:capital_accumulation+")) ? 1 : 0, reward: { type: "archive", label: "档案印记：积累" } },
  { id: "communism-victory", category: "历史", title: "公共的胜利", detail: "选择共产主义并完成十波征程。", target: 1, progress: ({ history }) => (history.victoriesByStance["stance:communism"] ?? 0) > 0 ? 1 : 0, reward: { type: "archive", label: "档案印记：共同体" } },
  { id: "three-ideologies", category: "历史", title: "三条思想道路", detail: "在不同征程中选择三种意识形态。", target: 3, progress: ({ history }) => Math.min(3, history.chosenStanceIds.length), reward: { type: "archive", label: "档案印记：复调" } },
  { id: "historical-combinations", category: "历史", title: "历史的多重答案", detail: "完成三种不同的事件与意识形态组合。", target: 3, progress: ({ history }) => Math.min(3, history.completedCombinationIds.length), reward: { type: "archive", label: "档案印记：综合" } },
];

export function makeInitialProfile(): PlayerProfile {
  return {
    profileVersion: PROFILE_VERSION,
    stats: {
      runsStarted: 0,
      highestWaveCleared: 0,
      victories: 0,
      maxGold: 0,
      maxLevel: 1,
      maxPopulation: 0,
      maxFactionDiversity: 0,
      refreshes: 0,
      xpPurchases: 0,
      factionsFielded: [],
      synergiesActivated: [],
      philosopherKingFielded: false,
    },
    history: { viewedEventIds: [], chosenStanceIds: [], completedCombinationIds: [], warMachineWaves: [], victoryRunIds: [], victoriesByStance: {} },
    completedMissionIds: [],
    unlockedContentIds: [],
    claimedRewardIds: [],
  };
}

const finiteWhole = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const knownMissionIds = new Set<MissionId>(missionDefinitions.map((mission) => mission.id));

export function migrateProfile(input: unknown): PlayerProfile {
  if (!input || typeof input !== "object") return makeInitialProfile();
  const raw = input as { profileVersion?: unknown; stats?: Record<string, unknown>; history?: Record<string, unknown>; completedMissionIds?: unknown; unlockedContentIds?: unknown; claimedRewardIds?: unknown };
  if (typeof raw.profileVersion === "number" && raw.profileVersion > PROFILE_VERSION) throw new UnsupportedProfileVersionError("该局外档案由更新版本创建");
  const base = makeInitialProfile();
  const stats = raw.stats ?? {};
  const rawHistory = raw.history ?? {};
  const stringList = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : [];
  const combinationIds = stringList(rawHistory.completedCombinationIds).filter((id): id is HistoricalCombinationId => {
    const [eventId, stanceId, extra] = id.split("+");
    return !extra && isHistoricalEventId(eventId) && isHistoricalStanceId(stanceId) && historicalEventDefinitionById.get(eventId)?.compatibleStanceIds.includes(stanceId) === true;
  });
  const warMachineRecords = new Map<string, WarMachineProfileRecord>();
  if (Array.isArray(rawHistory.warMachineWaves)) rawHistory.warMachineWaves.forEach((value) => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const runWaveId = typeof record.runWaveId === "string" ? record.runWaveId.trim() : "";
    const wave = Math.min(10, finiteWhole(record.wave));
    const encountered = finiteWhole(record.encountered);
    const defeated = Math.min(encountered, finiteWhole(record.defeated));
    if (!runWaveId || wave < 1 || encountered < 1) return;
    const previous = warMachineRecords.get(runWaveId);
    warMachineRecords.set(runWaveId, { runWaveId, wave, encountered: Math.max(previous?.encountered ?? 0, encountered), defeated: Math.max(previous?.defeated ?? 0, defeated) });
  });
  const victoriesByStance = Object.fromEntries(Object.entries(rawHistory.victoriesByStance && typeof rawHistory.victoriesByStance === "object" ? rawHistory.victoriesByStance : {}).flatMap(([id, count]) => isHistoricalStanceId(id) ? [[id, finiteWhole(count)]] : [])) as Partial<Record<HistoricalStanceId, number>>;
  const profile: PlayerProfile = {
    profileVersion: PROFILE_VERSION,
    stats: {
      runsStarted: finiteWhole(stats.runsStarted),
      highestWaveCleared: Math.min(10, finiteWhole(stats.highestWaveCleared)),
      victories: finiteWhole(stats.victories),
      maxGold: finiteWhole(stats.maxGold),
      maxLevel: Math.max(1, Math.min(8, finiteWhole(stats.maxLevel))),
      // Historical events can raise the legal fielded count above the base eight.
      maxPopulation: Math.min(20, finiteWhole(stats.maxPopulation)),
      maxFactionDiversity: Math.min(4, finiteWhole(stats.maxFactionDiversity)),
      refreshes: finiteWhole(stats.refreshes),
      xpPurchases: finiteWhole(stats.xpPurchases),
      factionsFielded: stringList(stats.factionsFielded),
      synergiesActivated: stringList(stats.synergiesActivated),
      philosopherKingFielded: stats.philosopherKingFielded === true,
    },
    history: {
      viewedEventIds: stringList(rawHistory.viewedEventIds).filter(isHistoricalEventId),
      chosenStanceIds: stringList(rawHistory.chosenStanceIds).filter(isHistoricalStanceId),
      completedCombinationIds: combinationIds,
      warMachineWaves: [...warMachineRecords.values()],
      victoryRunIds: stringList(rawHistory.victoryRunIds).filter((id) => id.trim().length > 0),
      victoriesByStance,
    },
    completedMissionIds: Array.isArray(raw.completedMissionIds) ? [...new Set(raw.completedMissionIds.filter((id): id is MissionId => typeof id === "string" && knownMissionIds.has(id as MissionId)))] : base.completedMissionIds,
    // Preserve valid namespaced IDs even when this build does not know the
    // future content yet. Runtime pools still require explicit registration.
    unlockedContentIds: Array.isArray(raw.unlockedContentIds) ? [...new Set(raw.unlockedContentIds.filter(isUnlockId))] : [],
    claimedRewardIds: Array.isArray(raw.claimedRewardIds) ? [...new Set(raw.claimedRewardIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0))] : [],
  };
  return completeEligibleMissions(profile);
}

export function completeEligibleMissions(profile: PlayerProfile, definitions: readonly MissionDefinition[] = missionDefinitions): PlayerProfile {
  const completed = new Set(profile.completedMissionIds);
  const unlocked = new Set(profile.unlockedContentIds);
  const claimed = new Set(profile.claimedRewardIds);
  definitions.forEach((mission) => {
    if (mission.progress(profile) < mission.target) return;
    completed.add(mission.id);
    if (!mission.reward) return;
    const rewardId = `${mission.id}:reward`;
    if (claimed.has(rewardId)) return;
    if (mission.reward.type === "unlock") unlocked.add(mission.reward.unlockId);
    claimed.add(rewardId);
  });
  return { ...profile, completedMissionIds: [...completed], unlockedContentIds: [...unlocked], claimedRewardIds: [...claimed] };
}

export function recordRunStarted(profile: PlayerProfile): PlayerProfile {
  return completeEligibleMissions({ ...profile, stats: { ...profile.stats, runsStarted: profile.stats.runsStarted + 1 } });
}

export function recordProfileAction(profile: PlayerProfile, action: ProfileAction): PlayerProfile {
  const stats = { ...profile.stats };
  if (action === "refresh") stats.refreshes += 1;
  if (action === "buy-xp") stats.xpPurchases += 1;
  return completeEligibleMissions({ ...profile, stats });
}

export function observeGameState(profile: PlayerProfile, state: GameState): PlayerProfile {
  const fielded = state.pieces.filter((piece) => isFieldedSlot(piece.slotId));
  const factions = new Set(profile.stats.factionsFielded);
  const currentFactions = new Set<string>();
  fielded.forEach((piece) => { const faction = characterById[piece.characterId]?.faction; if (faction) { factions.add(faction); currentFactions.add(faction); } });
  const snapshot = createTraitSnapshot(state.pieces, state.preparationPlan);
  const synergies = new Set(profile.stats.synergiesActivated);
  Object.entries(snapshot.factionTiers).forEach(([id, tier]) => { if (tier >= 2) synergies.add(id); });
  Object.entries(snapshot.smallSynergyTiers).forEach(([id, tier]) => { if (tier >= 2) synergies.add(id); });
  const clearedWaves = (state.balanceHistory ?? []).filter((report) => report.success).map((report) => report.wave);
  const highestWaveCleared = Math.max(profile.stats.highestWaveCleared, ...clearedWaves, 0);
  const won = clearedWaves.includes(10) || (state.battle?.status === "complete" && state.battle.summary?.success === true);
  const viewedEvents = new Set(profile.history.viewedEventIds);
  const chosenStances = new Set(profile.history.chosenStanceIds);
  const completedCombinations = new Set(profile.history.completedCombinationIds);
  const victoryRunIds = new Set(profile.history.victoryRunIds);
  const victoriesByStance = { ...profile.history.victoriesByStance };
  if (state.historicalEvents.eventId && state.wave >= 3) viewedEvents.add(state.historicalEvents.eventId);
  if (state.historicalEvents.selectedStanceId) chosenStances.add(state.historicalEvents.selectedStanceId);
  const warMachineWaves = new Map(profile.history.warMachineWaves.map((record) => [record.runWaveId, record]));
  const battleWave = state.battle?.summary?.wave ?? state.wave;
  const machinesEncountered = state.battle?.warMachinesSpawned ?? 0;
  if (state.historicalEvents.eventId === "event:world_war" && machinesEncountered > 0) {
    const runWaveId = `${state.historicalEvents.seed}:W${battleWave}`;
    const previous = warMachineWaves.get(runWaveId);
    warMachineWaves.set(runWaveId, {
      runWaveId,
      wave: battleWave,
      encountered: Math.max(previous?.encountered ?? 0, machinesEncountered),
      defeated: Math.max(previous?.defeated ?? 0, state.battle?.warMachinesDefeated ?? 0),
    });
  }
  const runVictoryId = `run:${state.historicalEvents.seed}`;
  const firstObservationOfVictory = won && !victoryRunIds.has(runVictoryId);
  if (firstObservationOfVictory) {
    victoryRunIds.add(runVictoryId);
    const eventId = state.historicalEvents.eventId;
    const stanceId = state.historicalEvents.selectedStanceId;
    if (eventId && stanceId) completedCombinations.add(`${eventId}+${stanceId}`);
    if (stanceId) victoriesByStance[stanceId] = (victoriesByStance[stanceId] ?? 0) + 1;
  }
  const stats: ProfileStats = {
    ...profile.stats,
    highestWaveCleared,
    victories: Math.max(profile.stats.victories, victoryRunIds.size),
    maxGold: Math.max(profile.stats.maxGold, state.gold),
    maxLevel: Math.max(profile.stats.maxLevel, state.level),
    maxPopulation: Math.max(profile.stats.maxPopulation, fielded.length),
    maxFactionDiversity: Math.max(profile.stats.maxFactionDiversity, currentFactions.size),
    factionsFielded: [...factions],
    synergiesActivated: [...synergies],
    philosopherKingFielded: profile.stats.philosopherKingFielded || fielded.some((piece) => isThroneSlot(piece.slotId)),
  };
  const history: HistoricalProfile = { viewedEventIds: [...viewedEvents], chosenStanceIds: [...chosenStances], completedCombinationIds: [...completedCombinations], warMachineWaves: [...warMachineWaves.values()], victoryRunIds: [...victoryRunIds], victoriesByStance };
  return completeEligibleMissions({ ...profile, stats, history });
}

export const missionProgress = (profile: PlayerProfile, mission: MissionDefinition) => Math.min(mission.target, mission.progress(profile));
export const serializeProfile = (profile: PlayerProfile) => JSON.stringify(profile);
