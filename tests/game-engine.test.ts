import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { characterById, characters } from "../app/game/characters.ts";
import { CAVE_SHADOW_PHASE, DOGMA_COLOSSUS_PHASES, advanceBattle, battleOf, effectiveAttackRange, enemyTemplates, resolveBlocking, restartCurrentWave, retryWave, startWave, type BattleState } from "../app/game/battle.ts";
import { THRONE_SLOT, buy, chooseEnlightenmentAgendas, chooseResearch, ECONOMY_RULES, gainXp, makeInitialState, maxDeployForLevel, migrateState, move, normalizeProgress, pickShop, refresh, saleRefund, sell, serializeGameState, settlementIncome, shopOddsForLevel, updatePreparationPlan, type GameState } from "../app/game/engine.ts";
import { deploymentPoint, deploymentSlots, distance, distanceToRoute, MAP_ART_SAFE_ZONES, MAP_FOOTPRINTS, MAP_HEIGHT, MAP_LAYOUT_FINGERPRINT, MAP_LAYOUT_VERSION, MAP_PLATFORM_PATHS, MAP_ROAD_WIDTHS, MAP_WIDTH, ROYAL_BARRIER_POINT, revolutionNodePoint, revolutionNodes, routeDefinitions, routePoint, slotTerrain } from "../app/game/positions.ts";
import { waveDefinition } from "../app/game/waves.ts";
import { CombatEventQueue, StatusManager, createTraitSnapshot } from "../app/game/combat-core.ts";
import { bossModifiers, equipmentDefinitions, waveSpecialRules, type BossModifier, type EquipmentDefinition, type WaveSpecialRule } from "../app/game/future-config.ts";
import { characterAssets, characterTraits, skillDetails } from "../app/game/assets.ts";

const running = (enemies: BattleState["enemies"]): BattleState => ({ status: "running", tick: 0, spawnRemaining: [], enemies, kills: 0, goldEarned: 0, coreDamage: 0, cooldowns: {}, enemyCooldowns: {}, effects: [], lastEvent: "test", factionCasts: [], greekCastCount: 0, concepts: 0, germanCastIds: [], absoluteUsed: false, frenchArguments: 0, britishEvidence: 0 });
const enemy = (id: string, kind: keyof typeof enemyTemplates, lane: "upper" | "lower" | "side" = "upper", progress = .22) => ({ id, kind, hp: 900, maxHp: 900, progress, lane, weight: enemyTemplates[kind].weight });
const progressNear = (slotId: string, lane: "upper" | "lower" | "side" = "upper") => Array.from({ length: 1001 }, (_, index) => index / 1000).sort((left, right) => distance(deploymentPoint(slotId), routePoint(left, lane)) - distance(deploymentPoint(slotId), routePoint(right, lane)))[0];

test("V0.1 starts at 8 gold with the eight-population progression table and costs", () => {
  assert.equal(makeInitialState().gold, 8);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(maxDeployForLevel), [2, 3, 4, 5, 6, 7, 8, 8]);
  assert.equal(characterById.socrates.cost, 1); assert.equal(characterById.epicurus.cost, 1); assert.equal(characterById.fichte.cost, 1);
  assert.equal(characterById.plato.cost, 2); assert.equal(characterById.aristotle.cost, 2); assert.equal(characterById.husserl.cost, 2);
  assert.equal(characterById.schelling.cost, 3); assert.equal(characterById.heidegger.cost, 3); assert.equal(characterById.kant.cost, 4); assert.equal(characterById.hegel.cost, 4);
});

test("all 25 philosophers have complete presentation metadata", () => {
  for (const character of characters) {
    assert.ok(characterAssets[character.id]?.glyph, `${character.id} is missing a piece glyph`);
    assert.ok(characterAssets[character.id]?.accent, `${character.id} is missing a piece accent`);
    assert.ok(characterTraits[character.id]?.includes(character.factionLabel), `${character.id} is missing its faction trait label`);
    assert.ok(skillDetails[character.id], `${character.id} is missing inspector skill text`);
  }
});

test("shop odds are visible-ready percentages for every level", () => {
  for (let level = 1; level <= 8; level += 1) assert.equal(shopOddsForLevel(level).reduce((sum, value) => sum + value, 0), 100);
  assert.deepEqual(shopOddsForLevel(1), [72, 25, 3, 0]); assert.deepEqual(shopOddsForLevel(8), [2, 12, 38, 48]);
});

test("future equipment and additional boss configuration seams are data-only and inactive", () => {
  const equipment: EquipmentDefinition = { id: "reserved-item", name: "预留装备", tags: ["reserved"], description: "尚未开放", statModifiers: { damage: 1 } };
  const modifier: BossModifier = { id: "reserved-boss", name: "预留首领", tags: ["reserved"], description: "尚未开放", numericParameters: { multiplier: 1 } };
  const rule: WaveSpecialRule = { id: "reserved-wave", wave: 11, bossModifierIds: [modifier.id], tags: ["reserved"], description: "尚未开放" };
  assert.equal(equipmentDefinitions.length + bossModifiers.length + waveSpecialRules.length, 0); assert.equal(rule.bossModifierIds?.[0], modifier.id); assert.equal(equipment.statModifiers?.damage, 1);
});

test("the frozen vertical-slice roster uses the final costs", () => {
  for (const id of ["descartes", "rousseau", "sartre", "foucault", "locke", "hume", "hobbes", "russell", "althusser"]) assert.ok(characterById[id]);
  assert.deepEqual([characterById.descartes.cost, characterById.rousseau.cost, characterById.sartre.cost, characterById.foucault.cost], [1, 1, 2, 2]);
  assert.deepEqual([characterById.locke.cost, characterById.hume.cost, characterById.hobbes.cost, characterById.russell.cost], [1, 2, 3, 3]);
  assert.equal(characterById.althusser.cost, 4); assert.equal(characterById.foucault.faction, "france"); assert.equal(characterById.russell.faction, "britain");
});

test("every new wave and every successful settlement restore surviving units to full HP", () => {
  const prepared: GameState = { ...makeInitialState(), pieces: [{ id: "heal-check", characterId: "fichte", star: 1, slotId: "deploy-1", hp: 9, maxHp: 840 }] };
  const begun = startWave(prepared); assert.equal(begun.state.pieces[0]?.hp, 840);
  const settlement: GameState = { ...begun.state, battle: running([]), pieces: [{ ...begun.state.pieces[0]!, hp: 111, maxHp: 840 }] };
  const settled = advanceBattle(settlement); assert.equal(settled.battle?.status, "victory"); assert.equal(settled.pieces[0]?.hp, 840);
});

test("combat energy cannot be banked between waves", () => {
  const previous = { ...makeInitialState(), wave: 2, pieces: [{ id: "fichte", characterId: "fichte", star: 1 as const, slotId: "deploy-1" as const, energy: 65, maxEnergy: 65 }], battle: { ...battleOf(makeInitialState()), status: "victory" as const } };
  const begun = startWave(previous);
  assert.equal(begun.ok, true);
  assert.equal(begun.state.pieces[0]?.energy, 0);
});

test("healers cast a meaningful heal on the lowest-health deployed ally", () => {
  const state: GameState = { ...makeInitialState(), pieces: [
    { id: "front", characterId: "fichte", star: 1, slotId: "deploy-1", hp: 260, maxHp: 840 },
    { id: "healer", characterId: "epicurus", star: 1, slotId: "deploy-3", hp: 570, maxHp: 570, energy: 70, maxEnergy: 70 },
  ], battle: running([enemy("pressure", "ordinary", "upper", .25)]) };
  const next = advanceBattle(state); const front = next.pieces.find((piece) => piece.id === "front");
  assert.ok((front?.hp ?? 0) >= 430); assert.ok(next.battle?.effects.some((effect) => effect.type === "heal"));
});

test("French heat and British global evidence trigger their 2-unit faction effects", () => {
  const french: GameState = { ...makeInitialState(), level: 2, pieces: [
    { id: "d", characterId: "descartes", star: 1, slotId: "deploy-13", hp: 455, maxHp: 455, energy: 65, maxEnergy: 65 },
    { id: "r", characterId: "rousseau", star: 1, slotId: "deploy-1", hp: 700, maxHp: 700, energy: 72, maxEnergy: 72 },
  ], battle: { ...running([enemy("target", "ordinary", "upper", .25)]), frenchArguments: 3, frenchHeat: 6 } };
  const frenchNext = advanceBattle(french); assert.ok(frenchNext.battle?.effects.some((effect) => effect.id.startsWith("revolution-"))); assert.ok((frenchNext.battle?.frenchHeat ?? 0) < 8);
  const british: GameState = { ...makeInitialState(), level: 2, pieces: [
    { id: "h", characterId: "hume", star: 1, slotId: "deploy-13", hp: 455, maxHp: 455 },
    { id: "r", characterId: "russell", star: 1, slotId: "deploy-14", hp: 575, maxHp: 575 },
  ], battle: running([{ ...enemy("target", "ordinary", "upper", .25), sourceRouteId: "upper", evidence: { count: 5, lastHitBySource: {} } }]) };
  const britishNext = advanceBattle(british); assert.ok(britishNext.battle?.effects.some((effect) => effect.id.startsWith("evidence-"))); assert.ok(britishNext.battle?.statuses?.some((status) => status.targetId === "target" && status.kind === "no-shield"));
});

test("experience is always normalized within the active level threshold", () => {
  assert.deepEqual(normalizeProgress(8, 48), { level: 8, xp: 47 });
  assert.deepEqual(normalizeProgress(7, 48), { level: 8, xp: 0 });
  const legacy = migrateState({ level: 6, xp: 32 }); assert.deepEqual({ level: legacy.level, xp: legacy.xp }, { level: 7, xp: 0 });
  assert.equal(gainXp({ ...makeInitialState(), level: 8, xp: 27 }).ok, false);
});

test("shop, refresh, sale, XP and three-of-a-kind retain the economy rules", () => {
  const openingState = makeInitialState(() => 0); const openingCost = characterById[openingState.shop[0]!].cost;
  const bought = buy(openingState, 0); assert.equal(bought.ok, true); assert.equal(bought.state.gold, 8 - openingCost); assert.equal(bought.state.shop[0], null);
  const refreshed = refresh(makeInitialState()); assert.equal(refreshed.state.gold, 6); assert.equal(refreshed.state.shop.length, 5);
  const sold = sell({ ...makeInitialState(), gold: 0, pieces: [{ id: "sell", characterId: "hegel", star: 2, slotId: "bench-1" }] }, "sell"); assert.equal(sold.state.gold, 11);
  assert.deepEqual([saleRefund(1, 1), saleRefund(1, 2), saleRefund(1, 3)], [1, 2, 7]);
  let opening = makeInitialState(); opening = buy(opening, 0).state; opening = buy(opening, 1).state;
  const lockedExperience = gainXp(opening); assert.equal(lockedExperience.ok, false); assert.equal(lockedExperience.state.level, 1); assert.equal(lockedExperience.state.gold, opening.gold);
  const upgraded = gainXp({ ...makeInitialState(), wave: 2 }).state; assert.equal(upgraded.gold, 4); assert.equal(upgraded.level, 2);
  let merged = makeInitialState(); merged.shop = ["fichte", "fichte", "fichte", "socrates", "epicurus"]; merged = buy(merged, 0).state; merged = buy(merged, 1).state; merged = buy(merged, 2).state; assert.equal(merged.pieces[0]?.star, 2);
  let soldOut = { ...makeInitialState(), gold: ECONOMY_RULES.goldCap }; for (let index = 0; index < 5; index += 1) soldOut = buy(soldOut, index).state; assert.ok(soldOut.shop.every((id) => id === null));
  soldOut = { ...soldOut, gold: ECONOMY_RULES.refreshCost };
  const restocked = refresh(soldOut); assert.equal(restocked.ok, true); assert.ok(restocked.state.shop.every((id) => id !== null));
});

test("a new run rolls its opening shop from the level-one probability table", () => {
  const lowRoll = makeInitialState(() => 0);
  const highRoll = makeInitialState(() => .8);
  assert.notDeepEqual(lowRoll.shop, highRoll.shop);
  for (const id of [...lowRoll.shop, ...highRoll.shop]) {
    assert.ok(id);
    assert.ok(characterById[id].cost <= 3, "level one must never roll a four-cost philosopher");
  }
});

test("the centralized economy keeps income, interest, refresh and experience rules bounded", () => {
  assert.deepEqual(settlementIncome(0, true), { baseIncome: 10, interest: 0, perfectBonus: 1 });
  assert.deepEqual(settlementIncome(999, false), { baseIncome: 10, interest: 3, perfectBonus: 0 });
  assert.equal(ECONOMY_RULES.refreshCost, 2); assert.equal(ECONOMY_RULES.experienceCost, 4); assert.equal(ECONOMY_RULES.experienceAmount, 4);
  assert.equal(ECONOMY_RULES.automaticWaveExperience, 4); assert.equal(ECONOMY_RULES.baseIncome, 10);
  assert.equal(ECONOMY_RULES.goldCap, 30); assert.equal(ECONOMY_RULES.interestStep, 5); assert.equal(ECONOMY_RULES.maxInterest, 3);
});

test("unitId and tileId workflow preserves every piece across purchase, deployment, exchange, return, sale and merge", () => {
  const initial = makeInitialState(() => 0);
  const purchased = buy(initial, 0); const fichte = purchased.state.pieces[0];
  assert.equal(purchased.ok, true); assert.equal(fichte?.slotId, "bench-1"); assert.notEqual(purchased.state.shop[0], initial.shop[0]);

  const deployed = move(purchased.state, fichte!.id, "deploy-1");
  assert.equal(deployed.ok, true); assert.equal(deployed.state.pieces[0]?.slotId, "deploy-1");
  const relocated = move(deployed.state, fichte!.id, "deploy-2");
  assert.equal(relocated.ok, true); assert.equal(relocated.state.pieces[0]?.slotId, "deploy-2");
  const returned = move(relocated.state, fichte!.id, "bench-1");
  assert.equal(returned.ok, true); assert.equal(returned.state.pieces[0]?.slotId, "bench-1");
  const goldBeforeSale = returned.state.gold; const sold = sell(returned.state, fichte!.id);
  assert.equal(sold.ok, true); assert.equal(sold.state.gold, goldBeforeSale + 1); assert.equal(sold.state.pieces.length, 0);

  const exchangeState: GameState = { ...makeInitialState(), pieces: [
    { id: "f", characterId: "fichte", star: 1, slotId: "deploy-1" },
    { id: "s", characterId: "socrates", star: 1, slotId: "deploy-2" },
  ] };
  const exchanged = move(exchangeState, "f", "deploy-2");
  assert.equal(exchanged.ok, true); assert.equal(exchanged.state.pieces.find((piece) => piece.id === "f")?.slotId, "deploy-2");
  assert.equal(exchanged.state.pieces.find((piece) => piece.id === "s")?.slotId, "deploy-1");

  const fullBench: GameState = { ...makeInitialState(), gold: 50, pieces: Array.from({ length: 9 }, (_, index) => ({ id: `bench-${index}`, characterId: "fichte", star: 1 as const, slotId: `bench-${index + 1}` as GameState["pieces"][number]["slotId"] })) };
  const fullPurchase = buy(fullBench, 0); assert.equal(fullPurchase.ok, false); assert.deepEqual(fullPurchase.state, fullBench);

  const populationFull: GameState = { ...makeInitialState(), pieces: [
    { id: "front", characterId: "fichte", star: 1, slotId: "deploy-1" }, { id: "other", characterId: "socrates", star: 1, slotId: "deploy-2" },
    { id: "reserve", characterId: "epicurus", star: 1, slotId: "bench-1" },
  ] };
  const populationBlocked = move(populationFull, "reserve", "deploy-3"); assert.equal(populationBlocked.ok, false); assert.deepEqual(populationBlocked.state, populationFull);
  const terrainBlocked = move(populationFull, "front", "deploy-13"); assert.equal(terrainBlocked.ok, false); assert.deepEqual(terrainBlocked.state, populationFull);

  const locked = { ...populationFull, battle: running([]) };
  assert.equal(move(locked, "front", "bench-2").ok, false);
  assert.equal(move(locked, "reserve", "bench-2").ok, false);
  assert.equal(sell(locked, "front").ok, false); assert.equal(buy(locked, 0).ok, false);
  assert.equal(refresh(locked).ok, false); assert.equal(gainXp(locked).ok, false);

  let mergeState: GameState = { ...makeInitialState(), shop: ["fichte", "fichte", "fichte", "socrates", "epicurus"] };
  mergeState = buy(mergeState, 0).state; mergeState = buy(mergeState, 1).state; mergeState = buy(mergeState, 2).state;
  const twoStar = mergeState.pieces.find((piece) => piece.characterId === "fichte"); assert.equal(twoStar?.star, 2);
  const mergedDeployed = move(mergeState, twoStar!.id, "deploy-1"); assert.equal(mergedDeployed.ok, true);
  const mergedReturned = move(mergedDeployed.state, twoStar!.id, "bench-1"); assert.equal(mergedReturned.ok, true);
  const mergedSold = sell(mergedReturned.state, twoStar!.id); assert.equal(mergedSold.ok, true); assert.equal(mergedSold.state.gold, 7);
});

test("three-of-a-kind upgrades the deployed copy instead of consuming it for a bench copy", () => {
  const state: GameState = { ...makeInitialState(), gold: 8, shop: ["fichte", null, null, null, null], pieces: [
    { id: "field-copy", characterId: "fichte", star: 1, slotId: "deploy-1" },
    { id: "bench-copy", characterId: "fichte", star: 1, slotId: "bench-1" },
  ] };
  const result = buy(state, 0);
  const copies = result.state.pieces.filter((piece) => piece.characterId === "fichte");
  assert.equal(result.ok, true); assert.equal(copies.length, 1); assert.equal(copies[0]?.id, "field-copy"); assert.equal(copies[0]?.slotId, "deploy-1"); assert.equal(copies[0]?.star, 2);
});

test("an engaged enemy remains latched until its blocker dies and cannot be evicted by a later threat", () => {
  const blocker = { id: "hard-blocker", characterId: "fichte", star: 1 as const, slotId: "deploy-1" as const, hp: 840 };
  const near = progressNear("deploy-1");
  const first = resolveBlocking([{ ...enemy("latched", "armored", "upper", near), blockedBy: "hard-blocker" }], [blocker], [], 0);
  const contested = resolveBlocking([...first, enemy("late", "ordinary", "upper", Math.min(.99, near + .002))], [blocker], [], .24);
  assert.equal(contested.find((unit) => unit.id === "latched")?.blockedBy, "hard-blocker");
  assert.equal(contested.find((unit) => unit.id === "late")?.blockedBy, undefined);
  const released = resolveBlocking(contested, [{ ...blocker, hp: 0 }], [], .48);
  assert.ok(released.every((unit) => unit.blockedBy === undefined));
});

test("Philosopher King throne is a stable one-population choice and closes safely with Plato", () => {
  const withoutPlato: GameState = { ...makeInitialState(), level: 2, pieces: [{ id: "front", characterId: "fichte", star: 1, slotId: "deploy-1" }] };
  assert.equal(move(withoutPlato, "front", THRONE_SLOT).ok, false);
  const oneStarPlato: GameState = { ...withoutPlato, pieces: [...withoutPlato.pieces, { id: "plato-one", characterId: "plato", star: 1, slotId: "deploy-3" }] };
  assert.equal(move(oneStarPlato, "front", THRONE_SLOT).ok, false, "one-star Plato must not unlock the throne");
  const prepared: GameState = { ...makeInitialState(), level: 2, pieces: [
    { id: "plato", characterId: "plato", star: 2, slotId: "deploy-1" },
    { id: "king", characterId: "fichte", star: 1, slotId: "deploy-3" },
  ] };
  const appointed = move(prepared, "king", THRONE_SLOT); assert.equal(appointed.ok, true);
  assert.equal(appointed.state.pieces.filter((piece) => piece.slotId.startsWith("deploy-") || piece.slotId === THRONE_SLOT).length, 2);
  assert.equal(appointed.state.pieces.find((piece) => piece.id === "king")?.throneReturnSlot, "deploy-3");
  assert.equal(createTraitSnapshot(appointed.state.pieces).philosopherKingId, "king");
  const restored = migrateState(JSON.parse(serializeGameState(appointed.state)));
  assert.equal(restored.pieces.find((piece) => piece.id === "king")?.slotId, THRONE_SLOT);
  const oldOneStarChoice = migrateState({ ...JSON.parse(serializeGameState(appointed.state)), pieces: JSON.parse(serializeGameState(appointed.state)).pieces.map((piece: { characterId: string; star: number }) => piece.characterId === "plato" ? { ...piece, star: 1 } : piece) });
  assert.notEqual(oldOneStarChoice.pieces.find((piece) => piece.id === "king")?.slotId, THRONE_SLOT, "an old one-star unlock must migrate without trapping the king");
  const closed = sell(restored, "plato"); assert.equal(closed.ok, true); assert.ok(closed.state.pieces.every((piece) => piece.slotId !== THRONE_SLOT)); assert.equal(closed.state.pieces[0]?.slotId, "bench-1");
});

test("Philosopher King range, one-time 10 percent output and royal barrier formulas are bounded", () => {
  const prepared: GameState = { ...makeInitialState(), level: 2, pieces: [
    { id: "plato", characterId: "plato", star: 2, slotId: "deploy-1" },
    { id: "king", characterId: "fichte", star: 1, slotId: THRONE_SLOT, throneReturnSlot: "deploy-3" },
  ] };
  const begun = startWave(prepared); assert.equal(begun.ok, true); assert.equal(effectiveAttackRange(begun.state.pieces.find((piece) => piece.id === "king")!), 22);
  const barrier = begun.state.battle?.structures?.find((structure) => structure.kind === "royal-barrier");
  assert.equal(barrier?.capacity, 3); assert.equal(barrier?.maxHp, 504); assert.equal(barrier?.hp, 504); assert.equal(barrier?.defense, 24); assert.equal(barrier?.sourceId, "king");
  const target = { ...enemy("king-target", "ordinary", "upper", .9), hp: 900, maxHp: 900 };
  const withHit: GameState = { ...begun.state, battle: { ...begun.state.battle!, enemies: [target], spawnRemaining: ["ordinary"], cooldowns: { king: 99, plato: 99 }, eventQueue: [{ id: "king-hit", kind: "damage", sourceId: "king", targetKind: "enemy", targetId: target.id, amount: 100, sequence: 1 }] } };
  const hit = advanceBattle(withHit); assert.equal(hit.battle?.enemies.find((unit) => unit.id === target.id)?.hp, 790);
  const derived: GameState = { ...begun.state, battle: { ...begun.state.battle!, enemies: [target], spawnRemaining: ["ordinary"], cooldowns: { king: 99, plato: 99 }, eventQueue: [{ id: "king-derived", kind: "damage", sourceId: "king", targetKind: "enemy", targetId: target.id, amount: 100, derivedEffect: true, sequence: 1 }] } };
  assert.equal(advanceBattle(derived).battle?.enemies.find((unit) => unit.id === target.id)?.hp, 800);
  const supportOutput: GameState = { ...begun.state, pieces: begun.state.pieces.map((piece) => piece.id === "king" ? { ...piece, hp: 500, shield: 0 } : piece), battle: { ...begun.state.battle!, enemies: [target], spawnRemaining: ["ordinary"], cooldowns: { king: 99, plato: 99 }, eventQueue: [{ id: "king-heal", kind: "heal", sourceId: "king", targetKind: "ally", targetId: "king", amount: 100, sequence: 1 }, { id: "king-shield", kind: "shield", sourceId: "king", targetKind: "ally", targetId: "king", amount: 100, sequence: 2 }] } };
  const supported = advanceBattle(supportOutput).pieces.find((piece) => piece.id === "king"); assert.ok(Math.abs((supported?.hp ?? 0) - 610) < .0001); assert.ok(Math.abs((supported?.shield ?? 0) - 110) < .0001);
  const rangedProgress = .85; assert.ok(distance(deploymentPoint(THRONE_SLOT), routePoint(rangedProgress, "upper")) > effectiveAttackRange({ ...prepared.pieces[1]!, slotId: "deploy-3" }));
  const rangedTarget = { ...enemy("ranged-target", "ordinary", "upper", rangedProgress), hp: 900, maxHp: 900 };
  const ranged = advanceBattle({ ...begun.state, battle: { ...begun.state.battle!, enemies: [rangedTarget], spawnRemaining: ["ordinary"], cooldowns: { king: 0, plato: 99 }, eventQueue: [] } });
  assert.ok((ranged.battle?.enemies.find((unit) => unit.id === rangedTarget.id)?.hp ?? 900) < 900, "a ground philosopher king must perform a real ranged normal attack");
});

test("royal barrier uses hard capacity, takes contact damage, never emits resources and rebuilds only next wave", () => {
  const prepared: GameState = { ...makeInitialState(), level: 2, pieces: [
    { id: "plato", characterId: "plato", star: 2, slotId: "deploy-1" },
    { id: "king", characterId: "fichte", star: 1, slotId: THRONE_SLOT, throneReturnSlot: "deploy-3" },
  ] };
  const begun = startWave(prepared).state; const barrier = begun.battle!.structures!.find((structure) => structure.kind === "royal-barrier")!;
  const near = Array.from({ length: 1001 }, (_, index) => index / 1000).sort((a, b) => distance(ROYAL_BARRIER_POINT, routePoint(a, "upper")) - distance(ROYAL_BARRIER_POINT, routePoint(b, "upper")))[0]!;
  const blocked = resolveBlocking([enemy("boss", "boss", "upper", near), enemy("overflow", "ordinary", "upper", near)], begun.pieces, [barrier], 0);
  assert.equal(blocked.find((unit) => unit.id === "boss")?.blockedBy, `structure:${barrier.id}`); assert.equal(blocked.find((unit) => unit.id === "overflow")?.blockedBy, undefined);
  let current: GameState = { ...begun, battle: { ...begun.battle!, spawnRemaining: ["ordinary"], enemies: blocked, structures: [{ ...barrier, hp: 1 }], enemyCooldowns: {} } };
  current = advanceBattle(current); assert.equal(current.battle?.goldEarned, 0); assert.equal(current.battle?.structures?.find((structure) => structure.id === barrier.id)?.hp, 0); assert.ok(current.battle?.effects.some((effect) => effect.type === "barrierBreak"));
  current = advanceBattle(current); assert.ok(!current.battle?.structures?.some((structure) => structure.kind === "royal-barrier"));
  const rebuilt = startWave({ ...begun, wave: 2, battle: { ...battleOf(begun), status: "victory" } }); assert.equal(rebuilt.ok, true); assert.equal(rebuilt.state.battle?.structures?.filter((structure) => structure.kind === "royal-barrier").length, 1);
});

test("royal barrier intercepts A, B and C before any route can damage the core", () => {
  const barrier = { id: "three-route-barrier", nodeId: "royal-barrier" as const, point: ROYAL_BARRIER_POINT, capacity: 2, createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, kind: "royal-barrier" as const, hp: 500, maxHp: 500, defense: 20 };
  for (const lane of ["upper", "lower", "side"] as const) {
    const threat = enemy(`final-${lane}`, "ordinary", lane, 1);
    const blocked = resolveBlocking([threat], [], [barrier], 0)[0];
    assert.equal(blocked?.blockedBy, `structure:${barrier.id}`, `${lane} bypassed the final royal barrier`);
  }
  const sideAtCore: GameState = { ...makeInitialState(), battle: { ...running([enemy("side-at-core", "ordinary", "side", .999)]), structures: [barrier] } };
  const defended = advanceBattle(sideAtCore);
  assert.equal(defended.coreHp, sideAtCore.coreHp, "C route must be blocked before leak settlement");
  assert.equal(defended.battle?.enemies[0]?.blockedBy, `structure:${barrier.id}`);
});

test("level six shop odds can roll four-cost philosophers", () => {
  const shop = pickShop(6, () => .99); assert.ok(shop.every((id) => characterById[id].cost === 4));
});

test("ground and highland placement plus capacity are enforced", () => {
  const state: GameState = { ...makeInitialState(), pieces: [{ id: "front", characterId: "fichte", star: 1, slotId: "bench-1" }, { id: "rear", characterId: "hegel", star: 1, slotId: "bench-2" }, { id: "third", characterId: "socrates", star: 1, slotId: "bench-3" }] };
  assert.equal(move(state, "front", "deploy-13").ok, false); assert.equal(move(state, "rear", "deploy-1").ok, false);
  const placed = move(state, "front", "deploy-1"); assert.equal(placed.ok, true); const placed2 = move(placed.state, "rear", "deploy-13"); assert.equal(placed2.ok, true);
  assert.equal(move(placed2.state, "third", "deploy-3").ok, false);
});

test("ground support can use every ground deployment tile", () => {
  for (const characterId of ["plato", "epicurus", "husserl"] as const) {
    const state: GameState = { ...makeInitialState(), pieces: [{ id: characterId, characterId, star: 1, slotId: "bench-1" }] };
    assert.equal(move(state, characterId, "deploy-3").ok, true);
    assert.equal(move(state, characterId, "deploy-13").ok, false);
  }
});

test("ground defenders can attack at the same distance where they intercept", () => {
  const fichte = { id: "front", characterId: "fichte", star: 1 as const, slotId: "deploy-1" as const };
  assert.equal(effectiveAttackRange(fichte), 10);
  const state: GameState = { ...makeInitialState(), pieces: [fichte], battle: running([enemy("engaged", "ordinary", "upper", progressNear("deploy-1"))]) };
  const before = state.battle!.enemies[0]!.hp;
  const next = advanceBattle(state); const engaged = next.battle!.enemies[0]!;
  assert.equal(engaged.blockedBy, "front"); assert.ok(engaged.hp < before);
});

test("every frozen ground deployment tile can intercept its nearest route before core damage", () => {
  const lanes = ["upper", "lower", "side"] as const;
  for (const slot of deploymentSlots.filter((candidate) => candidate.terrain === "ground")) {
    const lane = lanes.reduce((best, candidate) => distanceToRoute(deploymentPoint(slot.id), candidate) < distanceToRoute(deploymentPoint(slot.id), best) ? candidate : best);
    const state: GameState = {
      ...makeInitialState(() => 0),
      pieces: [{ id: `guard-${slot.id}`, characterId: "fichte", star: 1, slotId: slot.id }],
      battle: running([enemy(`enemy-${slot.id}`, "ordinary", lane, progressNear(slot.id, lane))]),
    };
    const next = advanceBattle(state);
    assert.equal(next.battle?.enemies[0]?.blockedBy, `guard-${slot.id}`, `${slot.id} cannot intercept ${lane}`);
    assert.equal(next.coreHp, state.coreHp, `${slot.id} allowed immediate core damage`);
  }
});

test("a wave checkpoint restores gold, shop, core and every unit to the start of this wave", () => {
  const prepared: GameState = { ...makeInitialState(), gold: 14, coreHp: 83, pieces: [
    { id: "ground", characterId: "fichte", star: 1, slotId: "deploy-1" },
    { id: "high", characterId: "aristotle", star: 1, slotId: "deploy-13" },
  ] };
  const begun = startWave(prepared); assert.equal(begun.ok, true); assert.ok(begun.state.waveCheckpoint);
  const changed: GameState = { ...begun.state, gold: 3, coreHp: 18, shop: [null, null, null, null, null], pieces: begun.state.pieces.map((piece) => ({ ...piece, hp: 1, energy: 99 })) };
  const restarted = restartCurrentWave(changed);
  assert.equal(restarted.ok, true); assert.equal(restarted.state.gold, 14); assert.equal(restarted.state.coreHp, 83);
  assert.deepEqual(restarted.state.shop, prepared.shop); assert.deepEqual(restarted.state.pieces, prepared.pieces);
  assert.equal(restarted.state.battle?.status, "idle");
});

test("serialized saves keep only durable game state and restart combat from preparation", () => {
  const prepared = updatePreparationPlan({ ...makeInitialState(), gold: 16, level: 4, xp: 3, wave: 5, coreHp: 91, shop: ["plato", "hume", null, "kant", "rousseau"], pieces: [
    { id: "front", characterId: "plato", star: 2, slotId: "deploy-1" },
    { id: "range", characterId: "hume", star: 1, slotId: "deploy-13" },
    { id: "bench", characterId: "kant", star: 1, slotId: "bench-1" },
  ] }, { revolutionNodeId: "core-front", rostrumId: "front", enlightenmentAgendas: ["citizen"] }).state;
  const roundTrip = migrateState(JSON.parse(serializeGameState(prepared)));
  assert.equal(roundTrip.gold, 16); assert.equal(roundTrip.level, 4); assert.equal(roundTrip.xp, 3); assert.equal(roundTrip.wave, 5); assert.equal(roundTrip.coreHp, 91);
  assert.deepEqual(roundTrip.shop, prepared.shop);
  assert.deepEqual(roundTrip.pieces.map((piece) => ({ id: piece.id, characterId: piece.characterId, star: piece.star, slotId: piece.slotId })), prepared.pieces.map((piece) => ({ id: piece.id, characterId: piece.characterId, star: piece.star, slotId: piece.slotId })));
  assert.equal(roundTrip.preparationPlan.revolutionNodeId, "core-front"); assert.equal(roundTrip.preparationPlan.rostrumId, "front");
  assert.equal(roundTrip.battle, undefined); assert.equal(roundTrip.waveCheckpoint, undefined);

  const begun = startWave(prepared).state;
  const dirtyCombat: GameState = { ...begun, gold: 1, coreHp: 44, shop: [null, null, null, null, null], pieces: begun.pieces.map((piece) => ({ ...piece, hp: 1, energy: 99 })), battle: { ...begun.battle!, effects: [{ id: "temp", type: "skill", slotId: "deploy-1", amount: 1, age: 0 }], eventQueue: [{ id: "queued", kind: "damage", targetKind: "enemy", targetId: "missing", amount: 99, sequence: 1 }] } };
  const restored = migrateState(JSON.parse(serializeGameState(dirtyCombat)));
  assert.equal(restored.gold, prepared.gold); assert.equal(restored.coreHp, prepared.coreHp); assert.deepEqual(restored.shop, prepared.shop);
  assert.deepEqual(restored.pieces.map((piece) => ({ id: piece.id, hp: piece.hp, energy: piece.energy, slotId: piece.slotId })), prepared.pieces.map((piece) => ({ id: piece.id, hp: piece.hp, energy: piece.energy, slotId: piece.slotId })));
  assert.equal(restored.battle, undefined); assert.equal(restored.waveCheckpoint, undefined);
});

test("legacy saves migrate safely into the new roster", () => {
  const migrated = migrateState({ gold: 7, level: 2, xp: 3, wave: 2, coreHp: 88, shop: ["archivist", "questioner", "forger", "wayfarer", "dialectician"], pieces: [{ id: "old", characterId: "oracle", star: 1, slotId: "bench-1" }] });
  assert.equal(migrated.pieces[0]?.characterId, "husserl"); assert.equal(migrated.gold, 7);
  const movedHighland = migrateState({ pieces: [{ id: "old-high", characterId: "hegel", star: 1, slotId: "deploy-2" }] });
  assert.equal(slotTerrain[movedHighland.pieces[0]?.slotId ?? ""], "highland");
  const checkpointSave = migrateState({ battle: running([]), waveCheckpoint: { gold: 12, level: 2, xp: 3, coreHp: 77, shop: ["fichte", null, "archivist", null, "plato"], pieces: [{ id: "saved-piece", characterId: "oracle", star: 1, slotId: "bench-1" }] } });
  assert.equal(checkpointSave.battle, undefined); assert.equal(checkpointSave.waveCheckpoint, undefined); assert.equal(checkpointSave.gold, 12); assert.equal(checkpointSave.pieces[0]?.characterId, "husserl");
});

test("three fixed routes stay separate before reaching the philosopher's stone", () => {
  assert.notDeepEqual(routePoint(.2, "upper"), routePoint(.2, "lower")); assert.notDeepEqual(routePoint(.2, "upper"), routePoint(.2, "side"));
  assert.deepEqual(routePoint(1, "upper"), routePoint(1, "lower")); assert.deepEqual(routePoint(1, "lower"), routePoint(1, "side"));
});

test("the authored map has stable unique IDs, safe slot spacing and valid revolution nodes", () => {
  assert.equal(Object.values(slotTerrain).filter((terrain) => terrain === "ground").length, 12);
  assert.equal(Object.values(slotTerrain).filter((terrain) => terrain === "highland").length, 8);
  const stableIds = [...deploymentSlots.map((slot) => slot.id), ...Object.values(routeDefinitions).flatMap((route) => route.map((waypoint) => waypoint.id))];
  assert.equal(new Set(deploymentSlots.map((slot) => slot.id)).size, deploymentSlots.length);
  assert.equal(new Set(stableIds).size, stableIds.length);
  assert.equal(stableIds.every((id) => typeof id === "string" && id.length > 0), true);
  for (let left = 0; left < deploymentSlots.length; left += 1) for (let right = left + 1; right < deploymentSlots.length; right += 1) {
    assert.ok(distance(deploymentSlots[left].point, deploymentSlots[right].point) >= 7.3, `${deploymentSlots[left].id} overlaps ${deploymentSlots[right].id}`);
  }
  for (const slot of deploymentSlots) {
    const roadGap = Math.min(...(["upper", "lower", "side"] as const).map((lane) => distanceToRoute(slot.point, lane)));
    if (slot.terrain === "ground") assert.ok(roadGap <= .01, `${slot.id} is not centered on its blocking road`);
    else assert.ok(roadGap >= .6, `${slot.id} highland platform conflicts with a road`);
  }
  assert.deepEqual(Object.keys(revolutionNodes).sort(), ["core-front", "debate-plaza", "side-gate"]);
  for (const node of Object.values(revolutionNodes)) assert.ok(Object.values(routeDefinitions).some((route) => route.some((waypoint) => distance(waypoint.point, node.point) < .01)));
});

test("the accepted 1600x900 map layout remains frozen", () => {
  const manifest = {
    version: MAP_LAYOUT_VERSION,
    canvas: { width: MAP_WIDTH, height: MAP_HEIGHT },
    roadWidths: MAP_ROAD_WIDTHS,
    footprints: MAP_FOOTPRINTS,
    routes: routeDefinitions,
    deploymentSlots,
    revolutionNodes,
    safeZones: MAP_ART_SAFE_ZONES,
    platformPaths: MAP_PLATFORM_PATHS,
  };
  assert.equal(MAP_LAYOUT_VERSION, "frozen-1600x900-v1");
  assert.equal(createHash("sha256").update(JSON.stringify(manifest)).digest("hex"), MAP_LAYOUT_FINGERPRINT);
});

test("all three routes are continuous, start at unique entrances and terminate at the same valid core", () => {
  const entries = Object.values(routeDefinitions).map((route) => route[0].id);
  assert.equal(new Set(entries).size, 3);
  for (const route of Object.values(routeDefinitions)) {
    assert.deepEqual(route.at(-1)?.point, { x: 94, y: 50 });
    route.slice(1).forEach((waypoint, index) => assert.ok(distance(route[index].point, waypoint.point) > 0 && distance(route[index].point, waypoint.point) <= 20));
  }
  assert.deepEqual(routeDefinitions.upper.find((waypoint) => waypoint.id === "a-merge")?.point, routeDefinitions.lower.find((waypoint) => waypoint.id === "b-merge")?.point);
  assert.equal(routeDefinitions.side.some((waypoint) => waypoint.point.x === 52 && waypoint.point.y === 50), false);
});

test("entrance defense and the A/B merge remain distinct useful blocking plans", () => {
  const early = ["deploy-1", "deploy-2", "deploy-3", "deploy-4", "deploy-5", "deploy-6"];
  const merge = ["deploy-7", "deploy-10", "deploy-11", "deploy-12"];
  const canBlock = (slots: string[], lane: "upper" | "lower", progress: number) => slots.some((slot) => distance(deploymentPoint(slot), routePoint(progress, lane)) < 10);
  assert.equal(canBlock(early, "upper", .2), true); assert.equal(canBlock(early, "lower", .2), true);
  assert.equal(canBlock(merge, "upper", .2), false); assert.equal(canBlock(merge, "lower", .2), false);
  assert.equal(canBlock(merge, "upper", .72), true); assert.equal(canBlock(merge, "lower", .72), true);
  assert.deepEqual(routePoint(.72, "upper"), routePoint(.72, "lower"));
});

test("every highland has meaningful real-range road coverage and edge envelopes stay safe", () => {
  for (const slot of deploymentSlots.filter((candidate) => candidate.terrain === "highland")) {
    const piece = { id: `coverage-${slot.id}`, characterId: "aristotle", star: 1 as const, slotId: slot.id };
    const range = effectiveAttackRange(piece);
    const covered = (["upper", "lower", "side"] as const).flatMap((lane) => Array.from({ length: 101 }, (_, index) => routePoint(index / 100, lane))).filter((point) => distance(slot.point, point) <= range).length;
    assert.ok(covered >= 30, `${slot.id} covers too little road for an ordinary ranged unit`);
  }
  const cSlot = deploymentPoint("deploy-8");
  assert.ok(cSlot.y - 5.7 >= 8, "C route deployment envelope needs a safe top margin");
  assert.ok(distance(deploymentPoint("deploy-12"), routeDefinitions.upper.at(-1)!.point) >= 11, "core front needs a complete boss-and-piece visual gap");
});

test("block capacity respects enemy weight and overflow enemies keep walking", () => {
  const contact = progressNear("deploy-1");
  const state: GameState = { ...makeInitialState(), pieces: [{ id: "f", characterId: "fichte", star: 1, slotId: "deploy-1", hp: 840, maxHp: 840 }], battle: running([enemy("heavy", "armored", "upper", contact), enemy("light", "ordinary", "upper", contact - .04)]) };
  const next = advanceBattle(state); const blocked = next.battle?.enemies.filter((item) => item.blockedBy === "f") ?? [];
  assert.equal(blocked.length, 1); assert.equal(blocked[0]?.weight, 2); assert.ok((next.battle?.enemies.find((item) => item.id === "light")?.progress ?? 0) > contact - .04);
});

test("blocked enemies use deterministic contact attacks instead of damaging the core", () => {
  const frontline: GameState = { ...makeInitialState(), pieces: [{ id: "front", characterId: "fichte", star: 1, slotId: "deploy-1", hp: 840, maxHp: 840 }], battle: { ...running([{ ...enemy("contact", "ordinary", "upper", progressNear("deploy-1")), blockedBy: "front" }]), enemyCooldowns: { contact: 0 } } };
  const next = advanceBattle(frontline); const front = next.pieces.find((piece) => piece.id === "front");
  assert.ok((front?.hp ?? 840) < 840); assert.equal(next.coreHp, frontline.coreHp); assert.ok(next.battle?.effects.some((effect) => effect.type === "enemyHit" && effect.enemyId === "contact"));
});

test("casters and elites create ranged pressure on deployed highland units without needing a blocker", () => {
  for (const kind of ["caster", "elite"] as const) {
    const highland = { id: `high-${kind}`, characterId: "aristotle", star: 1 as const, slotId: "deploy-13" as const, hp: 510, maxHp: 510 };
    const state: GameState = { ...makeInitialState(() => 0), wave: 4, pieces: [highland], battle: running([enemy(`ranged-${kind}`, kind, "upper", .3)]) };
    const next = advanceBattle(state); const target = next.pieces.find((piece) => piece.id === highland.id)!;
    assert.ok((target.hp ?? highland.hp) < highland.hp, `${kind} did not damage a highland target`);
    assert.ok((next.battle?.statistics?.units[highland.id]?.damageTaken ?? 0) > 0);
    assert.equal(next.coreHp, state.coreHp);
  }
});

test("every cleared wave grants four automatic experience and funds a refresh plus two four-cost purchases", () => {
  const state: GameState = { ...makeInitialState(() => 0), battle: running([]) };
  const settled = advanceBattle(state);
  assert.equal(settled.level, 2); assert.equal(settled.xp, 0);
  assert.equal(settled.battle?.summary?.experienceGained, 4);
  assert.equal(settled.battle?.summary?.baseIncome, 10);
  assert.equal(settled.battle.summary.baseIncome, ECONOMY_RULES.refreshCost + 2 * 4);
  assert.equal(settled.gold, 19);
});

test("Kant seals the generic boss only for the capped duration and delayed damage is capped", () => {
  const state: GameState = { ...makeInitialState(), pieces: [{ id: "k", characterId: "kant", star: 1, slotId: "deploy-13", hp: 560, maxHp: 560, energy: 100, maxEnergy: 100 }], battle: running([enemy("boss", "boss", "upper", .25)]) };
  const next = advanceBattle(state); const boss = next.battle?.enemies[0]; assert.equal(boss?.sealedTicks, 7); assert.ok((boss?.delayedDamage ?? 0) <= 180);
});

test("Cave Shadow triggers Turn Pain once, clears hard control and resets on retry", () => {
  const guard = { id: "guard", characterId: "fichte", star: 1 as const, slotId: "deploy-1" as const, hp: 840, maxHp: 840 };
  let state: GameState = { ...makeInitialState(), wave: 5, pieces: [guard], battle: { ...running([{ ...enemy("cave", "cave-boss", "upper", .25), hp: 280, maxHp: 560, bossPhasesTriggered: [], stunTicks: 9 }]), statuses: [{ id: "held", targetId: "cave", kind: "stun", startedAt: 0, expiresAt: 8, potency: 1 }], eventQueue: [{ id: "cross-half", kind: "damage", sourceId: "guard", targetKind: "enemy", targetId: "cave", amount: 1, sequence: 1 }] } };
  state = advanceBattle(state); const cave = state.battle?.enemies.find((unit) => unit.id === "cave");
  assert.deepEqual(state.battle?.bossPhaseLog?.map((phase) => phase.id), [CAVE_SHADOW_PHASE.id]); assert.equal(cave?.stunTicks, 0); assert.ok((cave?.phaseSpeedUntil ?? 0) > (state.battle?.gameTime ?? 0)); assert.ok(!state.battle?.statuses?.some((status) => status.targetId === "cave" && (status.kind === "stun" || status.kind === "pause")));
  state = { ...state, battle: { ...state.battle!, eventQueue: [{ id: "repeat-half", kind: "damage", sourceId: "guard", targetKind: "enemy", targetId: "cave", amount: 1, sequence: 2 }] } }; state = advanceBattle(state); assert.equal(state.battle?.bossPhaseLog?.length, 1);
  const retryable = { ...state, waveCheckpoint: { gold: 8, level: 1, xp: 0, coreHp: 100, shop: [], pieces: [guard] }, battle: { ...state.battle!, status: "defeat" as const } }; const retried = retryWave(retryable); assert.deepEqual(retried.state.battle?.bossPhaseLog, []);
});

test("Absolute Spirit triggers objective spirit, world night and absolute knowledge exactly once in order", () => {
  const defender = { id: "front", characterId: "fichte", star: 1 as const, slotId: "deploy-1" as const, hp: 840, maxHp: 840 };
  let state: GameState = { ...makeInitialState(), wave: 10, pieces: [defender], battle: { ...running([{ ...enemy("dogma", "boss", "upper", .25), hp: 1080, maxHp: 1450, bossPhasesTriggered: [] }]), eventQueue: [{ id: "cross-75", kind: "damage", sourceId: "front", targetKind: "enemy", targetId: "dogma", amount: 1, sequence: 1 }] } };
  state = advanceBattle(state); assert.deepEqual(state.battle?.bossPhaseLog?.map((phase) => phase.id), ["objective-spirit"]); assert.ok((state.battle?.enemies[0]?.shield ?? 0) > 0); assert.ok((state.battle?.enemies[0]?.phaseShieldUntil ?? 0) > (state.battle?.gameTime ?? 0));
  state = { ...state, battle: { ...state.battle!, enemies: state.battle!.enemies.map((unit) => ({ ...unit, hp: 640, shield: 0 })), eventQueue: [{ id: "cross-45", kind: "damage", sourceId: "front", targetKind: "enemy", targetId: "dogma", amount: 1, sequence: 2 }] } };
  state = advanceBattle(state); assert.deepEqual(state.battle?.bossPhaseLog?.map((phase) => phase.id), ["objective-spirit", "world-night"]); assert.ok((state.battle?.enemies[0]?.phaseSpeedUntil ?? 0) > (state.battle?.gameTime ?? 0));
  state = { ...state, pieces: state.pieces.map((piece) => ({ ...piece, energy: 30, shield: 100 })) };
  state = { ...state, battle: { ...state.battle!, enemies: state.battle!.enemies.map((unit) => ({ ...unit, hp: 280, shield: 0 })), eventQueue: [{ id: "cross-20", kind: "damage", sourceId: "front", targetKind: "enemy", targetId: "dogma", amount: 1, sequence: 3 }] } };
  state = advanceBattle(state); assert.deepEqual(state.battle?.bossPhaseLog?.map((phase) => phase.id), DOGMA_COLOSSUS_PHASES.map((phase) => phase.id)); assert.equal(state.pieces[0]?.energy, 20); assert.equal(state.pieces[0]?.shield, 50);
  state = { ...state, battle: { ...state.battle!, eventQueue: [{ id: "repeat", kind: "damage", sourceId: "front", targetKind: "enemy", targetId: "dogma", amount: 1, sequence: 4 }] } };
  state = advanceBattle(state); assert.equal(state.battle?.bossPhaseLog?.length, 3); assert.equal(state.battle?.synergyTriggers?.["boss:absolute-knowledge"], 1);
});

test("Absolute Spirit retry resets phases, combat saves discard them, and death or leaks settle once", () => {
  const pieces: GameState["pieces"] = [{ id: "guard", characterId: "fichte", star: 3, slotId: "deploy-1" }];
  let begun = startWave({ ...makeInitialState(), wave: 10, level: 8, pieces }); assert.equal(begun.ok, true);
  for (let step = 0; step < 20 && !begun.state.battle?.enemies.length; step += 1) begun = { ...begun, state: advanceBattle(begun.state) };
  const liveBoss = begun.state.battle!.enemies[0]!;
  const phased = advanceBattle({ ...begun.state, battle: { ...begun.state.battle!, enemies: [{ ...liveBoss, hp: liveBoss.maxHp * .74 }], eventQueue: [{ id: "saved-phase", kind: "damage", sourceId: "guard", targetKind: "enemy", targetId: liveBoss.id, amount: 1, sequence: 1 }] } });
  assert.equal(phased.battle?.bossPhaseLog?.length, 1);
  const restored = migrateState(JSON.parse(JSON.stringify(phased))); assert.equal(restored.battle, undefined);
  const restarted = restartCurrentWave(phased); assert.equal(restarted.ok, true); assert.deepEqual(restarted.state.battle?.bossPhaseLog, []);

  const defeated = advanceBattle({ ...makeInitialState(), wave: 10, pieces, battle: { ...running([{ ...enemy("dead-boss", "boss", "upper", .25), hp: 1, rewardValue: 10 }]), eventQueue: [{ id: "finish-boss", kind: "damage", sourceId: "guard", targetKind: "enemy", targetId: "dead-boss", amount: 10, sequence: 1 }] } });
  assert.equal(defeated.battle?.goldEarned, 10); assert.equal(defeated.battle?.statistics?.enemiesDefeated, 1); assert.equal(defeated.battle?.summary?.killGold, 10);
  const leaked = advanceBattle({ ...makeInitialState(), wave: 10, pieces, battle: running([{ ...enemy("leaked-boss", "boss", "upper", .999), coreDamageValue: 45 }]) });
  assert.equal(leaked.coreHp, 55); assert.equal(leaked.battle?.statistics?.enemiesLeaked, 1); assert.equal(leaked.battle?.statistics?.coreDamageBySource["绝对精神"], 45);
});

test("Germany system readies the next normal echo and derived echo adds no concept", () => {
  let state: GameState = { ...makeInitialState(), level: 4, pieces: [
    { id: "f", characterId: "fichte", star: 1, slotId: "deploy-1", hp: 840, maxHp: 840, energy: 65, maxEnergy: 65 },
    { id: "h", characterId: "husserl", star: 1, slotId: "deploy-3", hp: 650, maxHp: 650, energy: 78, maxEnergy: 78 },
    { id: "s", characterId: "schelling", star: 1, slotId: "deploy-13", hp: 500, maxHp: 500, energy: 90, maxEnergy: 90 },
    { id: "g", characterId: "hegel", star: 1, slotId: "deploy-14", hp: 590, maxHp: 590, energy: 95, maxEnergy: 95 },
  ], battle: running([enemy("target", "elite", "upper", .25)]) };
  state = advanceBattle(state); assert.equal(state.battle?.concepts, 0); assert.equal(state.battle?.germanEchoReady, 1); assert.ok(!state.battle?.effects.some((effect) => effect.type === "echo"));
  state = { ...state, pieces: state.pieces.map((piece) => piece.id === "f" ? { ...piece, energy: piece.maxEnergy } : piece) };
  state = advanceBattle(state); assert.ok(state.battle?.effects.some((effect) => effect.type === "echo")); assert.equal(state.battle?.concepts, 1); assert.equal(state.battle?.germanEchoReady, 0);
});

test("Greek dialogue and dialectic contradiction can trigger without infinite loops", () => {
  let state: GameState = { ...makeInitialState(), level: 5, pieces: [
    { id: "s", characterId: "socrates", star: 1, slotId: "deploy-1", hp: 590, maxHp: 590, energy: 70, maxEnergy: 70 },
    { id: "p", characterId: "plato", star: 1, slotId: "deploy-3", hp: 760, maxHp: 760, energy: 80, maxEnergy: 80 },
    { id: "h", characterId: "hegel", star: 1, slotId: "deploy-13", hp: 590, maxHp: 590, energy: 95, maxEnergy: 95 },
  ], battle: running([{ ...enemy("target", "ordinary", "upper", .22), contradiction: 2 }]) };
  state = advanceBattle(state); assert.ok(state.battle?.effects.some((effect) => effect.type === "synergy")); assert.ok((state.battle?.effects.filter((effect) => effect.type === "synergy").length ?? 0) < 8);
});

test("combat event queue and status manager use deterministic game time", () => {
  const queue = new CombatEventQueue();
  queue.enqueue({ id: "later", kind: "damage", targetKind: "enemy", targetId: "e", amount: 10, executeAt: 2 });
  queue.enqueue({ id: "now", kind: "heal", targetKind: "ally", targetId: "a", amount: 5 });
  assert.deepEqual(queue.drainReady(0).map((event) => event.id), ["now"]); assert.deepEqual(queue.drainReady(1), []); assert.deepEqual(queue.drainReady(2).map((event) => event.id), ["later"]);
  const statuses = new StatusManager(); statuses.add({ id: "weak", targetId: "e", kind: "slow", startedAt: 0, expiresAt: 3, potency: .2 }); statuses.add({ id: "strong", targetId: "e", kind: "slow", startedAt: 0, expiresAt: 2, potency: .5 });
  assert.equal(statuses.potency("e", "slow", 1), .5); statuses.expire(2.5); assert.equal(statuses.potency("e", "slow", 2.5), .2); statuses.expire(3); assert.equal(statuses.has("e", "slow", 3), false);
});

test("hard control durations diminish within a deterministic resistance window", () => {
  const statuses = new StatusManager();
  statuses.add({ id: "first", targetId: "e", kind: "stun", startedAt: 0, expiresAt: 4, potency: 1 });
  statuses.add({ id: "second", targetId: "e", kind: "pause", startedAt: 1, expiresAt: 5, potency: 1 });
  statuses.add({ id: "third", targetId: "e", kind: "stun", startedAt: 2, expiresAt: 6, potency: 1 });
  const byId = new Map(statuses.snapshot().map((status) => [status.id, status]));
  assert.equal(byId.get("first")?.expiresAt, 4);
  assert.equal(byId.get("second")?.expiresAt, 3.8);
  assert.equal(byId.get("third")?.expiresAt, 3.8);
  assert.equal(byId.get("control-resistance-e")?.potency, 3);
  statuses.expire(8);
  statuses.add({ id: "reset", targetId: "e", kind: "pause", startedAt: 8, expiresAt: 12, potency: 1 });
  assert.equal(statuses.snapshot().find((status) => status.id === "reset")?.expiresAt, 12);
});

test("trait snapshot stays immutable when a unit dies during the wave", () => {
  const pieces: GameState["pieces"] = [
    { id: "s", characterId: "socrates", star: 1, slotId: "deploy-1" },
    { id: "p", characterId: "plato", star: 1, slotId: "deploy-3" },
  ];
  const snapshot = createTraitSnapshot(pieces); assert.equal(snapshot.factionTiers.greece, 2); assert.ok(snapshot.rostrumId);
  const survivors = pieces.filter((piece) => piece.id !== snapshot.rostrumId); assert.equal(survivors.length, 1); assert.equal(snapshot.factionTiers.greece, 2); assert.equal(snapshot.unitIds.length, 2);
});

test("duplicate copies occupy population but never count twice toward faction or small-synergy tiers", () => {
  const duplicateSocrates: GameState["pieces"] = [
    { id: "s-1", characterId: "socrates", star: 1, slotId: "deploy-1" },
    { id: "s-2", characterId: "socrates", star: 1, slotId: "deploy-3" },
  ];
  const duplicateOnly = createTraitSnapshot(duplicateSocrates);
  assert.equal(duplicateOnly.unitIds.length, 2, "both physical copies remain deployed");
  assert.equal(duplicateOnly.factionCounts.greece, 1);
  assert.equal(duplicateOnly.factionTiers.greece, 0);
  assert.equal(duplicateOnly.dialecticCount, 1);
  assert.equal(duplicateOnly.smallSynergyTiers.dialectic, 0);

  const withPlato = createTraitSnapshot([...duplicateSocrates, { id: "p", characterId: "plato", star: 1, slotId: "deploy-5" }]);
  assert.equal(withPlato.factionCounts.greece, 2);
  assert.equal(withPlato.factionTiers.greece, 2);
  assert.equal(withPlato.smallSynergyTiers.dialectic, 2);

  const duplicateEnlightenment: GameState["pieces"] = [
    { id: "r-1", characterId: "rousseau", star: 1, slotId: "deploy-1" },
    { id: "r-2", characterId: "rousseau", star: 1, slotId: "deploy-3" },
    { id: "l", characterId: "locke", star: 1, slotId: "deploy-13" },
  ];
  assert.equal(createTraitSnapshot(duplicateEnlightenment).smallSynergyTiers.enlightenment, 0);
  assert.equal(chooseEnlightenmentAgendas({ ...makeInitialState(), pieces: duplicateEnlightenment }, ["citizen"]).ok, false);
});

test("Plato cave pause keeps route and blocking topology unchanged", () => {
  const slot = "deploy-1" as const; const point = deploymentPoint(slot);
  const progress = Array.from({ length: 100 }, (_, index) => index / 100).find((value) => { const gap = Math.hypot(point.x - routePoint(value, "upper").x, point.y - routePoint(value, "upper").y); return gap > 11 && gap < 16; })!;
  const targets = [enemy("cave-a", "ordinary", "upper", progress), enemy("cave-b", "ordinary", "upper", Math.max(0, progress - .01))].map((item) => ({ ...item, sourceRouteId: "upper" as const }));
  const state: GameState = { ...makeInitialState(), pieces: [{ id: "plato", characterId: "plato", star: 1, slotId: slot, hp: 730, maxHp: 730, energy: 80, maxEnergy: 80 }], battle: running(targets) };
  const cast = advanceBattle(state); const paused = cast.battle?.statuses?.filter((status) => status.kind === "pause") ?? []; assert.ok(paused.length >= 1); assert.ok(cast.battle?.enemies.every((item) => item.sourceRouteId === "upper")); assert.ok(cast.battle?.enemies.every((item) => !item.blockedBy));
  const before = new Map(cast.battle?.enemies.map((item) => [item.id, item.progress])); const next = advanceBattle(cast); paused.forEach((status) => { const item = next.battle?.enemies.find((candidate) => candidate.id === status.targetId); if (item) assert.equal(item.progress, before.get(item.id)); });
});

test("temporary blocker expiry releases enemies without changing their fixed route", () => {
  const point = routePoint(.25, "upper"); const state: GameState = { ...makeInitialState(), battle: { ...running([{ ...enemy("held", "armored", "upper", .25), sourceRouteId: "upper" }]), structures: [{ id: "wall", nodeId: "debate-plaza", point, capacity: 2, createdAt: 0, expiresAt: .3 }] } };
  const held = advanceBattle(state); assert.equal(held.battle?.enemies[0]?.blockedBy, "structure:wall"); assert.equal(held.battle?.enemies[0]?.progress, .25);
  const released = advanceBattle(held); assert.equal(released.battle?.structures?.length, 0); assert.equal(released.battle?.enemies[0]?.blockedBy, undefined); assert.ok((released.battle?.enemies[0]?.progress ?? 0) > .25); assert.equal(released.battle?.enemies[0]?.sourceRouteId, "upper");
});

test("Russell split conserves HP, reward, core damage and source route on a blocked boss", () => {
  const boss = { ...enemy("mother", "boss", "upper", .25), hp: 901, maxHp: 1450, sourceRouteId: "lower" as const, rewardValue: 10, coreDamageValue: 45 };
  const state: GameState = { ...makeInitialState(), level: 2, pieces: [
    { id: "tank", characterId: "heidegger", star: 1, slotId: "deploy-1", hp: 1080, maxHp: 1080 },
    { id: "russell", characterId: "russell", star: 1, slotId: "deploy-13", hp: 540, maxHp: 540, energy: 94, maxEnergy: 94 },
  ], battle: { ...running([boss]), cooldowns: { tank: 99 } } };
  const next = advanceBattle(state); const atoms = next.battle?.enemies.filter((item) => item.atomicGroupId === "mother") ?? [];
  assert.equal(atoms.length, 2); assert.equal(Math.round(atoms.reduce((sum, atom) => sum + atom.hp, 0)), 901); assert.equal(atoms.reduce((sum, atom) => sum + (atom.rewardValue ?? 0), 0), 10); assert.equal(atoms.reduce((sum, atom) => sum + (atom.coreDamageValue ?? 0), 0), 45); assert.ok(atoms.every((atom) => atom.sourceRouteId === "lower")); assert.equal(next.battle?.kills, 0); assert.equal(next.battle?.goldEarned, 0);
});

test("Althusser delayed area safely resolves after the original target disappears", () => {
  const state: GameState = { ...makeInitialState(), pieces: [{ id: "a", characterId: "althusser", star: 1, slotId: "deploy-13", hp: 575, maxHp: 575, energy: 96, maxEnergy: 96 }], battle: { ...running([enemy("temporary", "ordinary", "upper", .25)]), spawnRemaining: ["ordinary"], tick: 2, gameTime: .48 } };
  let current = advanceBattle(state); assert.equal(current.battle?.delayedDevices?.length, 1); current = { ...current, battle: { ...current.battle!, enemies: [], spawnRemaining: ["ordinary"] } };
  for (let index = 0; index < 16; index += 1) current = advanceBattle(current);
  assert.equal(current.battle?.delayedDevices?.length, 0); assert.ok(current.battle?.effects.every((effect) => effect.amount === undefined || Number.isFinite(effect.amount)));
});

test("contract redistribution is capped once and cannot recursively redistribute", () => {
  const state: GameState = { ...makeInitialState(), pieces: [
    { id: "leader", characterId: "rousseau", star: 1, slotId: "deploy-1", hp: 500, maxHp: 680, contractGroupId: "contract", contractUntil: 10 },
    { id: "ally", characterId: "fichte", star: 1, slotId: "deploy-3", hp: 500, maxHp: 840, contractGroupId: "contract", contractUntil: 10 },
  ], battle: { ...running([enemy("pressure", "ordinary", "side", .1)]), enemyCooldowns: { pressure: 99 }, eventQueue: [{ id: "contract-hit", kind: "damage", targetKind: "ally", targetId: "leader", amount: 100, sequence: 1 }] } };
  const next = advanceBattle(state);
  const leader = next.pieces.find((piece) => piece.id === "leader")!;
  const ally = next.pieces.find((piece) => piece.id === "ally")!;
  assert.equal(500 - (leader.hp ?? 0), 65);
  assert.equal(500 - (ally.hp ?? 0), 35);
  assert.equal((500 - (leader.hp ?? 0)) + (500 - (ally.hp ?? 0)), 100);
  assert.ok((next.battle?.eventQueue.length ?? 0) < 3);
});

test("LastStand is shared and can prevent death only once per unit per wave", () => {
  let state: GameState = { ...makeInitialState(), pieces: [
    { id: "last-stand", characterId: "heidegger", star: 1, slotId: "deploy-1", hp: 20, maxHp: 1080 },
  ], battle: { ...running([enemy("pressure", "ordinary", "side", .1)]), eventQueue: [{ id: "first-lethal", kind: "damage", targetKind: "ally", targetId: "last-stand", amount: 5000, sequence: 1 }] } };
  state = advanceBattle(state);
  let survivor = state.pieces.find((piece) => piece.id === "last-stand");
  assert.equal(survivor?.hp, 1); assert.equal(survivor?.lastStandConsumed, true);
  for (let tick = 0; tick < 8; tick += 1) state = advanceBattle(state);
  state = { ...state, battle: { ...state.battle!, eventQueue: [{ id: "second-lethal", kind: "damage", targetKind: "ally", targetId: "last-stand", amount: 5000, sequence: 99 }] } };
  state = advanceBattle(state);
  survivor = state.pieces.find((piece) => piece.id === "last-stand");
  assert.equal(survivor, undefined);
});

test("V4 combat snapshots are discarded without losing valid roster progress", () => {
  const migrated = migrateState({ saveVersion: 1, gold: 27, wave: 4, pieces: [{ id: "p", characterId: "plato", star: 2, slotId: "bench-1" }], battle: running([enemy("old", "ordinary")]) });
  assert.equal(migrated.battle, undefined); assert.equal(migrated.gold, 27); assert.equal(migrated.wave, 4); assert.equal(migrated.pieces[0]?.characterId, "plato");
});

test("V5/V6 migration discards combat snapshots and preserves durable progress safely", () => {
  const prepared: GameState = { ...makeInitialState(), pieces: [{ id: "plato", characterId: "plato", star: 1, slotId: "deploy-1" }] };
  const started = startWave(prepared).state;
  const resumed = migrateState({ ...started, saveVersion: 5 });
  assert.equal(resumed.battle, undefined); assert.equal(resumed.waveCheckpoint, undefined); assert.deepEqual(resumed.pieces, prepared.pieces);
  const malformed = migrateState({ ...started, saveVersion: 5, battle: { ...started.battle!, statuses: "broken" } });
  assert.equal(malformed.battle, undefined);
  const repairedRoster = migrateState({ pieces: [
    { id: "same", characterId: "plato", star: 99, slotId: "bench-1" },
    { id: "same", characterId: "socrates", star: 2, slotId: "bench-1" },
  ] });
  assert.deepEqual(repairedRoster.pieces.map((piece) => piece.star), [1, 2]);
  assert.equal(new Set(repairedRoster.pieces.map((piece) => piece.id)).size, repairedRoster.pieces.length);
  assert.equal(new Set(repairedRoster.pieces.map((piece) => piece.slotId)).size, repairedRoster.pieces.length);
});

test("waves retain escalating threat budgets, Cave Shadow five, boss-only ten, core damage and retry", () => {
  const budgets = Array.from({ length: 10 }, (_, index) => waveDefinition(index + 1).threatBudget);
  assert.deepEqual(budgets, [6, 10, 15, 21, 28, 36, 46, 58, 72, 90]);
  assert.ok(budgets.every((budget, index) => index === 0 || budget > budgets[index - 1]!));
  assert.ok(waveDefinition(5).enemies.includes("cave-boss")); assert.deepEqual(waveDefinition(10).enemies, ["boss"]); assert.equal(waveDefinition(10).boss, true);
  const defeated: GameState = { ...makeInitialState(), coreHp: 0, battle: { ...running([]), status: "defeat" } }; const retried = retryWave(defeated); assert.equal(retried.state.coreHp, 100);
});

test("a starter defense with a ground blocker and highland coverage clears wave one", () => {
  const state: GameState = { ...makeInitialState(), pieces: [{ id: "defender", characterId: "fichte", star: 2, slotId: "deploy-1" }, { id: "coverage", characterId: "aristotle", star: 2, slotId: "deploy-13" }] };
  let current = startWave(state).state; for (let tick = 0; tick < 350 && current.battle?.status === "running"; tick += 1) current = advanceBattle(current);
  assert.equal(current.battle?.status, "victory"); assert.ok(current.gold > state.gold);
});

test("settled waves write a copyable balance report with economy, route and unit statistics", () => {
  let state: GameState = { ...makeInitialState(), gold: 8, pieces: [{ id: "front", characterId: "fichte", star: 2, slotId: "deploy-1" }, { id: "rear", characterId: "aristotle", star: 2, slotId: "deploy-13" }] };
  state = refresh(state).state;
  state = startWave(state).state;
  for (let tick = 0; tick < 350 && state.battle?.status === "running"; tick += 1) state = advanceBattle(state);
  const report = state.balanceHistory?.[0];
  assert.equal(report?.wave, 1); assert.equal(report?.success, true); assert.equal(report?.economy.refreshes, 1);
  assert.equal(report?.routes.upper.spawned, 1); assert.equal(report?.routes.lower.spawned, 1);
  assert.ok(Object.values(report?.units ?? {}).some((unit) => unit.damage > 0 || unit.shielding > 0 || unit.blockedWeight > 0));
  const restored = migrateState(JSON.parse(serializeGameState(state)));
  assert.equal(restored.balanceHistory?.[0]?.wave, 1); assert.equal(restored.waveEconomy, undefined);
});

test("every legal pair of one-star philosophers clears the teaching wave without core loss", () => {
  for (let left = 0; left < characters.length; left += 1) for (let right = left + 1; right < characters.length; right += 1) {
    let groundIndex = 0; let highlandIndex = 0;
    const pair = [characters[left]!, characters[right]!];
    const pieces = pair.map((character, index) => ({ id: `opening-${index}`, characterId: character.id, star: 1 as const, slotId: character.terrain === "ground" ? ["deploy-1", "deploy-3"][groundIndex++]! : ["deploy-13", "deploy-14"][highlandIndex++]! }));
    let current = startWave({ ...makeInitialState(), pieces }).state;
    for (let tick = 0; tick < 450 && current.battle?.status === "running"; tick += 1) current = advanceBattle(current);
    assert.equal(current.battle?.status, "victory", `${pair[0].name} + ${pair[1].name} must clear wave one`);
    assert.equal(current.coreHp, 100, `${pair[0].name} + ${pair[1].name} must protect the core on wave one`);
  }
});

test("a complete V0.1 squad can play three consecutive waves with settlement", () => {
  let current: GameState = { ...makeInitialState(), level: 4, pieces: [
    { id: "f", characterId: "fichte", star: 3, slotId: "deploy-1" }, { id: "s", characterId: "socrates", star: 3, slotId: "deploy-3" },
    { id: "p", characterId: "plato", star: 3, slotId: "deploy-4" }, { id: "h", characterId: "hegel", star: 3, slotId: "deploy-13" },
  ] };
  for (let wave = 1; wave <= 3; wave += 1) { current = startWave(current).state; for (let tick = 0; tick < 600 && current.battle?.status === "running"; tick += 1) current = advanceBattle(current); assert.equal(current.battle?.status, "victory"); }
  assert.equal(current.wave, 4); assert.ok(current.gold > 10);
});

test("an underprepared level-six two-star squad cannot trivialize Absolute Spirit", () => {
  const state: GameState = { ...makeInitialState(), level: 6, wave: 10, pieces: [
    { id: "f", characterId: "fichte", star: 2, slotId: "deploy-1" }, { id: "s", characterId: "socrates", star: 2, slotId: "deploy-3" },
    { id: "p", characterId: "plato", star: 2, slotId: "deploy-4" }, { id: "d", characterId: "heidegger", star: 2, slotId: "deploy-8" },
    { id: "h", characterId: "hegel", star: 2, slotId: "deploy-13" }, { id: "k", characterId: "kant", star: 2, slotId: "deploy-14" },
  ] };
  let current = startWave(state).state; for (let tick = 0; tick < 1100 && current.battle?.status === "running"; tick += 1) current = advanceBattle(current);
  assert.equal(current.battle?.status, "defeat"); assert.equal(current.battle?.summary?.success, false); assert.equal(current.battle?.summary?.statistics.enemiesDefeated, 0); assert.equal(current.battle?.summary?.statistics.enemiesLeaked, 1); assert.ok(current.coreHp < 100);
});

const assertCombatInvariants = (state: GameState) => {
  assert.equal(state.shop.length, 5, "shop must retain five slots");
  assert.ok(Number.isFinite(state.gold) && state.gold >= 0, "gold must be finite and non-negative");
  assert.ok(Number.isFinite(state.coreHp) && state.coreHp >= 0 && state.coreHp <= 100, "core HP must remain bounded");
  assert.equal(new Set(state.pieces.map((piece) => piece.id)).size, state.pieces.length, "unit ids must be unique");

  for (const piece of state.pieces) {
    assert.ok(characterById[piece.characterId], `unknown character ${piece.characterId}`);
    for (const value of [piece.hp, piece.maxHp, piece.energy, piece.maxEnergy, piece.shield]) {
      if (value !== undefined) assert.ok(Number.isFinite(value) && value >= 0, `invalid unit resource on ${piece.id}`);
    }
    if (piece.hp !== undefined && piece.maxHp !== undefined) assert.ok(piece.hp <= piece.maxHp, `unit HP overflow on ${piece.id}`);
    if (piece.energy !== undefined && piece.maxEnergy !== undefined) assert.ok(piece.energy <= piece.maxEnergy, `unit energy overflow on ${piece.id}`);
  }

  const battle = state.battle;
  if (!battle) return;
  assert.ok(Number.isFinite(battle.gameTime ?? 0) && (battle.gameTime ?? 0) >= 0, "game time must be valid");
  assert.ok((battle.eventQueue?.length ?? 0) < 200, "event queue must stay bounded");
  assert.equal(new Set(battle.enemies.map((enemy) => enemy.id)).size, battle.enemies.length, "enemy ids must be unique");
  const pieceIds = new Set(state.pieces.map((piece) => piece.id));
  const structureIds = new Set((battle.structures ?? []).map((structure) => `structure:${structure.id}`));
  const blockedWeights = new Map<string, number>();
  for (const enemy of battle.enemies) {
    assert.ok(["upper", "lower", "side"].includes(enemy.sourceRouteId ?? ""), `enemy ${enemy.id} lost sourceRouteId`);
    for (const value of [enemy.hp, enemy.maxHp, enemy.progress, enemy.energy, enemy.maxEnergy, enemy.shield]) {
      if (value !== undefined) assert.ok(Number.isFinite(value) && value >= 0, `invalid enemy resource on ${enemy.id}`);
    }
    assert.ok(enemy.hp <= enemy.maxHp, `enemy HP overflow on ${enemy.id}`);
    assert.ok(enemy.progress <= 1, `enemy progress overflow on ${enemy.id}`);
    if (enemy.blockedBy) {
      assert.ok(pieceIds.has(enemy.blockedBy) || structureIds.has(enemy.blockedBy), `enemy ${enemy.id} references invalid blocker`);
      blockedWeights.set(enemy.blockedBy, (blockedWeights.get(enemy.blockedBy) ?? 0) + enemy.weight);
    }
  }
  for (const [blockerId, weight] of blockedWeights) {
    if (blockerId.startsWith("structure:")) {
      const structure = battle.structures?.find((candidate) => `structure:${candidate.id}` === blockerId);
      assert.ok(structure && weight <= structure.capacity, `temporary blocker ${blockerId} is over capacity`);
    } else {
      const piece = state.pieces.find((candidate) => candidate.id === blockerId)!;
      const capacity = Math.min(5, characterById[piece.characterId].block + (piece.blockBonus ?? 0));
      assert.ok(weight <= capacity, `unit blocker ${blockerId} is over capacity`);
    }
  }
  for (const event of battle.eventQueue ?? []) {
    assert.ok(Number.isFinite(event.executeAt ?? 0), `event ${event.id} has invalid execution time`);
    assert.ok(event.amount === undefined || (Number.isFinite(event.amount) && event.amount >= 0), `event ${event.id} has invalid amount`);
  }
};

test("a complete eight-unit French formation completes all ten waves without corrupting combat state", () => {
  let current: GameState = { ...makeInitialState(), level: 8, gold: 30, pieces: [
    { id: "rousseau", characterId: "rousseau", star: 3, slotId: "deploy-1" },
    { id: "sartre", characterId: "sartre", star: 3, slotId: "deploy-3" },
    { id: "descartes", characterId: "descartes", star: 3, slotId: "deploy-13" },
    { id: "foucault", characterId: "foucault", star: 2, slotId: "deploy-14" },
    { id: "deleuze", characterId: "deleuze", star: 2, slotId: "deploy-15" },
    { id: "derrida", characterId: "derrida", star: 2, slotId: "deploy-18" },
    { id: "lacan", characterId: "lacan", star: 2, slotId: "deploy-19" },
    { id: "althusser", characterId: "althusser", star: 2, slotId: "deploy-20" },
  ] };

  for (let expectedWave = 1; expectedWave <= 10; expectedWave += 1) {
    const begun = startWave(current);
    assert.equal(begun.ok, true, `wave ${expectedWave} must start`);
    current = begun.state;
    for (let tick = 0; tick < 1800 && current.battle?.status === "running"; tick += 1) {
      current = advanceBattle(current);
      assertCombatInvariants(current);
    }
    assert.equal(current.battle?.status, expectedWave === 10 ? "complete" : "victory", `wave ${expectedWave} must settle successfully`);
    assert.equal(current.wave, expectedWave === 10 ? 10 : expectedWave + 1);
  }
  assert.ok(current.coreHp > 0, "the full run must finish with the philosopher's stone alive");
  assert.ok((current.battle?.summary?.statistics.enemiesDefeated ?? 0) >= 1, "a fully prepared formation must defeat the boss or every conserved Russell atom");
  assert.equal(current.battle?.summary?.statistics.enemiesLeaked, 0, "the boss may not be counted as a victory by merely leaking");
});

test("an incoherent one-star roster collapses before reaching the final wave", () => {
  let current: GameState = { ...makeInitialState(), level: 8, pieces: [
    { id: "socrates", characterId: "socrates", star: 1, slotId: "deploy-1" },
    { id: "fichte", characterId: "fichte", star: 1, slotId: "deploy-3" },
    { id: "rousseau", characterId: "rousseau", star: 1, slotId: "deploy-8" },
    { id: "locke", characterId: "locke", star: 1, slotId: "deploy-10" },
    { id: "aristotle", characterId: "aristotle", star: 1, slotId: "deploy-13" },
    { id: "schelling", characterId: "schelling", star: 1, slotId: "deploy-15" },
    { id: "descartes", characterId: "descartes", star: 1, slotId: "deploy-18" },
    { id: "hume", characterId: "hume", star: 1, slotId: "deploy-20" },
  ] };
  while (current.wave < 10 && current.battle?.status !== "defeat") {
    current = startWave(current).state;
    for (let tick = 0; tick < 1800 && current.battle?.status === "running"; tick += 1) current = advanceBattle(current);
  }
  assert.equal(current.battle?.status, "defeat");
  assert.ok(current.wave < 10, "random one-star purchases must fail during the middle or late game");
});

test("PreparationPlan validates choices, freezes at wave start and migrates without duplicating economy", () => {
  const base: GameState = { ...makeInitialState(), gold: 19, pieces: [
    { id: "s", characterId: "socrates", star: 1, slotId: "deploy-1" }, { id: "p", characterId: "plato", star: 1, slotId: "deploy-3" },
    { id: "l", characterId: "locke", star: 1, slotId: "deploy-13" },
  ] };
  const configured = updatePreparationPlan(base, { rostrumId: "s", revolutionNodeId: "core-front" });
  assert.equal(configured.ok, true); assert.equal(configured.state.preparationPlan.revolutionNodeId, "core-front");
  const begun = startWave(configured.state); assert.equal(begun.state.battle?.traitSnapshot?.rostrumId, "s");
  const locked = updatePreparationPlan(begun.state, { rostrumId: "p" }); assert.equal(locked.ok, false); assert.equal(locked.state.battle?.traitSnapshot?.rostrumId, "s");
  const soldRostrum = sell(configured.state, "s"); assert.equal(soldRostrum.ok, true); assert.equal(soldRostrum.state.preparationPlan.rostrumId, undefined);
  const movedRostrum = move(configured.state, "s", "bench-1"); assert.equal(movedRostrum.ok, true); assert.equal(movedRostrum.state.preparationPlan.rostrumId, "s");
  const ordinaryPurchase = buy(makeInitialState(() => 0), 0); assert.equal(ordinaryPurchase.state.preparationPlan.revolutionNodeId, undefined, "non-French purchases must not silently choose France's run-level node");
  const migrated = migrateState({ saveVersion: 2, gold: 19, wave: 3, shop: ["plato"], pieces: base.pieces, preparationPlan: configured.state.preparationPlan, battle: running([]) });
  assert.equal(migrated.battle, undefined); assert.equal(migrated.gold, 19); assert.equal(migrated.preparationPlan.rostrumId, "s");
});

test("preparation choices change the frozen combat result instead of only changing configuration", () => {
  const greek: GameState["pieces"] = [
    { id: "s", characterId: "socrates", star: 1, slotId: "deploy-1" },
    { id: "p", characterId: "plato", star: 1, slotId: "deploy-3" },
  ];
  const selectedRostrum = updatePreparationPlan({ ...makeInitialState(), pieces: greek }, { rostrumId: "p" });
  const greekWave = startWave(selectedRostrum.state);
  const socrates = greekWave.state.pieces.find((piece) => piece.id === "s")!;
  const plato = greekWave.state.pieces.find((piece) => piece.id === "p")!;
  assert.equal(greekWave.state.battle?.traitSnapshot?.rostrumId, "p");
  assert.equal(socrates.shield, 0); assert.equal(plato.energy, 15); assert.equal(plato.shield, Math.round((plato.maxHp ?? 0) * .1));

  const france4 = ["descartes", "rousseau", "sartre", "foucault"].map((characterId, index) => ({ id: `f-${index}`, characterId, star: 1 as const, slotId: (`deploy-${index + 1}`) as GameState["pieces"][number]["slotId"], energy: 100, maxEnergy: 100 }));
  const expectedNodes = {
    "debate-plaza": revolutionNodePoint("debate-plaza"),
    "side-gate": revolutionNodePoint("side-gate"),
    "core-front": revolutionNodePoint("core-front"),
  } as const;
  for (const [nodeId, point] of Object.entries(expectedNodes)) {
    const snapshot = createTraitSnapshot(france4, { revolutionNodeId: nodeId as "debate-plaza" | "side-gate" | "core-front" });
    const result = advanceBattle({ ...makeInitialState(), pieces: france4, battle: { ...running([enemy(`node-${nodeId}`, "ordinary", "upper", .47)]), traitSnapshot: snapshot } });
    const structure = result.battle?.structures?.[0];
    assert.equal(structure?.nodeId, nodeId); assert.deepEqual(structure?.point, point);
  }

  const britain2: GameState["pieces"] = [
    { id: "h", characterId: "hume", star: 1, slotId: "deploy-13", energy: 78, maxEnergy: 78 },
    { id: "r", characterId: "russell", star: 1, slotId: "deploy-14", energy: 82, maxEnergy: 82 },
  ];
  for (const sourceRouteId of ["upper", "lower", "side"] as const) {
    const target = { ...enemy(`source-${sourceRouteId}`, "ordinary", "upper", .23), sourceRouteId };
    const result = advanceBattle({ ...makeInitialState(), pieces: britain2, battle: { ...running([target]), traitSnapshot: createTraitSnapshot(britain2) } });
    assert.ok((result.battle?.britishEvidence ?? 0) > 0, `${sourceRouteId} source must generate British evidence`);
  }
});

test("Greek four grants one safe 40 percent rostrum echo after three dialogues", () => {
  const pieces: GameState["pieces"] = [
    { id: "s", characterId: "socrates", star: 1, slotId: "deploy-1", energy: 100, maxEnergy: 100 }, { id: "p", characterId: "plato", star: 1, slotId: "deploy-3" },
    { id: "a", characterId: "aristotle", star: 1, slotId: "deploy-13" }, { id: "e", characterId: "epicurus", star: 1, slotId: "deploy-14" },
    { id: "f", characterId: "fichte", star: 1, slotId: "deploy-4" }, { id: "d", characterId: "descartes", star: 1, slotId: "deploy-15" },
  ];
  const snapshot = createTraitSnapshot(pieces, { rostrumId: "s" });
  let state: GameState = { ...makeInitialState(), pieces, battle: { ...running([enemy("target", "ordinary")]), traitSnapshot: snapshot, greekDialogueCount: 2, factionCasts: ["germany"] } };
  state = advanceBattle(state); assert.equal(state.battle?.greekDerivedCharges, 1);
  state = { ...state, pieces: state.pieces.map((piece) => piece.id === "s" ? { ...piece, energy: piece.maxEnergy } : piece), battle: { ...state.battle!, cooldowns: { s: 0 } } };
  state = advanceBattle(state); const echoes = state.battle?.effects.filter((effect) => effect.id.startsWith("echo-") && effect.derivedEffect) ?? [];
  assert.equal(echoes.length, 1); assert.equal(state.battle?.greekDerivedCharges, 0); assert.ok((state.battle?.greekDialogueCount ?? 0) >= 3);
});

test("Germany six uses individual absolute echoes once and never reopens concepts", () => {
  const ids = ["fichte", "husserl", "schelling", "heidegger", "kant", "hegel"];
  const pieces = ids.map((characterId, index) => ({ id: `g${index}`, characterId, star: 1 as const, slotId: (`deploy-${index < 4 ? index + 1 : index + 9}`) as GameState["pieces"][number]["slotId"], energy: 100, maxEnergy: 100 }));
  let state: GameState = { ...makeInitialState(), level: 6, pieces, battle: { ...running([enemy("target", "elite")]), traitSnapshot: createTraitSnapshot(pieces) } };
  state = advanceBattle(state); assert.equal(state.battle?.absoluteUsed, true); assert.equal(Object.values(state.battle?.germanAbsoluteEchoReady ?? {}).filter(Boolean).length, 6);
  const conceptsBefore = state.battle?.concepts ?? 0;
  state = { ...state, pieces: state.pieces.map((piece) => piece.id === "g0" ? { ...piece, energy: piece.maxEnergy } : piece) };
  state = advanceBattle(state); assert.equal(state.battle?.germanAbsoluteEchoReady?.g0, false); assert.equal(state.battle?.concepts, conceptsBefore + 1);
});

test("faction tier boundaries have observable combat outcomes at every implemented threshold", () => {
  const germany2: GameState["pieces"] = [
    { id: "g1", characterId: "fichte", star: 1, slotId: "deploy-1", energy: 65, maxEnergy: 65 },
    { id: "g2", characterId: "husserl", star: 1, slotId: "deploy-3", energy: 78, maxEnergy: 78 },
  ];
  const germany2Result = advanceBattle({ ...makeInitialState(), pieces: germany2, battle: { ...running([enemy("germany-2", "ordinary", "upper", .25)]), traitSnapshot: createTraitSnapshot(germany2) } });
  assert.equal(germany2Result.battle?.traitSnapshot?.factionTiers.germany, 2); assert.equal(germany2Result.battle?.concepts, 2);

  const france6Ids = ["descartes", "rousseau", "sartre", "foucault", "deleuze", "derrida"];
  const france6 = france6Ids.map((characterId, index) => ({ id: `fr6-${index}`, characterId, star: 1 as const, slotId: (`deploy-${index < 4 ? index + 1 : index + 13}`) as GameState["pieces"][number]["slotId"], energy: 100, maxEnergy: 100 }));
  const france6Result = advanceBattle({ ...makeInitialState(), level: 6, pieces: france6, battle: { ...running([enemy("france-6", "elite", "upper", .47)]), traitSnapshot: createTraitSnapshot(france6, { revolutionNodeId: "side-gate" }) } });
  const commune = france6Result.battle?.structures?.[0];
  assert.equal(france6Result.battle?.traitSnapshot?.factionTiers.france, 6); assert.equal(commune?.kind, "commune"); assert.equal(commune?.capacity, 3); assert.deepEqual(commune?.point, revolutionNodePoint("side-gate"));

  const britain6Ids = ["locke", "hume", "hobbes", "russell", "bacon", "bentham"];
  const britain6 = britain6Ids.map((characterId, index) => ({ id: `br6-${index}`, characterId, star: 1 as const, slotId: (`deploy-${index < 3 ? index + 1 : index + 13}`) as GameState["pieces"][number]["slotId"], energy: 100, maxEnergy: 100 }));
  const britainSnapshot = createTraitSnapshot(britain6, { activeResearches: [{ choice: "mechanics", wavesRemaining: 2 }] });
  const britain6Result = advanceBattle({ ...makeInitialState(), level: 6, pieces: britain6, battle: { ...running([{ ...enemy("upper-source", "ordinary", "upper", .2), sourceRouteId: "upper" }, { ...enemy("lower-source", "ordinary", "lower", .2), sourceRouteId: "lower" }]), traitSnapshot: britainSnapshot } });
  assert.equal(britain6Result.battle?.traitSnapshot?.factionTiers.britain, 6); assert.ok((britain6Result.battle?.britishEvidence ?? 0) > 0);
});

test("France four creates one capacity-two barricade and France six commune expires safely", () => {
  const france4 = ["descartes", "rousseau", "sartre", "foucault"].map((characterId, index) => ({ id: `f${index}`, characterId, star: 1 as const, slotId: (`deploy-${index + 1}`) as GameState["pieces"][number]["slotId"], energy: 100, maxEnergy: 100 }));
  let state: GameState = { ...makeInitialState(), pieces: france4, battle: { ...running([enemy("held", "ordinary", "upper", .47)]), traitSnapshot: createTraitSnapshot(france4) } };
  state = advanceBattle(state); const barricade = state.battle?.structures?.[0]; assert.equal(barricade?.capacity, 2); assert.equal(barricade?.kind, "barricade");
  const communeState: GameState = { ...makeInitialState(), battle: { ...running([{ ...enemy("released", "ordinary", "upper", .47), sourceRouteId: "upper" }]), structures: [{ id: "commune", nodeId: "debate-plaza", point: revolutionNodePoint("debate-plaza"), capacity: 3, createdAt: 0, expiresAt: .3, kind: "commune" }] } };
  const held = advanceBattle(communeState); const expired = advanceBattle(held); assert.equal(expired.battle?.structures?.length, 0); assert.equal(expired.battle?.enemies[0]?.blockedBy, undefined); assert.equal(expired.battle?.enemies[0]?.sourceRouteId, "upper");
});

test("Britain global research is awarded by law, resolves each conclusion and migrates safely", () => {
  const britain4 = ["locke", "hume", "hobbes", "russell"].map((characterId, index) => ({ id: `b${index}`, characterId, star: 1 as const, slotId: (`deploy-${index + 13}`) as GameState["pieces"][number]["slotId"] }));
  const snapshot = createTraitSnapshot(britain4);
  let awarded: GameState = advanceBattle({ ...makeInitialState(), pieces: britain4, battle: { ...running([]), traitSnapshot: snapshot, britishLawTriggers: 1 } });
  assert.equal(awarded.preparationPlan.pendingResearchChoices, 1);
  const mechanics = chooseResearch(awarded, "mechanics"); assert.equal(mechanics.ok, true); assert.deepEqual(mechanics.state.preparationPlan.activeResearches, [{ choice: "mechanics", wavesRemaining: 1 }]);
  awarded = advanceBattle({ ...makeInitialState(), pieces: britain4, battle: { ...running([]), traitSnapshot: snapshot, britishLawTriggers: 1 } });
  const medicine = chooseResearch(awarded, "medicine"); assert.equal(medicine.ok, true); assert.deepEqual(medicine.state.preparationPlan.activeResearches, [{ choice: "medicine", wavesRemaining: 1 }]);
  awarded = advanceBattle({ ...makeInitialState(), pieces: britain4, battle: { ...running([]), traitSnapshot: snapshot, britishLawTriggers: 1 } });
  const political = chooseResearch(awarded, "political-arithmetic"); assert.equal(political.ok, true); assert.equal(political.state.gold, awarded.gold + 2);
  const restored = migrateState({ ...political.state, saveVersion: 3, preparationPlan: { ...political.state.preparationPlan, experimentRouteIds: ["side"], activeResearch: { choice: "mechanics", wavesRemaining: 2 } } });
  assert.equal(restored.gold, political.state.gold); assert.equal(restored.preparationPlan.politicalArithmeticClaimed, true); assert.equal("experimentRouteIds" in restored.preparationPlan, false); assert.deepEqual(restored.preparationPlan.activeResearches, []);
  const blocked = chooseResearch({ ...political.state, preparationPlan: { ...political.state.preparationPlan, pendingResearchChoices: 1 } }, "political-arithmetic"); assert.equal(blocked.ok, false); assert.equal(blocked.state.gold, political.state.gold);
  const nextWave = advanceBattle({ ...political.state, wave: 2, battle: { ...running([]), traitSnapshot: snapshot, britishLawTriggers: 1 } });
  assert.equal(nextWave.preparationPlan.politicalArithmeticClaimed, false); assert.ok((nextWave.campaignElapsedSeconds ?? 0) > (political.state.campaignElapsedSeconds ?? 0));
  const politicalAgain = chooseResearch(nextWave, "political-arithmetic"); assert.equal(politicalAgain.ok, true); assert.equal(politicalAgain.state.gold, Math.min(ECONOMY_RULES.goldCap, nextWave.gold + 2));
});

test("Britain six chooses two distinct studies, uses two-wave duration and defaults safely", () => {
  const britain6 = ["locke", "hume", "hobbes", "russell", "bacon", "bentham"].map((characterId, index) => ({ id: `r${index}`, characterId, star: 1 as const, slotId: (`deploy-${index < 3 ? index + 1 : index + 13}`) as GameState["pieces"][number]["slotId"] }));
  const snapshot = createTraitSnapshot(britain6);
  let state = advanceBattle({ ...makeInitialState(), level: 6, pieces: britain6, battle: { ...running([]), traitSnapshot: snapshot, britishLawTriggers: 1 } });
  assert.equal(state.preparationPlan.pendingResearchChoices, 2);
  state = chooseResearch(state, "mechanics").state; assert.equal(state.preparationPlan.pendingResearchChoices, 1);
  assert.equal(chooseResearch(state, "mechanics").ok, false);
  state = chooseResearch(state, "medicine").state;
  assert.deepEqual(state.preparationPlan.activeResearches, [{ choice: "mechanics", wavesRemaining: 2 }, { choice: "medicine", wavesRemaining: 2 }]);
  const afterOne = advanceBattle({ ...state, battle: { ...running([]), traitSnapshot: createTraitSnapshot(britain6, state.preparationPlan) } });
  assert.deepEqual(afterOne.preparationPlan.activeResearches, [{ choice: "mechanics", wavesRemaining: 1 }, { choice: "medicine", wavesRemaining: 1 }]);
  const afterTwo = advanceBattle({ ...afterOne, battle: { ...running([]), traitSnapshot: createTraitSnapshot(britain6, afterOne.preparationPlan) } });
  assert.deepEqual(afterTwo.preparationPlan.activeResearches, []);
  const defaulted = startWave({ ...makeInitialState(), level: 6, pieces: britain6, preparationPlan: { pendingResearchChoices: 2 } });
  assert.equal(defaulted.ok, true); assert.match(defaulted.message, /已自动选择力学、医学/);
});

test("British mechanics and medicine apply their stated next-wave effects to the whole team", () => {
  const british4 = ["locke", "hume", "hobbes", "russell"].map((characterId, index) => ({ id: `study-${index}`, characterId, star: 1 as const, slotId: (`deploy-${index + 13}`) as GameState["pieces"][number]["slotId"] }));
  const mechanic = advanceBattle({ ...makeInitialState(), pieces: british4, preparationPlan: { activeResearches: [{ choice: "mechanics", wavesRemaining: 1 }] }, battle: { ...running([enemy("target", "ordinary", "upper", .2)]), traitSnapshot: createTraitSnapshot(british4, { activeResearches: [{ choice: "mechanics", wavesRemaining: 1 }] }) } });
  const hume = mechanic.pieces.find((piece) => piece.characterId === "hume")!;
  assert.equal(mechanic.battle?.cooldowns[hume.id], Math.round(characterById.hume.combat.attackEvery / 1.15));
  const medicineStart = startWave({ ...makeInitialState(), pieces: british4, preparationPlan: { activeResearches: [{ choice: "medicine", wavesRemaining: 1 }] } });
  assert.equal(medicineStart.ok, true); assert.ok(medicineStart.state.pieces.every((piece) => (piece.shield ?? 0) === Math.round((piece.maxHp ?? 0) * .08)));
});

test("the full 25 philosopher roster includes the six post-foundation characters", () => {
  const expected = ["bacon", "bentham", "deleuze", "derrida", "lacan", "wittgenstein"];
  assert.equal(Object.keys(characterById).length, 25); expected.forEach((id) => assert.ok(characterById[id]));
  assert.deepEqual(expected.map((id) => characterById[id].cost), [1, 2, 3, 3, 4, 4]);
});

test("every roster character has a non-synergy skill cast with an observable result", () => {
  for (const unit of characters) {
    const slot = unit.terrain === "ground" ? "deploy-1" : "deploy-13";
    let progress = progressNear(slot, "upper");
    if (unit.id === "plato") { const point = deploymentPoint(slot); progress = Array.from({ length: 100 }, (_, index) => index / 100).find((value) => { const gap = Math.hypot(point.x - routePoint(value, "upper").x, point.y - routePoint(value, "upper").y); return gap > 11 && gap < 16; })!; }
    const targetKind = unit.id === "russell" ? "armored" : ["kant", "wittgenstein"].includes(unit.id) ? "elite" : "ordinary";
    const caster = { id: `cast-${unit.id}`, characterId: unit.id, star: 1 as const, slotId: slot as GameState["pieces"][number]["slotId"], hp: unit.id === "bentham" ? Math.floor(unit.stats.resolve * .35) : unit.stats.resolve, maxHp: unit.stats.resolve, energy: unit.combat.maxEnergy, maxEnergy: unit.combat.maxEnergy };
    const beforeEnemy = enemy(`target-${unit.id}`, targetKind, "upper", progress);
    const next = advanceBattle({ ...makeInitialState(), pieces: [caster], battle: running([beforeEnemy]) });
    const self = next.pieces[0]!; const liveTarget = next.battle?.enemies.find((candidate) => candidate.id === beforeEnemy.id);
    assert.equal(self.casts, 1, `${unit.id} must consume a real cast, not just attack`);
    const enemyChanged = !liveTarget || liveTarget.hp < beforeEnemy.hp || (next.battle?.statuses ?? []).some((status) => status.targetId === beforeEnemy.id);
    const selfChanged = (self.shield ?? 0) > 0 || (self.blockBonus ?? 0) > 0 || (self.tauntTicks ?? 0) > 0 || (self.invulnerableTicks ?? 0) > 0 || (self.damageReduction ?? 0) > 0 || (self.hp ?? 0) > caster.hp;
    const delayed = (next.battle?.delayedDevices?.length ?? 0) > 0 || Object.keys(next.battle?.psychoanalysis ?? {}).length > 0;
    assert.ok(enemyChanged || selfChanged || delayed, `${unit.id} must produce an observable base-skill result without a synergy`);
  }
});

test("Bacon, Bentham and the remaining late roster skills stay deterministic and bounded", () => {
  let bacon: GameState = { ...makeInitialState(), pieces: [{ id: "bacon", characterId: "bacon", star: 1, slotId: "deploy-13" }], battle: running([enemy("sample", "ordinary", "upper", .2)]) };
  for (let tick = 0; tick < 17; tick += 1) bacon = advanceBattle(bacon);
  assert.ok(bacon.battle?.effects.some((effect) => effect.id.includes("induction")));
  const bentham: GameState = { ...makeInitialState(), pieces: [
    { id: "b", characterId: "bentham", star: 1, slotId: "deploy-1", hp: 200, maxHp: 690, energy: 82, maxEnergy: 82 },
    { id: "ally", characterId: "locke", star: 1, slotId: "deploy-3", hp: 500, maxHp: 610 },
  ], battle: running([enemy("target", "ordinary")]) };
  const balanced = advanceBattle(bentham); const b = balanced.pieces.find((piece) => piece.id === "b")!; const ally = balanced.pieces.find((piece) => piece.id === "ally")!;
  assert.ok(Math.abs((b.hp ?? 0) / (b.maxHp ?? 1) - (ally.hp ?? 0) / (ally.maxHp ?? 1)) < .2);
  const specialists: GameState = { ...makeInitialState(), pieces: [
    { id: "d", characterId: "deleuze", star: 1, slotId: "deploy-13", energy: 90, maxEnergy: 90 }, { id: "r", characterId: "derrida", star: 1, slotId: "deploy-14", energy: 88, maxEnergy: 88 },
    { id: "l", characterId: "lacan", star: 1, slotId: "deploy-15", energy: 96, maxEnergy: 96 }, { id: "w", characterId: "wittgenstein", star: 1, slotId: "deploy-16", energy: 94, maxEnergy: 94 },
  ], battle: running([{ ...enemy("elite", "elite"), shield: 120 }]) };
  const cast = advanceBattle(specialists); assert.equal(cast.battle?.enemies[0]?.shield, 0); assert.ok(Object.keys(cast.battle?.psychoanalysis ?? {}).length <= 1); assert.ok((cast.battle?.eventQueue.length ?? 0) < 20);
});

test("small synergies freeze at wave start and enlightenment agendas apply only at preparation", () => {
  const pieces: GameState["pieces"] = [
    { id: "r", characterId: "rousseau", star: 1, slotId: "deploy-1" }, { id: "l", characterId: "locke", star: 1, slotId: "deploy-3" }, { id: "h", characterId: "hume", star: 1, slotId: "deploy-13" }, { id: "k", characterId: "kant", star: 1, slotId: "deploy-14" },
  ];
  const prepared = chooseEnlightenmentAgendas({ ...makeInitialState(), gold: 10, pieces }, ["market", "education"]); assert.equal(prepared.ok, true);
  const started = startWave(prepared.state); assert.equal(started.state.gold, 11); assert.equal(started.state.xp, 2); assert.equal(started.state.battle?.traitSnapshot?.smallSynergyTiers.enlightenment, 4);
  assert.equal(chooseEnlightenmentAgendas(started.state, ["citizen"]).ok, false);
  const changed = { ...started.state, pieces: started.state.pieces.filter((piece) => piece.id !== "k") }; assert.equal(changed.battle?.traitSnapshot?.smallSynergyTiers.enlightenment, 4);
  const migrated = migrateState({ ...started.state, saveVersion: 4, gold: 17 }); assert.equal(migrated.battle, undefined); assert.equal(migrated.gold, prepared.state.gold); assert.deepEqual(migrated.preparationPlan.enlightenmentAgendas, ["market", "education"]);
  const threeMembers: GameState["pieces"] = pieces.slice(0, 3);
  const defaulted = startWave({ ...makeInitialState(), pieces: threeMembers });
  assert.equal(defaulted.ok, true); assert.deepEqual(defaulted.state.preparationPlan.enlightenmentAgendas, ["citizen"]);
  assert.ok(defaulted.state.pieces.every((piece) => (piece.shield ?? 0) === Math.round((piece.maxHp ?? 0) * .08)));
});

test("dialectic, contract, phenomenology, happiness and logic analysis obey their non-recursive guards", () => {
  const dialecticPieces: GameState["pieces"] = [
    { id: "s", characterId: "socrates", star: 1, slotId: "deploy-1", energy: 70, maxEnergy: 70 }, { id: "p", characterId: "plato", star: 1, slotId: "deploy-3", energy: 80, maxEnergy: 80 }, { id: "g", characterId: "hegel", star: 1, slotId: "deploy-13", energy: 95, maxEnergy: 95 },
  ];
  let dialectic: GameState = { ...makeInitialState(), pieces: dialecticPieces, battle: { ...running([enemy("target", "elite", "upper", .2)]), traitSnapshot: createTraitSnapshot(dialecticPieces), eventQueue: [
    { id: "dialectic-s", kind: "pause", sourceId: "s", targetKind: "enemy", targetId: "target", duration: .5, sequence: 1 },
    { id: "dialectic-p", kind: "pause", sourceId: "p", targetKind: "enemy", targetId: "target", duration: .5, sequence: 2 },
    { id: "dialectic-g", kind: "damage", sourceId: "g", targetKind: "enemy", targetId: "target", amount: 1, sequence: 3 },
  ] } };
  dialectic = advanceBattle(dialectic); assert.ok((dialectic.battle?.enemies[0]?.contradictionImmuneUntil ?? 0) > 0); assert.ok((dialectic.battle?.statuses ?? []).some((status) => status.kind === "slow"));
  const contractPieces: GameState["pieces"] = [{ id: "r", characterId: "rousseau", star: 1, slotId: "deploy-1", hp: 600, maxHp: 680 }, { id: "l", characterId: "locke", star: 1, slotId: "deploy-2", hp: 610, maxHp: 610 }];
  const contracted = advanceBattle({ ...makeInitialState(), pieces: contractPieces, battle: { ...running([enemy("pressure", "ordinary")]), traitSnapshot: createTraitSnapshot(contractPieces), eventQueue: [{ id: "hit", kind: "damage", targetKind: "ally", targetId: "r", amount: 100, sequence: 1 }] } });
  assert.ok((600 - (contracted.pieces.find((piece) => piece.id === "r")?.hp ?? 600)) < 100); assert.ok((610 - (contracted.pieces.find((piece) => piece.id === "l")?.hp ?? 610)) > 0);
  const happyPieces: GameState["pieces"] = [{ id: "e", characterId: "epicurus", star: 1, slotId: "deploy-1", hp: 570, maxHp: 570 }, { id: "b", characterId: "bentham", star: 1, slotId: "deploy-3", hp: 680, maxHp: 690 }];
  const happy = advanceBattle({ ...makeInitialState(), pieces: happyPieces, battle: { ...running([enemy("heal-target", "ordinary")]), traitSnapshot: createTraitSnapshot(happyPieces), eventQueue: [{ id: "overheal", kind: "heal", targetKind: "ally", targetId: "e", amount: 100, sequence: 1 }] } }); const happinessShield = happy.pieces.find((piece) => piece.id === "e")?.shield ?? 0; assert.ok(happinessShield > 0 && happinessShield <= 570 * .15);
  const phenomenologyPieces: GameState["pieces"] = [{ id: "hu", characterId: "husserl", star: 1, slotId: "deploy-13", hp: 20, maxHp: 600 }, { id: "sa", characterId: "sartre", star: 1, slotId: "deploy-14", hp: 600, maxHp: 600 }];
  const suspended = advanceBattle({ ...makeInitialState(), pieces: phenomenologyPieces, battle: { ...running([enemy("fatal", "ordinary")]), traitSnapshot: createTraitSnapshot(phenomenologyPieces), phenomenologyCharges: 1, eventQueue: [{ id: "fatal-hit", kind: "damage", targetKind: "ally", targetId: "hu", amount: 100, sequence: 1 }] } }); const husserl = suspended.pieces.find((piece) => piece.id === "hu"); assert.equal(husserl?.hp, 1); assert.equal(husserl?.phenomenologyUsed, true); assert.equal(suspended.battle?.phenomenologyCharges, 0);
  const logicPieces: GameState["pieces"] = [{ id: "ar", characterId: "aristotle", star: 1, slotId: "deploy-13" }, { id: "wi", characterId: "wittgenstein", star: 1, slotId: "deploy-14" }];
  const proposition = advanceBattle({ ...makeInitialState(), pieces: logicPieces, battle: { ...running([enemy("claim", "elite")]), traitSnapshot: createTraitSnapshot(logicPieces), eventQueue: [{ id: "logic-one", kind: "damage", sourceId: "ar", targetKind: "enemy", targetId: "claim", amount: 1, sequence: 1 }, { id: "logic-two", kind: "silence", sourceId: "wi", targetKind: "enemy", targetId: "claim", duration: 1, sequence: 2 }] } }); assert.ok((proposition.battle?.enemies[0]?.propositionUntil ?? 0) > 0); assert.ok((proposition.battle?.statuses ?? []).some((status) => status.kind === "no-shield"));
  const derivedOnly = advanceBattle({ ...makeInitialState(), pieces: logicPieces, battle: { ...running([enemy("derived-claim", "elite")]), traitSnapshot: createTraitSnapshot(logicPieces), eventQueue: [{ id: "derived-one", kind: "damage", sourceId: "ar", targetKind: "enemy", targetId: "derived-claim", amount: 1, derivedEffect: true, sequence: 1 }, { id: "derived-two", kind: "silence", sourceId: "wi", targetKind: "enemy", targetId: "derived-claim", duration: 1, derivedEffect: true, sequence: 2 }] } }); assert.equal(derivedOnly.battle?.enemies[0]?.propositionUntil, undefined);
  const logicThree: GameState["pieces"] = [...logicPieces, { id: "ru", characterId: "russell", star: 3, slotId: "deploy-15" }]; const durableMother = { ...enemy("mother", "boss"), hp: 9000, maxHp: 9000 }; const atoms = advanceBattle({ ...makeInitialState(), pieces: logicThree, battle: { ...running([durableMother]), traitSnapshot: createTraitSnapshot(logicThree), eventQueue: [{ id: "atomize", kind: "split", sourceId: "ru", targetKind: "enemy", targetId: "mother", amount: 4, sequence: 1 }] } }); assert.equal(atoms.battle?.enemies.filter((unit) => unit.isAtom).length, 4); assert.equal(atoms.battle?.statuses.filter((status) => status.kind === "slow").length, 4);
});
