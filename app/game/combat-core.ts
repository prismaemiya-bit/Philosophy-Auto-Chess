import { characterById, type FactionId } from "./characters";
import type { Piece } from "./engine";
import type { Point } from "./positions";

export const FIXED_STEP_SECONDS = 0.24;
export type CombatPhase = "preparation" | "locked" | "combat" | "settlement";
export type SourceRouteId = "upper" | "lower" | "side";
export type RevolutionNodeId = "debate-plaza" | "side-gate" | "core-front";
export type ResearchChoice = "mechanics" | "medicine" | "political-arithmetic";
export type EnlightenmentAgenda = "market" | "education" | "citizen";
export type SmallSynergyId = "dialectic" | "contract" | "enlightenment" | "phenomenology" | "eudaimonia" | "logical-analysis";
/** Persistent choices are made only while the game is in preparation. */
export type PreparationPlan = {
  rostrumId?: string;
  revolutionNodeId?: RevolutionNodeId;
  pendingResearchChoices?: 0 | 1 | 2;
  pendingResearchSelections?: ResearchChoice[];
  activeResearches?: Array<{ choice: Exclude<ResearchChoice, "political-arithmetic">; wavesRemaining: number }>;
  politicalArithmeticClaimed?: boolean;
  researchAwardedWave?: number;
  enlightenmentAgendas?: EnlightenmentAgenda[];
  enlightenmentAppliedWave?: number;
};
export type EffectKind = "damage" | "heal" | "shield" | "energy" | "slow" | "silence" | "stun" | "pause" | "death" | "spawn" | "split";
export type TargetKind = "ally" | "enemy" | "core" | "position";

export type EffectProfile = {
  id: string;
  kind: EffectKind;
  sourceId?: string;
  targetId?: string;
  targetKind: TargetKind;
  amount?: number;
  duration?: number;
  potency?: number;
  position?: Point;
  radius?: number;
  executeAt?: number;
  derivedEffect?: boolean;
  copyable?: boolean;
  tags?: string[];
};

export type CombatEvent = EffectProfile & { sequence: number };

const priority: Record<EffectKind, number> = {
  pause: 10, stun: 11, silence: 12, slow: 13, shield: 20, energy: 21,
  heal: 30, damage: 31, death: 40, split: 50, spawn: 51,
};

/** Serializable, deterministic event queue. It never owns entity arrays. */
export class CombatEventQueue {
  private events: CombatEvent[];
  private sequence: number;

  constructor(events: CombatEvent[] = []) {
    this.events = events.filter((event) => Number.isFinite(event.executeAt ?? 0));
    this.sequence = this.events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
  }

  enqueue(profile: EffectProfile) {
    const amount = profile.amount;
    if (amount !== undefined && !Number.isFinite(amount)) return false;
    this.events.push({ ...profile, sequence: ++this.sequence });
    return true;
  }

  drainReady(gameTime: number) {
    const ready = this.events
      .filter((event) => (event.executeAt ?? gameTime) <= gameTime)
      .sort((a, b) => (a.executeAt ?? gameTime) - (b.executeAt ?? gameTime) || priority[a.kind] - priority[b.kind] || a.sequence - b.sequence);
    const readyIds = new Set(ready.map((event) => event.sequence));
    this.events = this.events.filter((event) => !readyIds.has(event.sequence));
    return ready;
  }

  snapshot() { return this.events.map((event) => ({ ...event })); }
}

export type StatusKind = "slow" | "silence" | "stun" | "pause" | "no-energy" | "no-shield" | "armor-break" | "control-immune" | "cave-immunity" | "control-resistance";
export type TimedStatus = {
  id: string;
  targetId: string;
  sourceId?: string;
  kind: StatusKind;
  startedAt: number;
  expiresAt: number;
  potency: number;
  derivedEffect?: boolean;
};

/** Game-time status registry. Strongest same-kind status wins. */
export class StatusManager {
  private statuses: TimedStatus[];
  constructor(statuses: TimedStatus[] = []) { this.statuses = statuses.filter((status) => status.expiresAt > status.startedAt); }

  expire(gameTime: number) { this.statuses = this.statuses.filter((status) => status.expiresAt > gameTime); }

  add(status: TimedStatus) {
    if (!Number.isFinite(status.expiresAt) || !Number.isFinite(status.potency) || status.expiresAt <= status.startedAt) return false;
    if (status.kind === "stun" || status.kind === "pause") {
      const resistance = this.statuses.find((existing) => existing.targetId === status.targetId && existing.kind === "control-resistance" && existing.expiresAt > status.startedAt);
      const applications = Math.min(3, Math.max(0, Math.floor(resistance?.potency ?? 0)));
      const durationMultiplier = [1, .7, .45, .25][applications] ?? .25;
      const duration = (status.expiresAt - status.startedAt) * durationMultiplier;
      status = { ...status, expiresAt: status.startedAt + duration };
      const resistanceStatus: TimedStatus = {
        id: `control-resistance-${status.targetId}`,
        targetId: status.targetId,
        kind: "control-resistance",
        startedAt: status.startedAt,
        expiresAt: status.startedAt + 6,
        potency: applications + 1,
      };
      const resistanceIndex = this.statuses.findIndex((existing) => existing.id === resistanceStatus.id);
      if (resistanceIndex < 0) this.statuses.push(resistanceStatus);
      else this.statuses[resistanceIndex] = resistanceStatus;
    }
    const index = this.statuses.findIndex((existing) => existing.id === status.id);
    if (index < 0) this.statuses.push(status);
    else {
      const existing = this.statuses[index];
      this.statuses[index] = {
        ...existing,
        sourceId: status.sourceId ?? existing.sourceId,
        potency: Math.max(existing.potency, status.potency),
        expiresAt: Math.max(existing.expiresAt, status.expiresAt),
        derivedEffect: existing.derivedEffect && status.derivedEffect,
      };
    }
    return true;
  }

  has(targetId: string, kind: StatusKind, gameTime: number) { return this.statuses.some((status) => status.targetId === targetId && status.kind === kind && status.expiresAt > gameTime); }
  potency(targetId: string, kind: StatusKind, gameTime: number) { return this.statuses.filter((status) => status.targetId === targetId && status.kind === kind && status.expiresAt > gameTime).reduce((maximum, status) => Math.max(maximum, status.potency), 0); }
  clearHardControl(targetId: string) { this.statuses = this.statuses.filter((status) => status.targetId !== targetId || (status.kind !== "stun" && status.kind !== "pause")); }
  removeTarget(targetId: string) { this.statuses = this.statuses.filter((status) => status.targetId !== targetId); }
  snapshot() { return this.statuses.map((status) => ({ ...status })); }
}

export type TraitSnapshot = {
  version: 4;
  lockedAt: number;
  unitIds: string[];
  factionCounts: Record<FactionId, number>;
  factionTiers: Record<FactionId, 0 | 2 | 4 | 6>;
  rostrumId?: string;
  philosopherKingId?: string;
  revolutionNodeId: RevolutionNodeId;
  preparationPlan: Readonly<PreparationPlan>;
  dialecticCount: number;
  smallSynergyTiers: Record<SmallSynergyId, 0 | 2 | 3 | 4>;
};

const tier = <T extends readonly number[]>(count: number, thresholds: T): T[number] | 0 => {
  const active = thresholds.filter((threshold) => count >= threshold).at(-1) ?? 0;
  return active as T[number] | 0;
};

export function createTraitSnapshot(
  pieces: Piece[],
  options: PreparationPlan = {},
): TraitSnapshot {
  const deployed = pieces.filter((piece) => (piece.slotId.startsWith("deploy-") || piece.slotId === "throne-1") && characterById[piece.characterId]);
  const deployedCharacterIds = new Set(deployed.map((piece) => piece.characterId));
  const philosopherKingUnlocked = deployed.some((piece) => piece.characterId === "plato" && piece.star >= 2);
  const factionCounts: Record<FactionId, number> = { greece: 0, germany: 0, france: 0, britain: 0 };
  deployedCharacterIds.forEach((characterId) => { factionCounts[characterById[characterId].faction] += 1; });
  const greekUnits = deployed.filter((piece) => characterById[piece.characterId].faction === "greece");
  const automaticRostrum = [...greekUnits].sort((a, b) => b.star - a.star || characterById[b.characterId].cost - characterById[a.characterId].cost || a.id.localeCompare(b.id))[0]?.id;
  const requestedRostrum = options.rostrumId && greekUnits.some((piece) => piece.id === options.rostrumId) ? options.rostrumId : undefined;
  const countIds = (ids: string[]) => ids.filter((id) => deployedCharacterIds.has(id)).length;
  const smallSynergyTiers: TraitSnapshot["smallSynergyTiers"] = {
    dialectic: tier(countIds(["socrates", "plato", "fichte", "hegel"]), [2, 3, 4] as const),
    contract: tier(countIds(["rousseau", "locke", "hobbes"]), [2, 3] as const),
    enlightenment: tier(countIds(["rousseau", "locke", "hume", "kant"]), [3, 4] as const),
    phenomenology: tier(countIds(["husserl", "heidegger", "sartre"]), [2, 3] as const),
    eudaimonia: tier(countIds(["epicurus", "bentham"]), [2] as const),
    "logical-analysis": tier(countIds(["aristotle", "russell", "wittgenstein"]), [2, 3] as const),
  };
  return {
    version: 4,
    lockedAt: 0,
    unitIds: deployed.map((piece) => piece.id),
    factionCounts,
    factionTiers: {
      greece: tier(factionCounts.greece, [2, 4] as const),
      germany: tier(factionCounts.germany, [2, 4, 6] as const),
      france: tier(factionCounts.france, [2, 4, 6] as const),
      britain: tier(factionCounts.britain, [2, 4, 6] as const),
    },
    rostrumId: factionCounts.greece >= 2 ? requestedRostrum ?? automaticRostrum : undefined,
    philosopherKingId: philosopherKingUnlocked ? deployed.find((piece) => piece.slotId === "throne-1")?.id : undefined,
    revolutionNodeId: options.revolutionNodeId ?? "debate-plaza",
    preparationPlan: {
      rostrumId: factionCounts.greece >= 2 ? requestedRostrum ?? automaticRostrum : undefined,
      revolutionNodeId: options.revolutionNodeId ?? "debate-plaza",
      pendingResearchChoices: options.pendingResearchChoices ?? 0,
      pendingResearchSelections: [...new Set(options.pendingResearchSelections ?? [])],
      activeResearches: (options.activeResearches ?? []).map((research) => ({ ...research })),
      politicalArithmeticClaimed: options.politicalArithmeticClaimed === true,
      researchAwardedWave: options.researchAwardedWave,
      enlightenmentAgendas: [...new Set(options.enlightenmentAgendas ?? [])].filter((agenda): agenda is EnlightenmentAgenda => ["market", "education", "citizen"].includes(agenda)),
      enlightenmentAppliedWave: options.enlightenmentAppliedWave,
    },
    dialecticCount: countIds(["socrates", "plato", "fichte", "hegel"]),
    smallSynergyTiers,
  };
}

export const isDerived = (effect: Pick<EffectProfile, "derivedEffect">) => effect.derivedEffect === true;
export const canGenerateMechanic = (effect: Pick<EffectProfile, "derivedEffect">) => !isDerived(effect);
export const finiteNonNegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
