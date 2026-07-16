/**
 * Data-only extension seams.  They deliberately have no runtime consumers yet:
 * equipment, drops and additional bosses remain outside the V0.2 battle loop.
 */
export type CombatStatKey = "damage" | "maxHp" | "armor" | "attackSpeed" | "maxEnergy";
export type EquipmentDefinition = {
  id: string;
  name: string;
  tags: string[];
  statModifiers?: Partial<Record<CombatStatKey, number>>;
  description: string;
};

export type BossModifier = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  numericParameters?: Record<string, number>;
};

export type WaveSpecialRule = {
  id: string;
  wave: number;
  bossModifierIds?: string[];
  tags: string[];
  description: string;
};

// Future content registers here after an explicit design pass. Empty registries
// guarantee this vertical slice does not silently activate equipment or additional bosses.
export const equipmentDefinitions: readonly EquipmentDefinition[] = [];
export const bossModifiers: readonly BossModifier[] = [];
export const waveSpecialRules: readonly WaveSpecialRule[] = [];
