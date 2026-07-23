export type UnlockKind = "character" | "map" | "boss";
export type UnlockId = `${UnlockKind}:${string}`;

export type UnlockableContentDefinition = {
  id: UnlockId;
  kind: UnlockKind;
  contentId: string;
};

/**
 * The shipped roster is baseline content, never progression-gated. Future
 * unlockable definitions must be registered here before a saved unlock ID can
 * make content available to a runtime pool.
 */
export const BASE_CHARACTER_IDS = [
  "socrates", "plato", "aristotle", "epicurus",
  "fichte", "husserl", "schelling", "heidegger", "kant", "hegel",
  "descartes", "rousseau", "sartre", "foucault", "althusser", "deleuze", "derrida", "lacan",
  "locke", "hume", "hobbes", "russell", "bacon", "bentham", "wittgenstein",
] as const;
const baseCharacterIds = new Set<string>(BASE_CHARACTER_IDS);

export const unlockableContentDefinitions: readonly UnlockableContentDefinition[] = [];
const unlockableById = new Map(unlockableContentDefinitions.map((definition) => [definition.id, definition]));

export const isUnlockId = (value: unknown): value is UnlockId =>
  typeof value === "string" && /^(character|map|boss):[a-z0-9][a-z0-9-]*$/.test(value);

export const isRegisteredUnlockId = (id: UnlockId) => unlockableById.has(id);

export function isContentAvailable(unlockedContentIds: readonly UnlockId[], kind: UnlockKind, contentId: string) {
  if (kind === "character" && baseCharacterIds.has(contentId)) return true;
  const unlockId = `${kind}:${contentId}` as UnlockId;
  const definition = unlockableById.get(unlockId);
  return Boolean(definition && definition.kind === kind && definition.contentId === contentId && unlockedContentIds.includes(unlockId));
}

export const isCharacterAvailable = (unlockedContentIds: readonly UnlockId[], characterId: string) =>
  isContentAvailable(unlockedContentIds, "character", characterId);

export const availableContentIds = (unlockedContentIds: readonly UnlockId[], kind: UnlockKind, candidateIds: readonly string[]) =>
  candidateIds.filter((contentId) => isContentAvailable(unlockedContentIds, kind, contentId));

export const availableShopCharacterIds = (unlockedContentIds: readonly UnlockId[], candidateIds: readonly string[]) =>
  availableContentIds(unlockedContentIds, "character", candidateIds);
