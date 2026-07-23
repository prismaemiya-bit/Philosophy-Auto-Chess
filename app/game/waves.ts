import type { EnemyKind } from "./battle";

export const MAX_WAVES = 10;
export type WaveDefinition = {
  enemies: EnemyKind[];
  title: string;
  threatBudget: number;
  healthMultiplier: number;
  spawnInterval: number;
  boss?: boolean;
};
export type EncounterDefinition = WaveDefinition & {
  /** Stable content id: saved run seed + wave always resolves to the same id. */
  variantId: string;
  /** Rotates the A/B/C spawn order without changing the advertised lineup. */
  laneOffset: 0 | 1 | 2;
};
const group = (kind: EnemyKind, amount: number) => Array.from({ length: amount }, () => kind);

export const waveDefinitions: Record<number, WaveDefinition> = {
  1: { title: "第一波 · 接触校验", threatBudget: 6, healthMultiplier: 1, spawnInterval: 18, enemies: [...group("ordinary", 2)] },
  2: { title: "第二波 · 侧路试探", threatBudget: 12, healthMultiplier: 1.5, spawnInterval: 16, enemies: [...group("ordinary", 3), "swift", "swarm"] },
  3: { title: "第三波 · 重甲介入", threatBudget: 18, healthMultiplier: 1.95, spawnInterval: 14, enemies: [...group("ordinary", 4), "swift", "armored", "caster"] },
  4: { title: "第四波 · 三路施压", threatBudget: 25, healthMultiplier: 2.5, spawnInterval: 12, enemies: [...group("ordinary", 4), ...group("swift", 2), "swarm", "armored", "caster"] },
  5: { title: "第五波 · 洞穴之影", threatBudget: 36, healthMultiplier: 3.8, spawnInterval: 6, enemies: [...group("ordinary", 5), ...group("swift", 4), "swarm", "armored", "caster", "elite", "cave-boss"] },
  6: { title: "第六波 · 连续接触", threatBudget: 37, healthMultiplier: 3.75, spawnInterval: 11, enemies: [...group("ordinary", 5), ...group("swarm", 3), "caster", ...group("armored", 2)] },
  7: { title: "第七波 · 双重阻截", threatBudget: 48, healthMultiplier: 4.7, spawnInterval: 9, enemies: [...group("ordinary", 5), ...group("swift", 3), "swarm", ...group("armored", 2), ...group("caster", 2)] },
  8: { title: "第八波 · 精英复现", threatBudget: 57, healthMultiplier: 4.7, spawnInterval: 9, enemies: [...group("ordinary", 6), ...group("swift", 4), ...group("swarm", 2), ...group("elite", 2), "caster", "armored"] },
  9: { title: "第九波 · 全线逼近", threatBudget: 72, healthMultiplier: 6.2, spawnInterval: 8, enemies: [...group("ordinary", 6), ...group("swarm", 4), ...group("swift", 2), ...group("armored", 3), ...group("elite", 2), "caster"] },
  10: { title: "第十波 · 绝对精神", threatBudget: 86, healthMultiplier: 8, spawnInterval: 8, boss: true, enemies: ["boss"] },
};

export const waveDefinition = (wave: number) => waveDefinitions[wave] ?? waveDefinitions[MAX_WAVES];

type EncounterVariant = { id: string; title: string; enemies: EnemyKind[] };

const encounterVariants: Record<number, EncounterVariant[]> = {
  1: [{ id: "w1-foundation", title: waveDefinitions[1].title, enemies: waveDefinitions[1].enemies }],
  2: [
    { id: "w2-balanced", title: "第二波 · 侧路试探", enemies: waveDefinitions[2].enemies },
    { id: "w2-flux", title: "第二波 · 流变侧袭", enemies: [...group("ordinary", 2), ...group("swift", 2), "swarm"] },
  ],
  3: [
    { id: "w3-armor", title: "第三波 · 重甲介入", enemies: waveDefinitions[3].enemies },
    { id: "w3-doubt", title: "第三波 · 怀疑齐射", enemies: [...group("ordinary", 3), ...group("armored", 2), ...group("caster", 2)] },
  ],
  4: [
    { id: "w4-pressure", title: "第四波 · 三路施压", enemies: waveDefinitions[4].enemies },
    { id: "w4-opinion", title: "第四波 · 意见增殖", enemies: [...group("ordinary", 3), ...group("swift", 2), ...group("swarm", 2), "armored", "caster"] },
  ],
  5: [
    { id: "w5-cave", title: "第五波 · 洞穴之影", enemies: [...group("ordinary", 5), ...group("swift", 4), "swarm", "armored", "caster", "elite", "cave-boss"] },
    { id: "w5-skeptic", title: "第五波 · 怀疑深渊", enemies: [...group("ordinary", 5), ...group("swift", 4), "swarm", "armored", "caster", "elite", "skeptic-boss"] },
    { id: "w5-dialectic", title: "第五波 · 矛盾机枢", enemies: [...group("ordinary", 5), ...group("swift", 4), "swarm", "armored", "caster", "elite", "dialectic-boss"] },
  ],
  6: [
    { id: "w6-contact", title: "第六波 · 连续接触", enemies: waveDefinitions[6].enemies },
    { id: "w6-siege", title: "第六波 · 判断围城", enemies: [...group("ordinary", 4), ...group("swarm", 2), ...group("caster", 2), ...group("armored", 3)] },
  ],
  7: [
    { id: "w7-intercept", title: "第七波 · 双重阻截", enemies: waveDefinitions[7].enemies },
    { id: "w7-counterexample", title: "第七波 · 反例夹击", enemies: [...group("ordinary", 4), ...group("swift", 2), ...group("swarm", 2), ...group("armored", 3), ...group("caster", 2)] },
  ],
  8: [
    { id: "w8-elite", title: "第八波 · 诡辩复现", enemies: waveDefinitions[8].enemies },
    { id: "w8-hunt", title: "第八波 · 猎手合围", enemies: [...group("ordinary", 5), ...group("swift", 3), ...group("swarm", 3), ...group("elite", 2), ...group("caster", 2), "armored"] },
  ],
  9: [
    { id: "w9-total", title: "第九波 · 全线逼近", enemies: waveDefinitions[9].enemies },
    { id: "w9-antinomy", title: "第九波 · 二律背反", enemies: [...group("ordinary", 5), ...group("swarm", 3), ...group("swift", 3), ...group("armored", 3), ...group("elite", 2), ...group("caster", 2)] },
  ],
  10: [
    { id: "w10-absolute", title: "第十波 · 绝对精神", enemies: ["boss"] },
    { id: "w10-leviathan", title: "第十波 · 契约利维坦", enemies: ["leviathan-boss"] },
  ],
};

/** Pure, salted run roll. It does not consume the historical-event RNG cursor. */
export function encounterRoll(seed: number, wave: number) {
  let value = ((Number.isFinite(seed) ? Math.floor(seed) : 1) ^ Math.imul(Math.max(1, Math.floor(wave)), 0x9e3779b1) ^ 0x454e434f) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d); value ^= value >>> 15; value = Math.imul(value, 0x846ca68b); value ^= value >>> 16;
  return value >>> 0;
}

/** Resolves the exact lineup and route rotation used by forecast and combat. */
export function encounterDefinition(wave: number, seed: number): EncounterDefinition {
  const safeWave = Math.min(MAX_WAVES, Math.max(1, Math.floor(wave)));
  const baseline = waveDefinition(safeWave);
  const variants = encounterVariants[safeWave] ?? [{ id: `w${safeWave}-baseline`, title: baseline.title, enemies: baseline.enemies }];
  const roll = encounterRoll(seed, safeWave);
  const variant = variants[roll % variants.length];
  return {
    ...baseline,
    ...variant,
    enemies: [...variant.enemies],
    variantId: variant.id,
    // Keep the tutorial and final boss routes stable. Mid-run encounters may
    // rotate lanes, but a boss identity should not hide a large difficulty
    // swing behind a different path on the last wave.
    laneOffset: safeWave === 1 || safeWave === 10 ? 0 : ((roll >>> 8) % 3) as 0 | 1 | 2,
  };
}
