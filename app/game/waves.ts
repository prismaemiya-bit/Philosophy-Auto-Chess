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
const group = (kind: EnemyKind, amount: number) => Array.from({ length: amount }, () => kind);

export const waveDefinitions: Record<number, WaveDefinition> = {
  1: { title: "第一波 · 接触校验", threatBudget: 6, healthMultiplier: 1, spawnInterval: 18, enemies: [...group("ordinary", 2)] },
  2: { title: "第二波 · 侧路试探", threatBudget: 12, healthMultiplier: 1.5, spawnInterval: 16, enemies: [...group("ordinary", 3), "swift", "swarm"] },
  3: { title: "第三波 · 重甲介入", threatBudget: 18, healthMultiplier: 1.95, spawnInterval: 14, enemies: [...group("ordinary", 4), "swift", "armored", "caster"] },
  4: { title: "第四波 · 三路施压", threatBudget: 25, healthMultiplier: 2.5, spawnInterval: 12, enemies: [...group("ordinary", 4), ...group("swift", 2), "swarm", "armored", "caster"] },
  5: { title: "第五波 · 洞穴之影", threatBudget: 32, healthMultiplier: 3.4, spawnInterval: 10, enemies: [...group("ordinary", 4), ...group("swift", 2), "armored", "caster", "cave-boss"] },
  6: { title: "第六波 · 连续接触", threatBudget: 36, healthMultiplier: 3.8, spawnInterval: 11, enemies: [...group("ordinary", 5), ...group("swarm", 3), "caster", ...group("armored", 2)] },
  7: { title: "第七波 · 双重阻截", threatBudget: 52, healthMultiplier: 5.2, spawnInterval: 9, enemies: [...group("ordinary", 5), ...group("swift", 3), "swarm", ...group("armored", 2), ...group("caster", 2)] },
  8: { title: "第八波 · 精英复现", threatBudget: 64, healthMultiplier: 6.2, spawnInterval: 9, enemies: [...group("ordinary", 6), ...group("swift", 4), ...group("swarm", 2), ...group("elite", 2), "caster", "armored"] },
  9: { title: "第九波 · 全线逼近", threatBudget: 72, healthMultiplier: 7, spawnInterval: 8, enemies: [...group("ordinary", 6), ...group("swarm", 4), ...group("swift", 2), ...group("armored", 3), ...group("elite", 2), "caster"] },
  10: { title: "第十波 · 绝对精神", threatBudget: 90, healthMultiplier: 8.5, spawnInterval: 8, boss: true, enemies: ["boss"] },
};

export const waveDefinition = (wave: number) => waveDefinitions[wave] ?? waveDefinitions[MAX_WAVES];
