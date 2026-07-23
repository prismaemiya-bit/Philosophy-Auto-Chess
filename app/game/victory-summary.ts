import type { BalanceWaveReport } from "./engine";

export type VictoryUnitSummary = {
  characterId: string;
  damage: number;
  healing: number;
  shielding: number;
  damageTaken: number;
  blockedWeight: number;
};

export type VictoryRunSummary = {
  waves: number;
  totalIncome: number;
  interest: number;
  refreshes: number;
  xpPurchases: number;
  keyUnit?: VictoryUnitSummary;
  rankings: Record<"damage" | "damageTaken" | "healing" | "shielding", VictoryUnitSummary[]>;
};

export function summarizeVictoryRun(reports: readonly BalanceWaveReport[]): VictoryRunSummary {
  const units = new Map<string, VictoryUnitSummary>();
  for (const report of reports) {
    for (const unit of Object.values(report.units ?? {})) {
      if (!unit.characterId) continue;
      const previous = units.get(unit.characterId) ?? { characterId: unit.characterId, damage: 0, healing: 0, shielding: 0, damageTaken: 0, blockedWeight: 0 };
      units.set(unit.characterId, {
        characterId: unit.characterId,
        damage: previous.damage + unit.damage,
        healing: previous.healing + unit.healing,
        shielding: previous.shielding + unit.shielding,
        damageTaken: previous.damageTaken + unit.damageTaken,
        blockedWeight: previous.blockedWeight + unit.blockedWeight,
      });
    }
  }
  const contribution = (unit: VictoryUnitSummary) => unit.damage + unit.healing + unit.shielding + unit.damageTaken;
  const keyUnit = [...units.values()].sort((left, right) => contribution(right) - contribution(left) || right.blockedWeight - left.blockedWeight || left.characterId.localeCompare(right.characterId))[0];
  const ranking = (metric: "damage" | "damageTaken" | "healing" | "shielding") => [...units.values()]
    .filter((unit) => unit[metric] > 0)
    .sort((left, right) => right[metric] - left[metric] || left.characterId.localeCompare(right.characterId))
    .slice(0, 3);
  return {
    waves: reports.filter((report) => report.success).length,
    totalIncome: reports.reduce((sum, report) => sum + report.economy.totalIncome, 0),
    interest: reports.reduce((sum, report) => sum + report.economy.interest, 0),
    refreshes: reports.reduce((sum, report) => sum + report.economy.refreshes, 0),
    xpPurchases: reports.reduce((sum, report) => sum + report.economy.xpPurchases, 0),
    keyUnit,
    rankings: {
      damage: ranking("damage"),
      damageTaken: ranking("damageTaken"),
      healing: ranking("healing"),
      shielding: ranking("shielding"),
    },
  };
}
