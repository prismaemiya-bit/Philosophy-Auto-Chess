"use client";

/* eslint-disable @next/next/no-img-element -- Stable runtime art URLs are already resized WebP assets; native img preserves the existing drag-card owner. */
/* eslint-disable @next/next/no-html-link-for-pages -- UI mode links intentionally reload through server-side platform negotiation while preserving same-origin local saves. */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { BOSS_PHASES_BY_KIND, advanceBattle, battleOf, bossPhasesFor, effectiveAttackRange, enemyTemplates, isBossKind, isFinalBossKind, MAX_WAVES, philosopherKingEffectMultiplier, restartCurrentWave, retryWave, startWave, type BattleState, type Enemy } from "./battle";
import { characterById, characters } from "./characters";
import { BENCH_SLOTS, DEPLOY_SLOTS, ECONOMY_RULES, THRONE_SLOT, UnsupportedSaveVersionError, buy, chooseEnlightenmentAgendas, chooseRealityStance, chooseReformationReward, claimPendingReformationReward, confirmNormalEvent, effectiveInterestForGold, gainXp, getFreeRefreshesAvailable, hasPhilosopherKingUnlock, isDeploySlot, isFieldedSlot, isThroneSlot, liberalFullSale, makeInitialState, MAX_LEVEL, maxDeployForLevel, migrateState, move, normalizeProgress, reformistReplace, refresh, sell, serializeGameState, shopOddsForLevel, toggleShopFreeze, useFreeRefresh as consumeFreeRefresh, type BalanceWaveReport, type GameState, type Piece, type SlotId, xpRequired } from "./engine";
import { chooseResearch, updatePreparationPlan } from "./engine";
import { encounterDefinition, waveDefinition } from "./waves";
import { deploymentPoint, distance, MAP_ASPECT_RATIO, revolutionNodes, ROYAL_BARRIER_POINT, routePoint, slotTerrain } from "./positions";
import { MapArt } from "./MapArt";
import { characterAssets, enemyAssets } from "./assets";
import { BattleInspector } from "./BattleInspector";
import { unitBuffs, UnitCombatStatus, WaveToast } from "./CombatStatus";
import { createTraitSnapshot, type EnlightenmentAgenda } from "./combat-core";
import { effectiveMaxDeploy, historicalEventDefinitionById, historicalStanceDefinitionById, historicalStanceSummaryForEvent, pendingHistoricalDecision, resolveEconomy, resolveWarMachinePlan, warMachineRoutesForWave, type HistoricalStanceId } from "./historical-events";
import { UnsupportedProfileVersionError, makeInitialProfile, migrateProfile, missionDefinitions, missionProgress, observeGameState, recordProfileAction, recordRunStarted, serializeProfile, type MissionId, type PlayerProfile } from "./profile";
import { summarizeVictoryRun } from "./victory-summary";
import { AUDIO_SETTINGS_KEY, DEFAULT_AUDIO_SETTINGS, MusicTrackPlayer, SoundEffectPlayer, battleSoundCueForEvent, migrateAudioSettings, musicTrackForScene, primeBrowserAudio, serializeAudioSettings, type AudioSettings, type SoundCueId } from "./audio";
import { LandscapeGuard, requestMobileLandscape } from "./LandscapeGuard";
import releaseInfo from "../../release-info.json";

const SAVE_KEY = "idea-garrison-v01-save-v6";
const RELEASE_EYEBROW = `PHILOSOPHY AUTO CHESS / ${releaseInfo.displayVersion.toUpperCase()}`;
const MANUAL_SAVE_KEY = `${SAVE_KEY}:manual`;
const IMPORT_BACKUP_KEY = `${SAVE_KEY}:pre-import`;
const TUTORIAL_KEY = "philosophy-auto-chess-tutorial-v1";
const PROFILE_KEY = "philosophy-auto-chess-profile-v1";
const LEGACY_SAVE_KEYS = ["idea-garrison-day-three", "idea-garrison-day-two", "idea-garrison-day-one"];
const TUTORIAL_STEPS = [
  { id: "shop", title: "先从理念商店购买", detail: "点击角色卡即可购买。角色先进入备战区；同名同阶三名会自动合成。" },
  { id: "bench", title: "备战区保存未部署角色", detail: "这里不占人口。拖动或先点选角色，再放到地图高亮位置。" },
  { id: "deploy", title: "部署到地图", detail: "地面与高台角色只能放入对应位置；拖动时的高亮就是合法落点。" },
  { id: "population", title: "人口决定上场数量", detail: "“人口 0/2”表示已部署 0 名、上限 2 名。等级提升会提高人口上限。" },
  { id: "resonance", title: "共鸣来自已部署阵容", detail: "左侧始终显示当前相关羁绊。点击条目可查看档位与准备阶段选择。" },
  { id: "wave", title: "准备好后开始波次", detail: "开波前会提示三路敌人入口。战斗自动进行，阵容在本波内锁定。" },
  { id: "xp", title: "购买经验提升等级", detail: "从第二波准备阶段起，4 金币购买 4 经验；升级后人口上限与商店概率提高。" },
] as const;
type PreparationUiAction = { kind: "plan"; patch: Record<string, unknown> } | { kind: "research"; choice: "mechanics" | "medicine" | "political-arithmetic" };
const slotLabel = (slot: string) => slot.replace("bench-", "备").replace("deploy-", "署");
const OwnedPieceActionContext = createContext<{ canLiberalRefund: boolean; refund: (pieceId: string) => void }>({ canLiberalRefund: false, refund: () => undefined });

export default function GameClient() {
  const [started, setStarted] = useState(false); const [state, setState] = useState<GameState>(makeInitialState); const [notice, setNotice] = useState("准备阶段：部署守军并手动开启第一波。"); const [dragged, setDragged] = useState<string | null>(null); const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null); const [selectedEnemyId, setSelectedEnemyId] = useState<string | null>(null); const [selectedSynergy, setSelectedSynergy] = useState<string | null>(null); const [paused, setPaused] = useState(false); const [speed, setSpeed] = useState<1 | 2>(1); const [rankUp, setRankUp] = useState<string | null>(null); const [settingsOpen, setSettingsOpen] = useState(false); const [tutorialStep, setTutorialStep] = useState<number | null>(null);
  const [profile, setProfile] = useState<PlayerProfile>(makeInitialProfile);
  const [newMissionIds, setNewMissionIds] = useState<MissionId[]>([]);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const [audioReady, setAudioReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [hasRunSave, setHasRunSave] = useState(false);
  const [hasImportBackup, setHasImportBackup] = useState(false);
  const [missionsOpen, setMissionsOpen] = useState(false);
  const [operationDockOpen, setOperationDockOpen] = useState(true);
  const [mobileShopOpen, setMobileShopOpen] = useState(false);
  const [topInfoOpen, setTopInfoOpen] = useState<"gold" | "population" | "wave" | "core" | null>(null);
  const intelOpen = false;
  const [devToolsEnabled, setDevToolsEnabled] = useState(false);
  const [mapDebug, setMapDebug] = useState(false);
  const [mapScenario, setMapScenario] = useState<"normal" | "merge" | "split" | "max" | "core">("normal");
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [waveCue, setWaveCue] = useState<{ wave: number; sequence: number } | null>(null);
  const [shopFeedback, setShopFeedback] = useState<{ kind: "xp" | "refresh"; label: string; sequence: number } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingMobileSaleId, setPendingMobileSaleId] = useState<string | null>(null);
  const stateRef = useRef(state);
  const promptedPreparationRef = useRef(new Set<string>());
  const automaticSaveBlockedRef = useRef(false);
  const profileSaveBlockedRef = useRef(false);
  const lastAutomaticSaveRef = useRef<string | null>(null);
  const feedbackSequenceRef = useRef(0);
  const previousWaveRef = useRef(state.wave);
  const completedMissionsRef = useRef(profile.completedMissionIds);
  const importSaveInputRef = useRef<HTMLInputElement | null>(null);
  const soundPlayerRef = useRef(new SoundEffectPlayer(DEFAULT_AUDIO_SETTINGS));
  const musicPlayerRef = useRef(new MusicTrackPlayer(DEFAULT_AUDIO_SETTINGS));
  const battle = battleOf(state);
  const requestedMusicTrack = musicTrackForScene({
    started,
    battleStatus: battle.status,
    hasBoss: battle.enemies.some((enemy) => isBossKind(enemy.kind) || enemy.kind === "war-machine"),
  });
  const historicalDecision = pendingHistoricalDecision(state.historicalEvents, state.wave);
  const historicalEvent = state.historicalEvents.eventId ? historicalEventDefinitionById.get(state.historicalEvents.eventId) : undefined;
  const historicalStance = state.historicalEvents.selectedStanceId ? historicalStanceDefinitionById.get(state.historicalEvents.selectedStanceId) : undefined;
  const populationCap = effectiveMaxDeploy(state.level, state.historicalEvents);
  const historicalEconomy = resolveEconomy(state.historicalEvents, ECONOMY_RULES.baseIncome, ECONOMY_RULES.maxInterest);
  const freeRefreshes = getFreeRefreshesAvailable(state);
  const canReformistReplace = state.historicalEvents.selectedStanceId === "stance:reformism" && !state.historicalEvents.waveFlags.reformistReplacementUsed && battle.status !== "running";
  const canLiberalRefund = state.historicalEvents.selectedStanceId === "stance:liberalism" && !state.historicalEvents.waveFlags.liberalFullSaleUsed && battle.status !== "running";
  const dangerLanes = new Set(battle.enemies.filter((enemy) => enemy.progress >= .68).map((enemy) => enemy.lane)); const coreThreat = battle.enemies.some((enemy) => enemy.progress >= .84);
  const draggedUnit = dragged ? state.pieces.find((piece) => piece.id === dragged) : undefined;
  // Drag and click-to-place deliberately share the exact same terrain source.
  // This prevents a highlighted tile ever disagreeing with move(...).
  const activePiece = draggedUnit ?? state.pieces.find((piece) => piece.id === selectedPieceId);
  const activeTerrain = activePiece && battle.status !== "running" ? characterById[activePiece.characterId]?.terrain : undefined;
  useEffect(() => { const timer = window.setTimeout(() => { setHasImportBackup(Boolean(localStorage.getItem(IMPORT_BACKUP_KEY))); const sourceKey = [SAVE_KEY, ...LEGACY_SAVE_KEYS].find((key) => localStorage.getItem(key)); const raw = sourceKey ? localStorage.getItem(sourceKey) : null; if (raw) { try { const saved = migrateState(JSON.parse(raw)); setState(saved); setHasRunSave(true); setNotice(sourceKey === SAVE_KEY ? "已找到上次的荣耀记录，可从主界面继续。" : "旧版存档已安全迁移，可从主界面继续。"); } catch (error) { automaticSaveBlockedRef.current = true; const warning = error instanceof UnsupportedSaveVersionError ? "检测到由更新版本创建的存档；本版本已保留原文件且不会覆盖，请使用更新版本继续。" : "存档无法读取；原文件已保留且不会覆盖，可重新开始后在设置中明确清除。"; setLoadWarning(warning); setNotice(warning); } } }, 0); return () => window.clearTimeout(timer); }, []);
  useEffect(() => { const timer = window.setTimeout(() => { try { const raw = localStorage.getItem(PROFILE_KEY); if (raw) setProfile(migrateProfile(JSON.parse(raw))); } catch (error) { if (error instanceof UnsupportedProfileVersionError) profileSaveBlockedRef.current = true; setProfile(makeInitialProfile()); } finally { setProfileReady(true); } }, 0); return () => window.clearTimeout(timer); }, []);
  useEffect(() => { const timer = window.setTimeout(() => { try { const raw = localStorage.getItem(AUDIO_SETTINGS_KEY); if (raw) setAudioSettings(migrateAudioSettings(JSON.parse(raw))); } catch { setAudioSettings(DEFAULT_AUDIO_SETTINGS); } finally { setAudioReady(true); } }, 0); return () => window.clearTimeout(timer); }, []);
  useEffect(() => {
    soundPlayerRef.current.setSettings(audioSettings);
    musicPlayerRef.current.setSettings(audioSettings);
    if (audioReady) localStorage.setItem(AUDIO_SETTINGS_KEY, serializeAudioSettings(audioSettings));
  }, [audioReady, audioSettings]);
  useEffect(() => {
    if (!audioReady) return;
    musicPlayerRef.current.setTrack(requestedMusicTrack);
  }, [audioReady, requestedMusicTrack]);
  useEffect(() => {
    const musicPlayer = musicPlayerRef.current;
    const unlockAudio = () => { primeBrowserAudio(); musicPlayer.resume(); };
    window.addEventListener("pointerdown", unlockAudio, { capture: true });
    window.addEventListener("keydown", unlockAudio, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio, { capture: true });
      window.removeEventListener("keydown", unlockAudio, { capture: true });
      musicPlayer.stop();
    };
  }, []);
  useEffect(() => { if (started) window.scrollTo(0, 0); }, [started]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => {
    const previous = new Set(completedMissionsRef.current);
    const gained = profile.completedMissionIds.filter((id) => !previous.has(id));
    completedMissionsRef.current = profile.completedMissionIds;
    if (started && gained.length > 0) setNewMissionIds((current) => [...new Set([...current, ...gained])]);
  }, [profile.completedMissionIds, started]);
  useEffect(() => {
    if (!profileReady || profileSaveBlockedRef.current) return;
    const timer = window.setTimeout(() => setProfile((current) => {
        const next = observeGameState(current, state);
        if (serializeProfile(next) === serializeProfile(current)) return current;
        localStorage.setItem(PROFILE_KEY, serializeProfile(next));
        return next;
      }), 0);
    return () => window.clearTimeout(timer);
  }, [profileReady, state]);
  useEffect(() => {
    if (state.wave !== previousWaveRef.current) {
      previousWaveRef.current = state.wave;
      setOperationDockOpen(true);
      setMobileShopOpen(false);
    }
  }, [state.wave]);
  useEffect(() => {
    if (tutorialStep === null) return;
    const timer = window.setTimeout(() => {
      if (TUTORIAL_STEPS[tutorialStep]?.id === "shop" || TUTORIAL_STEPS[tutorialStep]?.id === "bench") setOperationDockOpen(true);
      if (TUTORIAL_STEPS[tutorialStep]?.id === "shop") setMobileShopOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tutorialStep]);
  useEffect(() => {
    if (!started || tutorialStep !== null || localStorage.getItem(TUTORIAL_KEY) === "complete") return;
    const timer = window.setTimeout(() => setTutorialStep(0), 0);
    return () => window.clearTimeout(timer);
  }, [started, tutorialStep]);
  useEffect(() => {
    if (!started || automaticSaveBlockedRef.current) return;
    const serialized = serializeGameState(state);
    if (serialized === lastAutomaticSaveRef.current) return;
    localStorage.setItem(SAVE_KEY, serialized);
    setHasRunSave(true);
    lastAutomaticSaveRef.current = serialized;
  }, [state, started]);
  useEffect(() => {
    if (!started) return;
    const persist = () => {
      if (automaticSaveBlockedRef.current) return;
      const serialized = serializeGameState(stateRef.current);
      if (serialized === lastAutomaticSaveRef.current) return;
      localStorage.setItem(SAVE_KEY, serialized);
      lastAutomaticSaveRef.current = serialized;
    };
    window.addEventListener("pagehide", persist);
    return () => window.removeEventListener("pagehide", persist);
  }, [started]);
  useEffect(() => { if (!rankUp) return; const timer = window.setTimeout(() => setRankUp(null), 900); return () => window.clearTimeout(timer); }, [rankUp]);
  useEffect(() => {
    if (!waveCue) return;
    const timer = window.setTimeout(() => {
      const result = startWave(stateRef.current);
      setWaveCue(null);
      setState(result.state);
      setPaused(false);
      setNotice(result.message);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [waveCue]);
  useEffect(() => { if (!shopFeedback) return; const timer = window.setTimeout(() => setShopFeedback(null), 820); return () => window.clearTimeout(timer); }, [shopFeedback]);
  useEffect(() => { if (!pendingMobileSaleId) return; const timer = window.setTimeout(() => setPendingMobileSaleId(null), 2400); return () => window.clearTimeout(timer); }, [pendingMobileSaleId]);
  useEffect(() => { const timer = window.setTimeout(() => { const query = new URLSearchParams(window.location.search); const local = ["localhost", "127.0.0.1"].includes(window.location.hostname); setDevToolsEnabled(import.meta.env.DEV && local && (query.get("devtools") === "1" || localStorage.getItem("idea-garrison-devtools") === "1")); }, 0); return () => window.clearTimeout(timer); }, []);
  useEffect(() => {
    if (battle.status === "running" || battle.status === "complete" || battle.status === "defeat") return;
    const snapshot = createTraitSnapshot(state.pieces, state.preparationPlan);
    const prompt = (state.preparationPlan.pendingResearchChoices ?? 0) > 0
      ? "britain"
      : snapshot.factionTiers.france >= 2 && !state.preparationPlan.revolutionNodeId
        ? "france"
        : snapshot.factionTiers.greece >= 2 && !state.preparationPlan.rostrumId
          ? "greece"
          : snapshot.smallSynergyTiers.enlightenment >= 3 && (state.preparationPlan.enlightenmentAgendas?.length ?? 0) < (snapshot.smallSynergyTiers.enlightenment >= 4 ? 2 : 1)
            ? "enlightenment"
            : null;
    if (!prompt) return;
    const promptKey = prompt === "britain" ? `britain:${state.preparationPlan.researchAwardedWave ?? state.wave}` : prompt;
    if (promptedPreparationRef.current.has(promptKey)) return;
    promptedPreparationRef.current.add(promptKey);
    const timer = window.setTimeout(() => setSelectedSynergy((current) => current ?? prompt), 0);
    return () => window.clearTimeout(timer);
  }, [battle.status, state.pieces, state.preparationPlan, state.wave]);
  useEffect(() => {
    const applyPreparation = (event: Event) => {
      const action = (event as CustomEvent<PreparationUiAction>).detail;
      if (!action) return;
      setState((current) => {
        const result = action.kind === "research"
          ? chooseResearch(current, action.choice)
          : updatePreparationPlan(current, action.patch);
        setNotice(result.message);
        return result.state;
      });
    };
    window.addEventListener("idea-garrison:preparation", applyPreparation);
    return () => window.removeEventListener("idea-garrison:preparation", applyPreparation);
  }, []);
  useEffect(() => { if (battle.status !== "running" || paused) return; const timer = window.setInterval(() => setState((current) => speed === 2 ? advanceBattle(advanceBattle(current)) : advanceBattle(current)), 240); return () => window.clearInterval(timer); }, [battle.status, paused, speed]);
  useEffect(() => {
    if (historicalDecision === "event") soundPlayerRef.current.emit("history.event", `event:${state.historicalEvents.seed}:${state.historicalEvents.eventId ?? state.wave}`);
  }, [historicalDecision, state.historicalEvents.eventId, state.historicalEvents.seed, state.wave]);
  useEffect(() => {
    for (const enemy of battle.enemies) if (isBossKind(enemy.kind) || enemy.kind === "war-machine") soundPlayerRef.current.emit("boss.arrival", `enemy:${enemy.id}`);
    const phase = battle.bossPhaseLog?.at(-1); if (phase) soundPlayerRef.current.emit("boss.phase", `phase:${phase.id}:${phase.triggeredAt}`);
  }, [battle.bossPhaseLog, battle.enemies]);
  useEffect(() => {
    for (const effect of battle.effects) {
      const cue = battleSoundCueForEvent(effect);
      if (cue) soundPlayerRef.current.emit(cue, effect.id);
    }
  }, [battle.effects]);
  useEffect(() => {
    if (battle.status === "victory" && battle.summary?.success) soundPlayerRef.current.emit("result.wave-clear", `wave-clear:${battle.summary.wave}:${battle.summary.elapsedTicks}`);
    if (battle.status === "complete" && battle.summary?.success) soundPlayerRef.current.emit("result.victory", `victory:${state.historicalEvents.seed}`);
    if (battle.status === "defeat") soundPlayerRef.current.emit("result.defeat", `defeat:${state.historicalEvents.seed}:${battle.summary?.wave ?? state.wave}`);
  }, [battle.status, battle.summary, state.historicalEvents.seed, state.wave]);
  const unitsBySlot = useMemo(() => Object.fromEntries(state.pieces.map((piece) => [piece.slotId, piece])), [state.pieces]); const selectedPiece = state.pieces.find((piece) => piece.id === selectedPieceId); const selectedEnemy = battle.enemies.find((enemy) => enemy.id === selectedEnemyId); const selectedTarget = selectedPiece ? [...battle.enemies].filter((enemy) => distance(deploymentPoint(selectedPiece.slotId), routePoint(enemy.progress, enemy.lane)) <= effectiveAttackRange(selectedPiece)).sort((a, b) => b.progress - a.progress)[0] : undefined;
  const firstEmptyBenchSlot = BENCH_SLOTS.find((slot) => !unitsBySlot[slot]);
  const throneUnlocked = hasPhilosopherKingUnlock(state.pieces); const philosopherKing = unitsBySlot[THRONE_SLOT]; const royalBarrier = battle.structures?.find((structure) => structure.kind === "royal-barrier");
  const act = (result: ReturnType<typeof buy>) => { stateRef.current = result.state; setState(result.state); if (result.message) setNotice(result.message); if (result.message.includes("合成")) setRankUp("三合一 · 阶位提升"); };
  const actCurrent = (action: (current: GameState) => ReturnType<typeof buy>) => act(action(stateRef.current));
  const sound = (cueId: SoundCueId, occurrence: string) => soundPlayerRef.current.emit(cueId, occurrence);
  const purchase = (shopIndex: number) => { const result = buy(stateRef.current, shopIndex); act(result); if (result.ok) sound(result.message.includes("合成") ? "ui.merge" : "ui.purchase", `purchase:${++feedbackSequenceRef.current}`); };
  const sellPiece = (pieceId?: string) => {
    if (!pieceId) { setNotice("先选择一名棋子，或把棋子拖入出售区。"); return; }
    const result = sell(stateRef.current, pieceId); act(result); if (result.ok) sound("ui.sell", `sell:${++feedbackSequenceRef.current}`); setSelectedPieceId(null); setPendingMobileSaleId(null); setDragged(null);
  };
  const drop = (slot: SlotId) => { if (!dragged) return; const source = stateRef.current.pieces.find((piece) => piece.id === dragged); if (battle.status === "running" && (!source || isFieldedSlot(source.slotId) || isFieldedSlot(slot))) setNotice("战斗中只能整理备战席，不能调整战场阵容。"); else { const result = move(stateRef.current, dragged, slot); act(result); if (result.ok) sound("ui.deploy", `move:${++feedbackSequenceRef.current}`); } setDragged(null); };
  const invalidDrop = () => { if (dragged) { setNotice("该位置不可部署此单位。请拖到高亮格。棋子未移动。"); setDragged(null); } };
  const sellDragged = () => sellPiece(dragged ?? undefined);
  const moveSelected = (slot: SlotId) => {
    if (!selectedPiece) return;
    if (battle.status === "running" && (isFieldedSlot(selectedPiece.slotId) || isFieldedSlot(slot))) { setNotice("战斗中只能整理备战席，不能调整战场阵容。"); return; }
    const result = move(stateRef.current, selectedPiece.id, slot); act(result); if (result.ok) sound("ui.deploy", `move:${++feedbackSequenceRef.current}`); setSelectedPieceId(null); setPendingMobileSaleId(null);
  };
  const selectPiece = (pieceId: string) => { setPendingMobileSaleId(null); setSelectedEnemyId(null); setSelectedPieceId(pieceId); };
  const withdrawSelected = () => {
    if (!selectedPiece || !isFieldedSlot(selectedPiece.slotId)) { setNotice("请先选择战场上的棋子。"); return; }
    if (!firstEmptyBenchSlot) { setNotice("备战区已满，无法撤回该棋子。"); return; }
    moveSelected(firstEmptyBenchSlot);
  };
  const confirmMobileSale = () => {
    if (!selectedPiece) { setNotice("请先选择要出售的棋子。"); return; }
    if (pendingMobileSaleId !== selectedPiece.id) {
      setPendingMobileSaleId(selectedPiece.id);
      setNotice(`再次点击“确认出售”以出售 ${characterById[selectedPiece.characterId]?.name ?? "该棋子"}。`);
      return;
    }
    sellPiece(selectedPiece.id);
  };
  const beginWave = () => { if (waveCue) return; if (historicalDecision) { setNotice(state.wave === 3 ? "请先完成历史事件选择。" : "请先确定意识形态。"); return; } const sequence = ++feedbackSequenceRef.current; setPaused(true); setOperationDockOpen(false); setMobileShopOpen(false); setWaveCue({ wave: state.wave, sequence }); setNotice(`第 ${state.wave} 波路线确认中……`); sound("ui.wave-start", `wave:${state.wave}:${sequence}`); };
  const updateProfile = (update: (current: PlayerProfile) => PlayerProfile) => setProfile((current) => { const next = update(current); if (!profileSaveBlockedRef.current) localStorage.setItem(PROFILE_KEY, serializeProfile(next)); return next; });
  const buyExperience = () => { const previousLevel = state.level; const result = gainXp(state); act(result); if (result.ok) { if (result.state.level > previousLevel) sound("ui.level-up", `level:${result.state.level}:${++feedbackSequenceRef.current}`); updateProfile((current) => recordProfileAction(current, "buy-xp")); setShopFeedback({ kind: "xp", label: result.state.level > previousLevel ? `理念阶位 ${result.state.level} · 人口上限提升` : `经验 +4 · ${result.state.xp}/${xpRequired(result.state.level)}`, sequence: ++feedbackSequenceRef.current }); } };
  const refreshMarket = () => {
    const useIndustrialRefresh = getFreeRefreshesAvailable(stateRef.current) > 0;
    const result = useIndustrialRefresh ? consumeFreeRefresh(stateRef.current) : refresh(stateRef.current);
    act(result);
    if (result.ok) {
      sound("ui.refresh", `refresh:${++feedbackSequenceRef.current}`);
      if (!useIndustrialRefresh) updateProfile((current) => recordProfileAction(current, "refresh"));
      setShopFeedback({ kind: "refresh", label: "", sequence: ++feedbackSequenceRef.current });
    }
  };
  const freezeMarket = () => { const result = toggleShopFreeze(stateRef.current); act(result); if (result.ok) sound("ui.freeze", `freeze:${result.state.shopFrozen}:${++feedbackSequenceRef.current}`); };
  const claimReformationReward = () => actCurrent(claimPendingReformationReward);
  const replaceShopSlot = (shopIndex: number) => actCurrent((current) => reformistReplace(current, shopIndex));
  const sellForPaidCost = (pieceId: string) => { const result = liberalFullSale(stateRef.current, pieceId); act(result); if (result.ok) sound("ui.sell", `liberal-sell:${++feedbackSequenceRef.current}`); if (selectedPieceId === pieceId) setSelectedPieceId(null); };
  const chooseIdeology = (stanceId: HistoricalStanceId) => { const result = chooseRealityStance(stateRef.current, stanceId); act(result); if (result.ok) sound("history.ideology", `ideology:${stateRef.current.historicalEvents.seed}:${stanceId}`); };
  const spawnDebugEncounter = (wave: 5 | 10, requested: "elite" | "boss") => { const kind = requested === "elite" ? "cave-boss" as const : "boss" as const; setState((current) => { const debugPieces = current.pieces.some((piece) => isFieldedSlot(piece.slotId)) ? current.pieces : debugLineup(["fichte", "hume"]); const begun = startWave({ ...current, wave, level: Math.max(current.level, 2), pieces: debugPieces, battle: undefined }); if (!begun.ok || !begun.state.battle) { setNotice(begun.message); return current; } setNotice(`开发遭遇已生成：${kind === "boss" ? "W10 绝对精神" : "W5 洞穴之影"}。`); return { ...begun.state, battle: { ...begun.state.battle, enemies: [], spawnRemaining: [kind], spawned: 0 } }; }); };
  const applyMapFormation = (scenario: "merge" | "split" | "max") => { setPaused(true); setSelectedSynergy(null); setMapScenario(scenario); setState((current) => ({ ...current, level: 8, xp: 0, pieces: debugFormation(scenario), battle: undefined })); setNotice(scenario === "split" ? "地图校准：八人分守 A / B / C。" : scenario === "max" ? "地图校准：最大棋子视觉包络。" : "地图校准：八人集中 A/B 汇合区。"); };
  const spawnMapStress = () => { setPaused(true); setSelectedSynergy(null); setMapScenario("core"); setState((current) => { const pieces = debugFormation("core"); const begun = startWave({ ...current, wave: 10, level: 8, pieces, battle: undefined }); if (!begun.ok || !begun.state.battle) return current; const samples: Array<[Enemy["kind"], Enemy["lane"], number]> = [["ordinary", "upper", .78], ["armored", "lower", .8], ["elite", "side", .8], ["boss", "upper", .87]]; const enemies = samples.map(([kind, lane, progress], index) => { const template = enemyTemplates[kind]; return { id: `map-stress-${kind}-${index}`, kind, lane, sourceRouteId: lane, progress, hp: template.maxHp, maxHp: template.maxHp, weight: template.weight, shield: 0, energy: 0, maxEnergy: 100, rewardValue: template.reward, coreDamageValue: template.coreDamage, bossPhasesTriggered: kind === "boss" ? [] : undefined }; }); const effects: BattleState["effects"] = [{ id: "map-stress-beam", type: "skill", slotId: "deploy-20", enemyId: "map-stress-boss-3", amount: 0, age: 0 }, { id: "map-stress-core", type: "core", enemyId: "map-stress-elite-2", amount: 8, age: 0 }]; setNotice("核心前压力场景：Boss、阻挡位、远程位与技能效果同屏，战斗已暂停。"); return { ...begun.state, battle: { ...begun.state.battle, enemies, effects, spawnRemaining: [], spawned: enemies.length } }; }); };
  const spawnAbsoluteFragments = () => { setPaused(true); setSelectedSynergy(null); setMapScenario("core"); setState((current) => { const pieces = debugFormation("core"); const begun = startWave({ ...current, wave: 10, level: 8, pieces, battle: undefined }); if (!begun.ok || !begun.state.battle) return current; const template = enemyTemplates.boss; const enemies: Enemy[] = Array.from({ length: 3 }, (_, index) => ({ id: `absolute-spirit-atom-${index + 1}`, kind: "boss", lane: "upper", sourceRouteId: "upper", progress: .82 - index * .025, hp: template.maxHp / 3, maxHp: template.maxHp / 3, weight: 1, shield: 0, energy: 0, maxEnergy: 100, rewardValue: index === 0 ? template.reward : 0, coreDamageValue: Math.floor(template.coreDamage / 3) + (index < template.coreDamage % 3 ? 1 : 0), bossPhasesTriggered: [], atomicGroupId: "absolute-spirit", isAtom: true })); setNotice("绝对精神已被逻辑原子化：三个分有各自保留 Boss 纹章与生命。"); return { ...begun.state, battle: { ...begun.state.battle, enemies, effects: [], spawnRemaining: [], spawned: enemies.length } }; }); };
  const retry = () => { const result = retryWave(state); setState(result.state); setPaused(false); setSelectedSynergy(null); setNotice(result.message); };
  const restartWaveFromSettings = () => { const result = restartCurrentWave(state); setState(result.state); setPaused(false); setSelectedPieceId(null); setSelectedEnemyId(null); setDragged(null); setNotice(result.message); };
  const saveManually = () => { localStorage.setItem(MANUAL_SAVE_KEY, serializeGameState(state)); setNotice(battle.status === "running" ? "已保存本波开战前状态；再次进入将从准备阶段继续。" : "已写入手动存档。自动存档仍会持续更新。"); };
  const loadManually = () => { const raw = localStorage.getItem(MANUAL_SAVE_KEY); if (!raw) { setNotice("尚未找到手动存档。"); return; } try { const saved = migrateState(JSON.parse(raw)); setState(saved); setPaused(true); setSelectedPieceId(null); setSelectedEnemyId(null); setDragged(null); setNotice("已读取手动存档，并安全返回准备阶段。"); } catch { setNotice("手动存档损坏，无法读取。"); } };
  const exportPortableSave = () => {
    const payload = JSON.stringify({
      format: "philosophy-auto-chess-save",
      formatVersion: 1,
      gameVersion: releaseInfo.versionId,
      exportedAt: new Date().toISOString(),
      game: JSON.parse(serializeGameState(state)),
      profile: JSON.parse(serializeProfile(profile)),
      audio: JSON.parse(serializeAudioSettings(audioSettings)),
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `philosophy-auto-chess-${releaseInfo.versionId}-save.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice("稳定存档、理念档案和音量设置已导出。请自行保管该 JSON 文件。");
  };
  const importPortableSave = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > 1_000_000) { setNotice("导入失败：存档文件超过 1 MB，现有进度未被修改。"); return; }
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      const isBundle = parsed?.format === "philosophy-auto-chess-save";
      if (isBundle && parsed.formatVersion !== 1) throw new Error("unsupported portable save format");
      const importedState = migrateState(isBundle ? parsed.game : parsed);
      const importedProfile = isBundle && parsed.profile !== undefined ? migrateProfile(parsed.profile) : null;
      const importedAudio = isBundle && parsed.audio !== undefined ? migrateAudioSettings(parsed.audio) : null;
      localStorage.setItem(IMPORT_BACKUP_KEY, JSON.stringify({
        game: localStorage.getItem(SAVE_KEY),
        profile: localStorage.getItem(PROFILE_KEY),
        audio: localStorage.getItem(AUDIO_SETTINGS_KEY),
      }));
      const serializedState = serializeGameState(importedState);
      localStorage.setItem(SAVE_KEY, serializedState);
      if (importedProfile) localStorage.setItem(PROFILE_KEY, serializeProfile(importedProfile));
      if (importedAudio) localStorage.setItem(AUDIO_SETTINGS_KEY, serializeAudioSettings(importedAudio));
      automaticSaveBlockedRef.current = false;
      profileSaveBlockedRef.current = false;
      lastAutomaticSaveRef.current = serializedState;
      stateRef.current = importedState;
      setState(importedState);
      if (importedProfile) setProfile(importedProfile);
      if (importedAudio) setAudioSettings(importedAudio);
      setHasRunSave(true);
      setHasImportBackup(true);
      setLoadWarning(null);
      setPaused(true);
      setSelectedPieceId(null);
      setSelectedEnemyId(null);
      setDragged(null);
      setNotice("存档导入成功，并已保留导入前备份；对局已安全返回准备阶段。");
    } catch (error) {
      setNotice(error instanceof UnsupportedSaveVersionError ? "导入失败：该存档来自更新版本，现有进度未被修改。" : "导入失败：文件结构无效或已损坏，现有进度未被修改。");
    }
  };
  const restoreImportBackup = () => {
    const raw = localStorage.getItem(IMPORT_BACKUP_KEY);
    if (!raw) { setHasImportBackup(false); setNotice("没有可恢复的导入前备份。"); return; }
    try {
      const backup = JSON.parse(raw) as { game: string | null; profile: string | null; audio: string | null };
      if (!backup.game) throw new Error("missing game backup");
      const restoredState = migrateState(JSON.parse(backup.game));
      const restoredProfile = backup.profile ? migrateProfile(JSON.parse(backup.profile)) : null;
      const restoredAudio = backup.audio ? migrateAudioSettings(JSON.parse(backup.audio)) : null;
      localStorage.setItem(SAVE_KEY, backup.game);
      if (backup.profile) localStorage.setItem(PROFILE_KEY, backup.profile);
      if (backup.audio) localStorage.setItem(AUDIO_SETTINGS_KEY, backup.audio);
      automaticSaveBlockedRef.current = false;
      profileSaveBlockedRef.current = false;
      lastAutomaticSaveRef.current = backup.game;
      stateRef.current = restoredState;
      setState(restoredState);
      if (restoredProfile) setProfile(restoredProfile);
      if (restoredAudio) setAudioSettings(restoredAudio);
      setHasRunSave(true);
      setPaused(true);
      setSelectedPieceId(null);
      setSelectedEnemyId(null);
      setDragged(null);
      setNotice("已恢复导入前备份，并返回准备阶段。");
    } catch {
      setNotice("导入前备份无法恢复；当前进度未被修改。");
    }
  };
  const reset = () => { [SAVE_KEY, ...LEGACY_SAVE_KEYS].forEach((key) => localStorage.removeItem(key)); automaticSaveBlockedRef.current = false; lastAutomaticSaveRef.current = null; promptedPreparationRef.current.clear(); soundPlayerRef.current.reset(); completedMissionsRef.current = profile.completedMissionIds; setNewMissionIds([]); setLoadWarning(null); setHasRunSave(false); setWaveCue(null); setShopFeedback(null); setSelectedSynergy(null); setState(makeInitialState()); updateProfile(recordRunStarted); setOperationDockOpen(true); setMobileShopOpen(false); setPaused(false); setStarted(true); setNotice("自动存档与当前阵容已重置；手动存档仍可读取。"); };
  const resetProfileForDevelopment = () => { if (!devToolsEnabled || battle.status === "running") return; localStorage.removeItem(PROFILE_KEY); profileSaveBlockedRef.current = false; setProfile(makeInitialProfile()); setNotice("开发档案已重置；当前25名基础棋子仍保持开放。"); };
  const continueRun = () => { setStarted(true); setOperationDockOpen(true); setMobileShopOpen(false); setNotice("已继续上次的荣耀记录。"); };
  const returnToMenu = () => { setSettingsOpen(false); setMissionsOpen(false); setStarted(false); };
  const closeTutorial = () => { localStorage.setItem(TUTORIAL_KEY, "complete"); setTutorialStep(null); };
  const reopenTutorial = () => { setSettingsOpen(false); setTutorialStep(0); };
  if (!started) return <MainMenu profile={profile} hasRunSave={hasRunSave} loadWarning={loadWarning} onContinue={continueRun} onNewRun={reset} onMissions={() => setMissionsOpen(true)} missionsOpen={missionsOpen} onCloseMissions={() => setMissionsOpen(false)} />;
  return <OwnedPieceActionContext.Provider value={{ canLiberalRefund, refund: sellForPaidCost }}><main className="game-shell game-shell--showcase" onClick={(event) => { const target = event.target as HTMLElement; if (!target.closest(".top-info-control,.core-health-control")) setTopInfoOpen(null); if (!target.closest(".unit-card,.enemy-token,.map-inspector,.window-switches,.economy-deck,.settings-dialog,.mission-drawer,.mobile-more-menu,.mobile-selection-bar,.landscape-hint")) { setSelectedPieceId(null); setPendingMobileSaleId(null); setSelectedEnemyId(null); } }}>
    <LandscapeGuard />
    <header className="topbar"><div><h1 className="game-title">往哲荣耀 <span className="eyebrow version-mark">{RELEASE_EYEBROW}</span><small>{releaseInfo.developer} · 三路防守</small></h1></div><nav className="window-switches" aria-label="界面窗口">
      <div className={`top-info-control ${topInfoOpen === "gold" ? "open" : ""}`}><button onClick={() => setTopInfoOpen((open) => open === "gold" ? null : "gold")} aria-expanded={topInfoOpen === "gold"}><i>◈</i><span><b>{state.gold} 金币</b><small>收入与利息</small></span></button>{topInfoOpen === "gold" && <section className="top-info-popover economy-breakdown" role="dialog" aria-label="金币收入说明"><header><small>ECONOMY</small><b>本波收入</b></header><p><span>基础收入</span><strong>+{historicalEconomy.baseIncome}</strong></p><p><span>{battle.status === "running" ? "开波锁定利息" : "当前预计利息"}</span><strong>+{battle.status === "running" ? battle.lockedInterest ?? 0 : effectiveInterestForGold(state.gold, state.historicalEvents)}</strong></p><p><span>核心无损奖励</span><strong>+{ECONOMY_RULES.perfectDefenseBonus}</strong></p>{historicalEconomy.publicSupply > 0 && <p><span>公共供给</span><strong>+{historicalEconomy.publicSupply}</strong></p>}<small>击杀奖励另计；金币每 {ECONOMY_RULES.interestStep} 枚增加 1 利息，当前最高 +{historicalEconomy.maxInterest}。</small></section>}</div>
      <div data-tutorial="population" className={`top-info-control population-info ${topInfoOpen === "population" ? "open" : ""}`}><button onClick={() => setTopInfoOpen((open) => open === "population" ? null : "population")} aria-expanded={topInfoOpen === "population"}><i>♟</i><span><b>人口 {state.pieces.filter((piece) => isFieldedSlot(piece.slotId)).length}/{populationCap}</b><small>等级 {state.level} · 经验 {state.level >= MAX_LEVEL ? "满" : `${state.xp}/${xpRequired(state.level)}`}</small></span></button>{topInfoOpen === "population" && <section className="top-info-popover progression-breakdown" role="dialog" aria-label="人口等级经验说明"><header><small>PROGRESSION</small><b>人口与升级</b></header><p>等级决定人口上限的基础值，历史事件可能进一步改变当前上限。</p><p>每波胜利自动获得 <strong>+{ECONOMY_RULES.automaticWaveExperience} 经验</strong>；第二波起可花 {ECONOMY_RULES.experienceCost} 金币购买 {ECONOMY_RULES.experienceAmount} 经验。</p></section>}</div>
      <div className={`top-info-control wave-info ${topInfoOpen === "wave" ? "open" : ""}`}><button onClick={() => setTopInfoOpen((open) => open === "wave" ? null : "wave")} aria-expanded={topInfoOpen === "wave"}><i>W</i><span><b>波次 {Math.min(state.wave, MAX_WAVES)}/{MAX_WAVES}</b><small>{encounterDefinition(Math.min(state.wave, MAX_WAVES), state.historicalEvents.seed).title}</small></span></button>{topInfoOpen === "wave" && <section className="top-info-popover wave-breakdown" role="dialog" aria-label="本波敌人信息"><WaveForecast wave={state.wave} historicalEvents={state.historicalEvents} compact /></section>}</div>
      <CoreHealthControl state={state} battle={battle} open={topInfoOpen === "core"} onToggle={() => setTopInfoOpen((open) => open === "core" ? null : "core")} />{battle.status === "running" ? <><button className="quick-combat" onClick={() => setPaused((value) => !value)}>{paused ? "继续" : "暂停"}</button><button className="quick-combat" onClick={() => setSpeed((value) => value === 1 ? 2 : 1)}>{speed}×</button></> : <button className="quick-wave" disabled={Boolean(waveCue) || Boolean(historicalDecision) || battle.status === "complete" || battle.status === "defeat"} onClick={beginWave}>{historicalDecision ? "待完成历史抉择" : waveCue ? "路线确认" : battle.status === "victory" ? `开始 W${state.wave}` : "开始波次"} <b>▶</b></button>}<button className={`missions-button ${missionsOpen ? "active" : ""}`} onClick={() => setMissionsOpen((open) => !open)} aria-expanded={missionsOpen}>任务 {profile.completedMissionIds.length}/{missionDefinitions.length}</button><button className="settings-button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen}>设置 ⚙</button><button className={`mobile-more-toggle ${mobileMenuOpen ? "active" : ""}`} type="button" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>更多</button></nav>{mobileMenuOpen && <div className="mobile-more-menu" role="menu"><button role="menuitem" onClick={() => { setSelectedSynergy("all"); setMobileMenuOpen(false); }}>共鸣详情</button><button role="menuitem" onClick={() => { setMissionsOpen(true); setMobileMenuOpen(false); }}>作战任务</button><button role="menuitem" onClick={() => { setSettingsOpen(true); setMobileMenuOpen(false); }}>设置与存档</button></div>}</header>
    <section className="status-line"><span className={`status-dot ${battle.status}`} /><span className="status-notice">{notice}</span>{historicalEvent && <span className="historical-status-inline"><small>历史事件</small><b>{historicalEvent.title}</b></span>}{(historicalEvent || historicalStance) && <span className="historical-status-inline"><small>意识形态</small><b>{historicalStance?.title ?? (state.wave >= 6 ? "待选择" : "W6 揭示")}</b></span>}{resolveWarMachinePlan(state.historicalEvents, state.wave) && <em className="historical-war-machine">本波出现工具理性机</em>}<HistoricalQuickGuide state={state} /><button onClick={reset}>重新开始</button></section>
    {historicalDecision && <HistoricalDecisionDialog state={state} decision={historicalDecision} onConfirmEvent={() => actCurrent(confirmNormalEvent)} onChooseReformation={(characterId) => actCurrent((current) => chooseReformationReward(current, characterId))} onChooseStance={chooseIdeology} />}
    {settingsOpen && <section className="settings-dialog" role="dialog" aria-label="游戏设置"><header><div><small>GAME SETTINGS</small><strong>设置与存档</strong></div><button onClick={() => setSettingsOpen(false)} aria-label="关闭设置">×</button></header><p>自动存档只保存稳定进度；战斗中退出会回到该波开战前的准备阶段。</p><nav className="ui-mode-settings" aria-label="界面模式"><span><small>DISPLAY MODE</small><b>界面模式</b></span><div><a href="/">自动</a><a href="/?ui=desktop">桌面版</a><a href="/?ui=mobile">手机版</a></div><small>切换会重新载入界面，但不会改变同源浏览器中的存档和游戏规则。</small></nav><section className="audio-settings" aria-label="音乐与音效设置"><header><span><small>AUDIO</small><b>音乐与音效</b></span><button aria-pressed={audioSettings.muted} onClick={() => setAudioSettings((current) => ({ ...current, muted: !current.muted }))}>{audioSettings.muted ? "恢复声音" : "全部静音"}</button></header><label><span>音乐</span><input aria-label="音乐音量" type="range" min="0" max="100" step="1" value={Math.round(audioSettings.musicVolume * 100)} onChange={(event) => setAudioSettings((current) => ({ ...current, musicVolume: Number(event.target.value) / 100 }))} /><output>{Math.round(audioSettings.musicVolume * 100)}%</output></label><label><span>音效</span><input aria-label="音效音量" type="range" min="0" max="100" step="1" value={Math.round(audioSettings.effectsVolume * 100)} onChange={(event) => setAudioSettings((current) => ({ ...current, effectsVolume: Number(event.target.value) / 100 }))} onPointerUp={() => sound("ui.purchase", `preview:${++feedbackSequenceRef.current}`)} onKeyUp={() => sound("ui.purchase", `preview:${++feedbackSequenceRef.current}`)} /><output>{Math.round(audioSettings.effectsVolume * 100)}%</output></label><small>短音效采用柔和起音与保守峰值；战斗声会自动限流，关键警告会优先获得清晰空间。调整音效滑杆后可立即试听。</small></section><div className="settings-actions"><button onClick={returnToMenu}><b>返回主界面</b><span>当前稳定进度会保留</span></button><button onClick={() => { setSettingsOpen(false); setMissionsOpen(true); }}><b>查看任务</b><span>局外记录，不影响战斗数值</span></button><button onClick={saveManually}><b>手动存档</b><span>覆盖独立手动档，整局重开仍保留</span></button><button onClick={loadManually}><b>读取手动存档</b><span>读取后返回准备阶段</span></button><button onClick={exportPortableSave}><b>导出存档文件</b><span>包含对局、档案和音量设置</span></button><button onClick={() => importSaveInputRef.current?.click()}><b>导入存档文件</b><span>先校验，失败不会覆盖现有进度</span></button><input ref={importSaveInputRef} className="save-transfer-input" type="file" accept=".json,application/json" onChange={importPortableSave} /><button disabled={!hasImportBackup} onClick={restoreImportBackup}><b>恢复导入前备份</b><span>撤回最近一次成功导入</span></button><button onClick={reopenTutorial}><b>重看新手引导</b><span>商店、部署、人口与升级</span></button><button disabled={!state.waveCheckpoint || battle.status === "complete"} onClick={restartWaveFromSettings}><b>本波重打</b><span>回到本波开始快照</span></button><button className="danger" onClick={() => { if (window.confirm("确定清除自动进度和当前阵容，从第一波重新开始吗？手动存档会保留。")) { reset(); setSettingsOpen(false); } }}><b>整局重开</b><span>清除自动档与阵容，保留手动档</span></button></div><small className="settings-note">存档不包含敌人、计时器、事件队列或临时战斗状态。浏览器数据被清理时本地存档也会丢失，请定期导出备份。</small><VersionNotes /><FeedbackTools state={state} />{devToolsEnabled && <TestControls state={state} locked={battle.status === "running"} onApply={setState} onSpawn={spawnDebugEncounter} onFormation={applyMapFormation} onStress={spawnMapStress} onFragments={spawnAbsoluteFragments} mapDebug={mapDebug} onMapDebug={setMapDebug} onReset={reset} onResetProfile={resetProfileForDevelopment} />}</section>}
    <section className="board-grid"><div className="map-panel panel"><ArenaResonanceRail state={state} battle={battle} selected={selectedSynergy} onSelect={setSelectedSynergy} /><div data-tutorial="deploy" onDragOver={(event) => { if (dragged) event.preventDefault(); }} onDrop={invalidDrop} className={`map-field arena-stage map-scenario-${mapScenario} ${mapDebug ? "calibration-on" : ""} ${battle.effects.some((effect) => effect.type === "core") ? "core-hit" : ""} ${coreThreat ? "core-threat" : ""} ${activeTerrain ? "is-dragging" : ""} ${battle.enemies.some((enemy) => enemy.kind === "boss" && enemy.bossPhasesTriggered?.includes("world-night") && (enemy.phaseSpeedUntil ?? 0) > (battle.gameTime ?? 0)) ? "world-night" : ""}`}><MapArt dangerLanes={dangerLanes} debug={mapDebug} />{waveCue && <WaveRouteCue key={waveCue.sequence} wave={waveCue.wave} encounterSeed={state.historicalEvents.seed} />}{mapDebug && <><div className="map-debug-overlay" />{state.pieces.filter((piece) => isFieldedSlot(piece.slotId)).map((piece) => <div key={`range-${piece.id}`} className="calibration-range" style={rangeStyle(piece)} />)}{battle.enemies.filter((enemy) => isBossKind(enemy.kind)).map((enemy) => { const point = routePoint(enemy.progress, enemy.lane); return <div key={`footprint-${enemy.id}`} className="boss-calibration-box" style={{ left: `${point.x}%`, top: `${point.y}%` }} />; })}</>}<OperationGrid state={state} battle={battle} dragTerrain={activeTerrain} />
      {selectedPiece && isFieldedSlot(selectedPiece.slotId) && <div className="range-preview" style={rangeStyle(selectedPiece)} />}
      <div className="enemy-track" aria-label="敌人路线">{battle.enemies.map((enemy) => <EnemyToken key={enemy.id} enemy={enemy} battle={battle} selected={selectedEnemyId === enemy.id} onSelect={() => setSelectedEnemyId(enemy.id)} />)}</div>{battle.effects.map((effect) => { if ((effect.type !== "attack" && effect.type !== "skill") || !effect.enemyId || !effect.slotId) return null; const enemy = battle.enemies.find((unit) => unit.id === effect.enemyId); const source = unitsBySlot[effect.slotId]; return enemy ? <AttackBeam key={effect.id} slotId={effect.slotId} enemy={enemy} kind={effect.type} mode={source && characterById[source.characterId].combat.range <= 2 ? "melee" : "ranged"} /> : null; })}<CombatEffects battle={battle} /><BossHealthBar battle={battle} /><BossPhaseBanner battle={battle} />{battle.status === "complete" && battle.summary?.success && <VictorySequence state={state} profile={profile} newMissionIds={newMissionIds} summary={battle.summary} onRestart={reset} />}{battle.status === "defeat" && <DefeatSequence summary={battle.summary} onRetry={retry} onRestart={reset} />}{(selectedPiece || selectedEnemy) && <div className="map-inspector"><BattleInspector piece={selectedPiece} enemy={selectedEnemy} /><UnitCombatStatus piece={selectedPiece} target={selectedTarget} /></div>}{battle.summary && battle.status !== "defeat" && battle.status !== "complete" && <WaveToast key={`${battle.summary.wave}-${battle.summary.elapsedTicks}`} summary={battle.summary} />}{rankUp && <div className="rank-up-toast">{rankUp}</div>}
      <div className={`deploy-grid ${activeTerrain ? "dragging" : ""}`}>{DEPLOY_SLOTS.map((slot) => { const piece = unitsBySlot[slot]; const rostrumCandidate = Boolean(piece && selectedSynergy === "greece" && battle.status !== "running" && characterById[piece.characterId]?.faction === "greece"); return <Slot key={slot} slot={slot} piece={piece} selected={selectedPieceId === piece?.id} hasSelection={Boolean(selectedPiece)} locked={battle.status === "running"} dropAllowed={Boolean(activeTerrain && slotTerrain[slot] === activeTerrain)} rostrumCandidate={rostrumCandidate} buffs={unitBuffs(piece, battle)} firing={battle.effects.some((effect) => (effect.type === "attack" || effect.type === "skill") && effect.slotId === slot)} struck={battle.effects.some((effect) => effect.type === "enemyHit" && effect.slotId === slot)} blocking={battle.enemies.some((enemy) => enemy.blockedBy === piece?.id)} onDrag={setDragged} onDrop={drop} onActivate={moveSelected} onSelect={selectPiece} onChooseRostrum={(pieceId) => { emitPreparation({ kind: "plan", patch: { rostrumId: pieceId } }); setSelectedSynergy(null); }} onBlocked={() => setNotice("战斗中不能调整阵容。")} />; })}</div>
      <Slot slot={THRONE_SLOT} piece={philosopherKing} selected={selectedPieceId === philosopherKing?.id} hasSelection={Boolean(selectedPiece)} locked={battle.status === "running" || (!throneUnlocked && !philosopherKing)} dropAllowed={Boolean(activePiece && isDeploySlot(activePiece.slotId) && throneUnlocked && battle.status !== "running")} buffs={[]} firing={battle.effects.some((effect) => (effect.type === "attack" || effect.type === "skill") && effect.slotId === THRONE_SLOT)} struck={false} blocking={false} onDrag={setDragged} onDrop={drop} onActivate={moveSelected} onSelect={selectPiece} onBlocked={() => setNotice(throneUnlocked ? "战斗中不能更换哲人王。" : "部署二阶柏拉图后解锁哲人王王座。")} />
      {royalBarrier && <div className={`royal-barrier ${battle.effects.some((effect) => effect.type === "barrierHit") ? "hit" : ""}`} style={{ left: `${ROYAL_BARRIER_POINT.x}%`, top: `${ROYAL_BARRIER_POINT.y}%` }} title={`王城屏障：三路共同阻挡；生命 ${Math.ceil(royalBarrier.hp ?? 0)}/${royalBarrier.maxHp ?? 0}，阻挡 ${battle.enemies.filter((enemy) => enemy.blockedBy === `structure:${royalBarrier.id}`).reduce((sum, enemy) => sum + enemy.weight, 0)}/${royalBarrier.capacity}`} role="status" aria-label="王城屏障，保护哲人之石并共同阻挡三条路线"><span className="royal-barrier-shield" aria-hidden="true"><i /><i /><i /></span><div className="royal-barrier-readout"><b>王城屏障</b><em>三路核心护罩</em><span><i style={{ width: `${Math.max(0, (royalBarrier.hp ?? 0) / Math.max(1, royalBarrier.maxHp ?? 1)) * 100}%` }} /></span><small>耐久 {Math.ceil(royalBarrier.hp ?? 0)}/{Math.ceil(royalBarrier.maxHp ?? 0)} · 阻挡 {battle.enemies.filter((enemy) => enemy.blockedBy === `structure:${royalBarrier.id}`).reduce((sum, enemy) => sum + enemy.weight, 0)}/{royalBarrier.capacity}</small></div></div>}
    </div><ArenaTelemetryRail battle={battle} />{selectedSynergy && <div className="resonance-popup-layer" onClick={() => setSelectedSynergy(null)}><div className="resonance-popup" onClick={(event) => event.stopPropagation()}><ResonanceDetail state={state} battle={battle} selected={selectedSynergy} onSelect={setSelectedSynergy} onChooseEnlightenment={(agendas) => act(chooseEnlightenmentAgendas(stateRef.current, agendas))} /></div></div>}</div><aside className={`economy panel ${intelOpen ? "" : "panel-collapsed"}`}>{intelOpen && <><section data-tutorial="wave" className="command-wave-panel" aria-label="波次预告"><WaveForecast wave={state.wave} historicalEvents={state.historicalEvents} /><button className="start-wave" disabled={Boolean(waveCue) || battle.status === "running" || battle.status === "complete" || battle.status === "defeat"} onClick={beginWave}>{waveCue ? "路线确认中" : battle.status === "victory" ? `开始第 ${state.wave} 波` : battle.status === "complete" ? "十波已完成" : "开始波次"}<strong>{waveCue ? "⌁" : "▶"}</strong></button>{battle.status === "running" && <div className="tempo-controls"><button className="tempo-button" onClick={() => setPaused((value) => !value)} title={paused ? "继续战斗" : "暂停战斗"} aria-label={paused ? "继续战斗" : "暂停战斗"}><span className="tempo-icon">{paused ? "▶" : "Ⅱ"}</span><small>{paused ? "继续" : "暂停"}</small></button><button className={`tempo-button speed ${speed === 2 ? "active" : ""}`} onClick={() => setSpeed((value) => value === 1 ? 2 : 1)} title="切换战斗速度" aria-label={`当前 ${speed} 倍速，点击切换`}><span className="tempo-icon">{speed}×</span><small>速度</small></button></div>}</section><section className="command-resources" aria-label="局内资源"><header><small>GAME STATUS</small><b>荣耀资源</b></header><div><span className="primary-resource"><small>金币</small><b>◈ {state.gold} / {ECONOMY_RULES.goldCap}</b></span><span data-tutorial="population" className="primary-resource population-resource"><small>等级 {state.level} · 经验 {state.level >= MAX_LEVEL ? "满" : `${state.xp}/${xpRequired(state.level)}`}</small><b>人口 {state.pieces.filter((piece) => isFieldedSlot(piece.slotId)).length}/{maxDeployForLevel(state.level)}</b></span><span><small>{battle.status === "running" ? "锁定利息（开波金币）" : `预计利息（每 ${ECONOMY_RULES.interestStep} 金币 +1）`}</small><b>+{battle.status === "running" ? battle.lockedInterest ?? 0 : effectiveInterestForGold(state.gold, state.historicalEvents)}</b></span><span><small>等级</small><b>{state.level} / {MAX_LEVEL}</b></span><span><small>经验</small><b>{state.level >= MAX_LEVEL ? "满级" : `${state.xp} / ${xpRequired(state.level)}`}</b></span><span><small>波次</small><b>{Math.min(state.wave, MAX_WAVES)} / {MAX_WAVES}</b></span><section className="core-resource" aria-label={`哲人之石生命 ${state.coreHp} / 100`}><div><i aria-hidden="true">◇</i><span><small>PHILOSOPHER&apos;S STONE</small><b>哲人之石</b></span></div><em><i style={{ width: `${state.coreHp}%` }} /></em><strong>{state.coreHp}<small>/ 100</small></strong></section></div></section></>}</aside></section>
    {selectedPiece && battle.status !== "running" && <aside className="mobile-selection-bar" role="toolbar" aria-label={`已选择 ${characterById[selectedPiece.characterId]?.name ?? "棋子"}`} data-selected-piece={selectedPiece.id}><span><b>{characterById[selectedPiece.characterId]?.name ?? selectedPiece.characterId}</b><small>再点地图或备战格可移动/交换</small></span>{isFieldedSlot(selectedPiece.slotId) && <button type="button" onClick={withdrawSelected}>撤回</button>}<button type="button" className={pendingMobileSaleId === selectedPiece.id ? "danger armed" : "danger"} aria-pressed={pendingMobileSaleId === selectedPiece.id} onClick={confirmMobileSale}>{pendingMobileSaleId === selectedPiece.id ? "确认出售" : "出售"}</button><button type="button" onClick={() => { setSelectedPieceId(null); setPendingMobileSaleId(null); }}>取消</button></aside>}
    <section className={`economy-deck ${operationDockOpen ? "" : "economy-deck-collapsed"} ${mobileShopOpen ? "mobile-shop-open" : ""}`}><nav className="economy-dock-tabs" aria-label="底部经营窗口"><button className={`desktop-dock-toggle ${operationDockOpen ? "active" : ""}`} disabled={Boolean(waveCue) || battle.status === "running"} onClick={() => setOperationDockOpen((open) => !open)} aria-expanded={operationDockOpen}>备战与商店 <b>{battle.status === "running" ? "战斗中锁定" : operationDockOpen ? "一起收起" : "一起展开"}</b></button><span className="mobile-bench-tab">备战席 <b>{state.pieces.filter((piece) => piece.slotId.startsWith("bench-")).length}/9</b></span><button className={`mobile-shop-toggle ${mobileShopOpen ? "active" : ""}`} disabled={Boolean(waveCue) || battle.status === "running"} onClick={() => setMobileShopOpen((open) => !open)} aria-expanded={mobileShopOpen}>理念商店 <b>{battle.status === "running" ? "战斗中锁定" : mobileShopOpen ? "收起" : "查看五席"}</b></button></nav><section data-tutorial="bench" className="bench panel"><div className="panel-heading"><span className="panel-title-inline"><b>备战区</b><small>RESERVE ROSTER</small></span><span className="panel-heading-actions"><em>{state.pieces.filter((piece) => piece.slotId.startsWith("bench-")).length} / 9</em></span></div><div className="bench-grid">{BENCH_SLOTS.map((slot) => <Slot key={slot} slot={slot} piece={unitsBySlot[slot]} selected={selectedPieceId === unitsBySlot[slot]?.id} hasSelection={Boolean(selectedPiece)} locked={false} dropAllowed={false} buffs={[]} firing={false} struck={false} blocking={false} onDrag={setDragged} onDrop={drop} onActivate={moveSelected} onSelect={selectPiece} onBlocked={() => setNotice("战斗中只能整理备战席。") } />)}</div>{dragged && <div className="drag-sell-zone bench-sell-zone" role="button" tabIndex={0} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); sellDragged(); }}><span>◇</span><b>拖入出售</b><small>折价回收</small></div>}</section>
    <section data-tutorial="shop" className={`shop panel ${dragged ? "shop--sell-target" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); sellDragged(); }}>
      <div className="panel-heading"><span className="panel-title-inline"><b>理念商店</b><small>IDEA MARKET</small></span><span className="panel-heading-actions"><div className="shop-odds" aria-label={`等级 ${state.level} 商店概率`}>{shopOddsForLevel(state.level).map((odds, index) => <span className={`c${index + 1}`} key={index}><b>{index + 1}◈</b><em>{odds}%</em></span>)}</div></span></div>
      <div className="shop-content"><div className={`shop-grid ${shopFeedback?.kind === "refresh" ? "is-refreshing" : ""}`}>{state.shop.map((characterId, index) => {
        const unit = characterId ? characterById[characterId] : undefined;
        if (!unit) return <div className="shop-card-slot" data-shop-index={index} key={`shop-slot-${index}`}><div className="shop-card shop-card--empty" aria-label="已售空" /></div>;
        const copies = state.pieces.filter((piece) => piece.characterId === unit.id && piece.star === 1).length;
        const shopAsset = characterAssets[unit.id];
        return <div className={`shop-card-slot ${canReformistReplace ? "can-replace" : ""}`} data-shop-index={index} data-shop-character-id={unit.id} key={`shop-slot-${index}`}><button key={unit.id} title={`${unit.name}：${unit.skill.summary}`} className={`shop-card faction-${unit.faction} ${shopAsset?.portraitShape ? `portrait-${shopAsset.portraitShape}` : ""} ${copies > 0 ? "merge-candidate" : ""}`} onClick={() => purchase(index)}>
          <div className="portrait"><PortraitAsset asset={shopAsset} fallback={unit.portrait} /></div>
          <div className="shop-text">
            <div className="shop-card-heading"><h3>{unit.name}</h3><b className={`cost c${unit.cost}`}>{unit.cost} ◈</b></div>
            <p className="shop-meta">{copies > 0 ? `已有 ${copies}/3 · 购买可合成` : `${unit.factionLabel} · ${unit.role.label}`}</p>
            <div className="shop-skill"><small>{unit.skill.name}</small><em className="shop-skill-summary">{unit.skill.summary}</em></div>
            <div className="shop-stats"><span>攻 {unit.combat.damage}</span><span>能 {unit.combat.maxEnergy}</span><span>挡 {unit.block}·防 {unit.stats.guard}</span></div>
          </div>
        </button>{canReformistReplace && <button className="reformist-replace-button" data-historical-action="reformist-replace" title={`用同费用新棋子替换 ${unit.name}`} onClick={() => replaceShopSlot(index)}>替换</button>}</div>;
      })}</div>{(state.historicalEvents.pendingReformationReward?.length ?? 0) > 0 && <div className="historical-action-bar" aria-label="历史事件行动"><button data-historical-action="claim-reformation" onClick={claimReformationReward}>领取宗教改革棋子</button></div>}<div className="shop-actions"><button data-tutorial="xp" disabled={battle.status === "running" || state.wave === 1} title={state.wave === 1 ? "第二波准备阶段开放经验购买" : "购买 4 点经验"} onClick={buyExperience}><span>购买经验</span><b>{state.wave === 1 ? "W2 开放" : "4 金币 / +4"}</b></button><button data-refresh-cost={freeRefreshes > 0 ? 0 : ECONOMY_RULES.refreshCost} title={freeRefreshes > 0 ? "工业革命：本次刷新免费" : `刷新商店需要 ${ECONOMY_RULES.refreshCost} 金币`} disabled={battle.status === "running"} onClick={refreshMarket}><span>刷新</span><b>{freeRefreshes > 0 ? "0 ◈" : `${ECONOMY_RULES.refreshCost} ◈`}</b></button><button className={state.shopFrozen ? "shop-freeze active" : "shop-freeze"} disabled={battle.status === "running"} aria-pressed={state.shopFrozen} onClick={freezeMarket}><span>{state.shopFrozen ? "已冻结" : "冻结"}</span><b>{state.shopFrozen ? "下波保留" : "保留商店"}</b></button></div>{shopFeedback?.kind === "xp" && <div key={shopFeedback.sequence} className="shop-action-feedback xp" role="status"><i aria-hidden="true">◆</i><span>{shopFeedback.label}</span></div>}</div>
    </section>
    </section>{missionsOpen && <MissionDrawer profile={profile} onClose={() => setMissionsOpen(false)} />}{tutorialStep !== null && <TutorialCoach step={tutorialStep} onStep={setTutorialStep} onClose={closeTutorial} />}</main></OwnedPieceActionContext.Provider>;
}

function HistoricalDecisionDialog({ state, decision, onConfirmEvent, onChooseReformation, onChooseStance }: {
  state: GameState;
  decision: "event" | "stance";
  onConfirmEvent: () => void;
  onChooseReformation: (characterId: string) => void;
  onChooseStance: (stanceId: HistoricalStanceId) => void;
}) {
  const event = state.historicalEvents.eventId ? historicalEventDefinitionById.get(state.historicalEvents.eventId) : undefined;
  const reformationReady = event?.id === "event:reformation" && state.historicalEvents.eventResolved;
  return <div className="historical-decision-layer" role="presentation"><section className="historical-decision-dialog" role="dialog" aria-modal="true" aria-label={decision === "event" ? "历史事件抉择" : "意识形态抉择"}>
    <header><small>{decision === "event" ? "HISTORICAL EVENT · W3" : "IDEOLOGY · W6"}</small><h2>{decision === "event" ? `历史事件 · ${event?.title ?? "待揭示"}` : "选择意识形态"}</h2></header>
    {decision === "event" && event && <><p className="historical-context">{event.history}</p><div className="historical-tradeoff"><span><small>收益</small>{event.benefit}</span><span><small>代价</small>{event.cost}</span><em>{event.duration}</em></div>{reformationReady ? <div className="historical-choice-grid">{state.historicalEvents.reformationCandidates?.map((characterId) => { const character = characterById[characterId]; return <button key={characterId} data-historical-choice={characterId} onClick={() => onChooseReformation(characterId)}><b>{character?.name ?? characterId}</b><span>{character?.factionLabel} · 2 费</span><small>免费加入备战区</small></button>; })}</div> : <button className="historical-confirm" data-historical-action="confirm-event" onClick={onConfirmEvent}>{event.id === "event:reformation" ? "进入历史 · 揭示三条道路" : "进入历史"}</button>}</>}
    {decision === "stance" && <><p className="historical-context">从三个与当前事件兼容的意识形态中选择一个。先理解它如何看待历史，再决定是否接受它带来的规则；选择会写入存档，不能在本局重选。</p><div className="historical-choice-grid">{state.historicalEvents.stanceCandidateIds.map((stanceId) => { const stance = historicalStanceDefinitionById.get(stanceId); return <button key={stanceId} data-historical-choice={stanceId} onClick={() => onChooseStance(stanceId)}><b>{stance?.title ?? stanceId}</b><span>{stance?.philosophy}</span><small>{historicalStanceSummaryForEvent(stanceId, state.historicalEvents.eventId)}</small></button>; })}</div></>}
  </section></div>;
}

function CoreHealthControl({ state, battle, open, onToggle }: { state: GameState; battle: BattleState; open: boolean; onToggle: () => void }) {
  const liveSources = Object.entries(battle.summary?.statistics.coreDamageBySource ?? battle.statistics?.coreDamageBySource ?? {}).filter(([, amount]) => amount > 0);
  const latestDamagedWave = [...(state.balanceHistory ?? [])].reverse().find((report) => report.outcome.coreDamage > 0);
  const sources = (liveSources.length ? liveSources : Object.entries(latestDamagedWave?.coreDamageBySource ?? {})).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const recordedWave = liveSources.length ? battle.summary?.wave ?? state.wave : latestDamagedWave?.wave;
  const total = sources.reduce((sum, [, amount]) => sum + amount, 0);
  return <div className={`core-health-control ${open ? "open" : ""}`}><button type="button" className={`top-core-resource core-resource ${state.coreHp <= 35 ? "danger" : ""}`} aria-label={`哲人之石生命 ${state.coreHp} / 100，点击查看受击记录`} aria-expanded={open} aria-controls="core-damage-ledger" onClick={onToggle}><div><i aria-hidden="true">◇</i><span><small>PHILOSOPHER&apos;S STONE</small><b>哲人之石</b></span></div><em aria-hidden="true"><i style={{ width: `${state.coreHp}%` }} /></em><strong>{state.coreHp}<small>/ 100</small></strong></button>{open && <section id="core-damage-ledger" className="top-info-popover core-damage-ledger" role="dialog" aria-label="哲人之石受击记录"><header><small>CORE DAMAGE</small><b>{recordedWave ? `${liveSources.length ? "本波" : "最近受损"} · W${recordedWave}` : "核心防线"}</b></header><div className="core-damage-overview"><span>当前生命 <b>{state.coreHp} / 100</b></span><span>记录损失 <b>{total > 0 ? `-${whole(total)}` : "0"}</b></span></div>{sources.length ? <div className="core-damage-list">{sources.map(([source, amount]) => <p key={source} data-core-damage-source={source} data-core-damage-amount={whole(amount)}><span><b>{source}</b><small>突破防线造成核心损伤</small></span><strong>-{whole(amount)}</strong></p>)}</div> : <p className="core-damage-empty">本局尚未受到核心损伤；敌人抵达哲人之石时会在这里留下记录。</p>}<small>记录来自确定性战斗结算；同名敌人的多次伤害会合并显示。</small></section>}</div>;
}

function HistoricalQuickGuide({ state }: { state: GameState }) {
  const event = state.historicalEvents.eventId ? historicalEventDefinitionById.get(state.historicalEvents.eventId) : undefined;
  const stance = state.historicalEvents.selectedStanceId ? historicalStanceDefinitionById.get(state.historicalEvents.selectedStanceId) : undefined;
  return <details className="historical-quick-guide"><summary aria-label="打开本局历史记录">历史说明 <b>?</b></summary><section className="historical-quick-guide-panel"><header><small>HISTORY &amp; IDEOLOGY</small><strong>如何进入历史</strong><span>这里只记录本局已经发生的历史事件与最终意识形态。</span></header><article className={`historical-current-record ${event ? "" : "pending"}`} data-history-record="event"><small>本局历史事件 · W3</small><b>{event?.title ?? "尚未揭示"}</b><span>{event ? event.history : state.wave < 3 ? "第三波之后，历史才会向本局显现。" : "等待完成本局的历史抉择。"}</span>{event && <footer><em>收益：{event.benefit}</em><em>代价：{event.cost}</em><i>{event.duration}</i></footer>}</article><article className={`historical-current-record ${stance ? "" : "pending"}`} data-history-record="ideology"><small>本局意识形态 · W6</small><b>{stance?.title ?? "尚未选择"}</b><span>{stance ? stance.philosophy : state.wave < 6 ? "第六波之后，你将为本局选择一种意识形态。" : "等待完成本局的意识形态选择。"}</span>{stance && <footer><em>{historicalStanceSummaryForEvent(stance.id, state.historicalEvents.eventId)}</em></footer>}</article></section></details>;
}

function MainMenu({ profile, hasRunSave, loadWarning, missionsOpen, onContinue, onNewRun, onMissions, onCloseMissions }: { profile: PlayerProfile; hasRunSave: boolean; loadWarning: string | null; missionsOpen: boolean; onContinue: () => void; onNewRun: () => void; onMissions: () => void; onCloseMissions: () => void }) {
  const enterGame = (action: () => void) => {
    void requestMobileLandscape();
    action();
  };
  return <main className="landing main-menu"><div className="main-menu-atmosphere" aria-hidden="true"><span>Ω</span><span>∴</span><span>◇</span><span>⌁</span><span>Ψ</span><span>∞</span></div><section className="main-menu-hero"><div className="landing-mark main-menu-sigil" aria-hidden="true"><span>Ⅰ</span><i>Ω</i><i>∴</i><i>◇</i><i>⌁</i></div><p className="eyebrow">{RELEASE_EYEBROW}</p><h1>往哲荣耀</h1><p className="landing-copy">固定路线防守 × 自走棋经济<br />十波侵蚀，守住哲人之石。</p><div className="main-menu-actions">{hasRunSave && <button className="primary" onClick={() => enterGame(onContinue)}>继续征程 <span>→</span></button>}<button className={hasRunSave ? "secondary" : "primary"} onClick={() => enterGame(onNewRun)}>{hasRunSave ? "开始新征程" : "开始往哲荣耀"}</button><button className="secondary" onClick={onMissions}>作战任务 <b>{profile.completedMissionIds.length}/{missionDefinitions.length}</b></button></div><p className="landing-note">{loadWarning ?? `${releaseInfo.displayVersion} · ${releaseInfo.developer}`}</p></section><aside className="main-menu-record"><small>PHILOSOPHICAL ARCHIVE</small><h2>理念档案</h2><div><span><b>{profile.stats.highestWaveCleared}</b><small>最高守住波次</small></span><span><b>{profile.stats.victories}</b><small>完成征程</small></span><span><b>{profile.completedMissionIds.length}</b><small>任务完成</small></span></div><p>当前 25 名棋子全部开放。任务只记录探索进度，不提供局内数值，也不会限制阵容选择。</p><VersionNotes /></aside>{missionsOpen && <MissionDrawer profile={profile} onClose={onCloseMissions} />}</main>;
}

function VersionNotes() {
  return <details className="version-notes"><summary>本版新增 <small>V0.2</small></summary><ul><li>历史事件与意识形态选择</li><li>历史档案与任务记录</li><li>音乐 / 音效分轨接口与设置</li><li>兼容旧版局内存档与局外档案</li></ul></details>;
}
function PortraitAsset({ asset, fallback }: { asset?: (typeof characterAssets)[string]; fallback: string }) {
  const [failed, setFailed] = useState(false);
  if (!asset?.portrait || failed) return <>{asset?.glyph ?? fallback}</>;
  return <img src={asset.portrait} alt="" draggable={false} onError={() => setFailed(true)} />;
}

function MissionDrawer({ profile, onClose }: { profile: PlayerProfile; onClose: () => void }) {
  return <aside className="mission-drawer" role="dialog" aria-label="作战任务"><header><div><small>FIELD MISSIONS</small><strong>作战任务</strong></div><button onClick={onClose} aria-label="关闭任务">×</button></header><p>任务用于记录你掌握过的机制。当前版本不锁棋子、不提供永久属性；“档案印记”是幂等占位奖励，不改变任何局内数值。</p><HistoricalArchiveSummary profile={profile} /><div className="mission-list">{missionDefinitions.map((mission) => { const progress = missionProgress(profile, mission); const complete = profile.completedMissionIds.includes(mission.id); return <article className={complete ? "complete" : ""} key={mission.id}><span><small>{mission.category}</small><b>{mission.title}</b></span><em>{complete ? "已完成" : `${progress}/${mission.target}`}</em><p>{mission.detail}</p>{mission.reward && <small className="mission-reward">{mission.reward.type === "archive" ? mission.reward.label : "内容接口奖励"}{complete ? " · 已记入" : " · 待完成"}</small>}<i aria-hidden="true"><b style={{ width: `${Math.min(100, progress / mission.target * 100)}%` }} /></i></article>; })}</div><footer>累计开局 {profile.stats.runsStarted} · 刷新 {profile.stats.refreshes} · 购买经验 {profile.stats.xpPurchases}</footer></aside>;
}

function HistoricalArchiveSummary({ profile }: { profile: PlayerProfile }) {
  const machines = profile.history.warMachineWaves.reduce((sum, record) => sum + record.encountered, 0);
  const defeated = profile.history.warMachineWaves.reduce((sum, record) => sum + record.defeated, 0);
  const winningStances = Object.values(profile.history.victoriesByStance).filter((count) => (count ?? 0) > 0).length;
  return <section className="historical-archive-summary" aria-label="历史档案统计"><header><small>HISTORICAL ARCHIVE</small><b>历史档案</b></header><div><span><b>{profile.history.viewedEventIds.length}</b><small>看过事件</small></span><span><b>{profile.history.chosenStanceIds.length}</b><small>意识形态</small></span><span><b>{profile.history.completedCombinationIds.length}</b><small>完成组合</small></span><span><b>{machines}/{defeated}</b><small>遭遇/击破机器</small></span><span><b>{winningStances}</b><small>通关意识形态</small></span></div></section>;
}

function TutorialCoach({ step, onStep, onClose }: { step: number; onStep: (step: number) => void; onClose: () => void }) {
  const current = TUTORIAL_STEPS[step];
  return <aside className={`tutorial-coach tutorial-target-${current.id}`} role="dialog" aria-label="新手引导" aria-live="polite"><header><small>QUICK GUIDE · {step + 1}/{TUTORIAL_STEPS.length}</small><button onClick={onClose}>跳过</button></header><strong>{current.title}</strong><p>{current.detail}</p><footer><button disabled={step === 0} onClick={() => onStep(step - 1)}>上一步</button>{step === TUTORIAL_STEPS.length - 1 ? <button className="primary" onClick={onClose}>完成</button> : <button className="primary" onClick={() => onStep(step + 1)}>下一步</button>}</footer></aside>;
}

type ResonanceEntry = { id: string; label: string; detail: string };
function WaveRouteCue({ wave, encounterSeed }: { wave: number; encounterSeed: number }) {
  const definition = encounterDefinition(wave, encounterSeed);
  const lanes = ["upper", "lower", "side"] as const;
  const labels = { upper: "A 路 · 上方入口", lower: "B 路 · 下方入口", side: "C 路 · 侧翼入口" } as const;
  const counts = definition.enemies.reduce<Record<(typeof lanes)[number], number>>((total, _enemy, index) => { total[lanes[(index + definition.laneOffset) % lanes.length]] += 1; return total; }, { upper: 0, lower: 0, side: 0 });
  return <section className="wave-route-cue" role="status" aria-label={`第 ${wave} 波敌人路线预警`}><header><small>ROUTE SIGNAL</small><b>第 {wave} 波 · 敌路确认</b></header>{lanes.filter((lane) => counts[lane] > 0).map((lane) => <div className={`route-signal lane-${lane}`} key={lane}><i aria-hidden="true">▶</i><span><b>{labels[lane]}</b><small>预计 {counts[lane]} 名</small></span></div>)}</section>;
}
const resonanceGlyphs: Record<string, string> = { greece: "Ω", germany: "◇", france: "✦", britain: "⌁", "philosopher-king": "♔", dialectic: "↯", contract: "⬡", enlightenment: "☼", phenomenology: "◉", eudaimonia: "♡", "logical-analysis": "∴" };
function resonanceEntries(state: GameState, battle: BattleState): ResonanceEntry[] {
  const running = battle.status === "running"; const snapshot = running ? battle.traitSnapshot ?? createTraitSnapshot(state.pieces, state.preparationPlan) : createTraitSnapshot(state.pieces, state.preparationPlan);
  const factionName = { greece: "古希腊", germany: "德国", france: "法国", britain: "英国" };
  const entries: ResonanceEntry[] = (Object.keys(factionName) as Array<keyof typeof factionName>).flatMap<ResonanceEntry>((faction): ResonanceEntry[] => {
    const tier = snapshot.factionTiers[faction]; if (tier < 2) return [];
    if (faction === "france") { const nodeName = { "debate-plaza": "论辩广场", "side-gate": "侧门前线", "core-front": "核心前线" }[snapshot.revolutionNodeId]; const threshold = tier >= 4 ? 6 : 8; return [{ id: faction, label: running ? `${factionName[faction]}·${tier}/6  ${nodeName} · 热度 ${battle.frenchHeat ?? 0}/${threshold}` : `${factionName[faction]}·${tier}/6  节点·${nodeName}`, detail: running ? "革命热度达到阈值后触发革命浪潮；4/6 档的结构仅由事件队列生成。" : `已选革命节点：${nodeName}。` }]; }
    if (faction === "germany") { const threshold = tier >= 4 ? 4 : 6; return [{ id: faction, label: running ? `${factionName[faction]}·${tier}/6  概念 ${battle.concepts}/${threshold}` : `${factionName[faction]}·${tier}/6`, detail: running ? "概念与绝对体系进度以本波快照和战斗状态为准。" : "开战后锁定德国单位数与体系档位。" }]; }
    if (faction === "britain") { const research = state.preparationPlan.activeResearches?.map((item) => item.choice === "mechanics" ? "力学" : "医学").join("+") || "待结论"; return [{ id: faction, label: running ? `${factionName[faction]}·${tier}/6  ${research} · 证据 ${battle.britishEvidence}` : `${factionName[faction]}·${tier}/6  研究·${research}`, detail: running ? `当前研究 ${research}；所有英国单位命中任意敌人都会积累证据，定律不区分敌人的入口路线。` : `全局研究：${research}。` }]; }
    const rostrum = snapshot.rostrumId ? state.pieces.find((piece) => piece.id === snapshot.rostrumId) : undefined;
    return [{ id: faction, label: running ? `${factionName[faction]}·${tier}/4  论辩 ${battle.greekDialogueCount ?? 0}/3` : `${factionName[faction]}·${tier}/4  讲席 ${rostrum ? characterById[rostrum.characterId]?.name : "自动"}`, detail: running ? "论辩与讲席派生资格均由本波快照管理。" : "讲席选择会在开波时冻结。" }];
  });
  const small = snapshot.smallSynergyTiers;
  if (hasPhilosopherKingUnlock(state.pieces)) { const king = snapshot.philosopherKingId ? state.pieces.find((piece) => piece.id === snapshot.philosopherKingId) : undefined; const kingCard = king ? characterById[king.characterId] : undefined; const specialty = king && kingCard ? kingCard.role.id === "support" ? "治疗与护盾 +30%" : kingCard.role.id === "sniper" || kingCard.role.id === "caster" ? "伤害 +30%" : kingCard.role.id === "controller" ? "伤害、治疗与护盾 +20%" : "伤害、治疗与护盾 +10%，王城屏障更坚固" : ""; entries.push({ id: "philosopher-king", label: `哲人王 1/1 · ${kingCard?.name ?? "王座待命"}`, detail: king ? `哲人王仍占 1 人口；阻挡为 0，攻击与技能射程遍布全图；${specialty}。开战时生成保护核心、共同阻挡三路的王城屏障。` : "二阶柏拉图已部署：可将任意一名已部署棋子拖入哲人之石王座。" }); }
  if (small.enlightenment >= 3) { const agendas = snapshot.preparationPlan.enlightenmentAgendas?.length ? snapshot.preparationPlan.enlightenmentAgendas : ["citizen"]; entries.push({ id: "enlightenment", label: `启蒙 ${small.enlightenment}/4 · ${agendas.map((agenda) => agenda === "market" ? "市场" : agenda === "education" ? "教育" : "公民").join("+")}`, detail: "启蒙议程只在准备阶段变更，开战后由快照结算。" }); }
  if (small.dialectic >= 2) entries.push({ id: "dialectic", label: `辩证法 ${small.dialectic}/4`, detail: running ? "普通技能叠加矛盾；两层后爆发并按档位提供回能或派生资格。" : "开战后成员死亡不会改变本波辩证法档位。" });
  if (small.contract >= 2) entries.push({ id: "contract", label: `契约共同体 ${small.contract}/3`, detail: "相邻地面成员减伤与一次性分摊；三人提供本波一次濒危救援。" });
  if (small.phenomenology >= 2) entries.push({ id: "phenomenology", label: `现象学 ${small.phenomenology}/3 · 悬置 ${battle.phenomenologyCharges ?? (small.phenomenology >= 3 ? 2 : 1)}`, detail: "成员开战获得悬置护盾；共享免死在致死伤害时按全局优先级结算。" });
  if (small.eudaimonia >= 2) entries.push({ id: "eudaimonia", label: "幸福论 2/2", detail: "有效治疗的 30% 与全部过量治疗转为护盾，最高为最大生命的 30%。" });
  if (small["logical-analysis"] >= 2) entries.push({ id: "logical-analysis", label: `逻辑分析 ${small["logical-analysis"]}/3`, detail: "两名不同成员命中后施加命题；三人时罗素原子出生减速。" });
  return entries;
}
function ArenaResonanceRail({ state, battle, selected, onSelect }: { state: GameState; battle: BattleState; selected: string | null; onSelect: (id: string | null) => void }) {
  const active = new Set(resonanceEntries(state, battle).map((entry) => entry.id));
  const deployed = new Set(state.pieces.filter((piece) => isFieldedSlot(piece.slotId)).map((piece) => piece.characterId));
  const visibleIds = allResonanceIds.filter((id) => (resonanceMemberIds[id] ?? []).some((memberId) => deployed.has(memberId)));
  return <aside className="arena-side-rail resonance-rail" aria-label="当前阵容羁绊"><header><small>RESONANCE</small><b>共鸣羁绊</b></header><div>{visibleIds.length ? visibleIds.map((id) => { const count = resonanceCountForPieces(id, state.pieces); const maximum = Math.max(...resonanceThresholds[id]); return <button key={id} title={`查看${resonanceNames[id]}详情`} className={`${active.has(id) ? "active" : "inactive"} ${selected === id ? "selected" : ""}`} onClick={() => onSelect(selected === id ? null : id)}><i aria-hidden="true">{resonanceGlyphs[id]}</i><span><b>{resonanceNames[id]}</b><small>{count}/{maximum}</small></span></button>; }) : <p className="resonance-empty">部署角色后显示相关羁绊</p>}</div></aside>;
}
function ArenaTelemetryRail({ battle }: { battle: BattleState }) {
  const units = Object.entries(battle.statistics?.units ?? {}).sort(([, a], [, b]) => b.damage - a.damage).slice(0, 6);
  const phase = battle.bossPhaseLog?.at(-1);
  return <aside className="arena-side-rail telemetry-rail" aria-label="战斗情报"><header><small>TELEMETRY</small><b>战斗情报</b></header><section><small>角色伤害排行</small>{units.length ? units.map(([id, row], index) => <div className="damage-rank" key={id}><i>{index + 1}</i><span><b>{row.characterId ? characterById[row.characterId]?.name ?? row.characterId : id}</b><small>伤害 {Math.round(row.damage)} · 承伤 {Math.round(row.damageTaken)} · 治疗 {Math.round(row.healing)}</small></span></div>) : <p>开波后显示本波排行</p>}</section><section className="telemetry-event"><small>最近事件</small><p>{battle.lastEvent}</p>{phase && <strong>Boss · {phase.name} @ {Math.round(phase.threshold * 100)}%</strong>}</section></aside>;
}
function emitPreparation(action: PreparationUiAction) { window.dispatchEvent(new CustomEvent<PreparationUiAction>("idea-garrison:preparation", { detail: action })); }
type DecisionKind = "revolution" | "research" | "enlightenment";
const resonanceMemberIds: Record<string, string[]> = {
  greece: characters.filter((unit) => unit.faction === "greece").map((unit) => unit.id), germany: characters.filter((unit) => unit.faction === "germany").map((unit) => unit.id), france: characters.filter((unit) => unit.faction === "france").map((unit) => unit.id), britain: characters.filter((unit) => unit.faction === "britain").map((unit) => unit.id),
  "philosopher-king": ["plato"], dialectic: ["socrates", "plato", "fichte", "hegel"], contract: ["rousseau", "locke", "hobbes"], enlightenment: ["rousseau", "locke", "hume", "kant"], phenomenology: ["husserl", "heidegger", "sartre"], eudaimonia: ["epicurus", "bentham"], "logical-analysis": ["aristotle", "russell", "wittgenstein"],
};
const resonanceThresholds: Record<string, number[]> = { greece: [2, 4], germany: [2, 4, 6], france: [2, 4, 6], britain: [2, 4, 6], "philosopher-king": [1], dialectic: [2, 3, 4], contract: [2, 3], enlightenment: [3, 4], phenomenology: [2, 3], eudaimonia: [2], "logical-analysis": [2, 3] };
const resonanceNames: Record<string, string> = { greece: "古希腊·理念学园", germany: "德国·体系", france: "法国·革命", britain: "英国·实验", "philosopher-king": "哲人王", dialectic: "辩证法", contract: "契约共同体", enlightenment: "启蒙", phenomenology: "现象学", eudaimonia: "幸福论", "logical-analysis": "逻辑分析" };
const allResonanceIds = Object.keys(resonanceNames);
const resonanceCountForPieces = (id: string, pieces: Piece[]) => id === "philosopher-king" ? Number(hasPhilosopherKingUnlock(pieces)) : (resonanceMemberIds[id] ?? []).filter((memberId) => pieces.some((piece) => isFieldedSlot(piece.slotId) && piece.characterId === memberId)).length;
 function ResonanceRoster({ id, pieces }: { id: string; pieces: Piece[] }) { const memberIds = resonanceMemberIds[id] ?? []; const deployed = new Set(pieces.filter((piece) => isFieldedSlot(piece.slotId)).map((piece) => piece.characterId)); const activeCount = resonanceCountForPieces(id, pieces); const next = (resonanceThresholds[id] ?? []).find((threshold) => threshold > activeCount); return <section className="resonance-roster" aria-label={`${id} 成员组成`}><small>成员组成 · {activeCount}/{memberIds.length}{next ? ` · 下一档 ${next}` : " · 最高档"}</small><div>{memberIds.map((memberId) => <span className={deployed.has(memberId) ? "lit" : "unlit"} key={memberId} title={characterById[memberId]?.name ?? memberId}><b>{characterById[memberId]?.name ?? memberId}</b></span>)}</div></section>; }
 function ResonanceDirectory({ state, battle, onSelect }: { state: GameState; battle: BattleState; onSelect: (id: string | null) => void }) { const active = new Set(resonanceEntries(state, battle).map((entry) => entry.id)); return <section className="resonance-detail resonance-directory"><header><small>全部共鸣</small><button onClick={() => onSelect(null)} aria-label="收起全部共鸣">×</button></header><p>亮起表示已激活；未激活项可查看下一档人数和完整效果。</p><div>{allResonanceIds.map((id) => { const count = resonanceCountForPieces(id, state.pieces); const next = (resonanceThresholds[id] ?? []).find((threshold) => threshold > count); return <button key={id} className={active.has(id) ? "active" : "inactive"} onClick={() => onSelect(id)}><b>{resonanceNames[id]}</b><span>{count}/{Math.max(...resonanceThresholds[id])}{next ? ` · 下一档 ${next}` : " · 最高档"}</span></button>; })}</div></section>; }
function ResonanceDetail({ state, battle, selected, onSelect, onChooseEnlightenment }: { state: GameState; battle: BattleState; selected: string | null; onSelect: (id: string | null) => void; onChooseEnlightenment: (agendas: EnlightenmentAgenda[]) => void }) {
  const entries = resonanceEntries(state, battle); const locked = battle.status === "running"; const snapshot = locked ? battle.traitSnapshot ?? createTraitSnapshot(state.pieces, state.preparationPlan) : createTraitSnapshot(state.pieces, state.preparationPlan); const [decision, setDecision] = useState<DecisionKind | null>(null); const canMakeChoice = !locked && battle.status !== "complete" && battle.status !== "defeat";
  const automaticDecision: DecisionKind | null = selected === "france" && snapshot.factionTiers.france >= 2 && !state.preparationPlan.revolutionNodeId ? "revolution" : selected === "enlightenment" && snapshot.smallSynergyTiers.enlightenment >= 3 && (state.preparationPlan.enlightenmentAgendas?.length ?? 0) < (snapshot.smallSynergyTiers.enlightenment >= 4 ? 2 : 1) ? "enlightenment" : null;
  const visibleDecision = canMakeChoice ? ((state.preparationPlan.pendingResearchChoices ?? 0) > 0 ? "research" : automaticDecision ?? decision) : null;
  if (selected === "__all") return <ResonanceDirectory state={state} battle={battle} onSelect={onSelect} />;
  const selectedCount = selected ? resonanceCountForPieces(selected, state.pieces) : 0; const nextTier = selected ? (resonanceThresholds[selected] ?? []).find((threshold) => threshold > selectedCount) : undefined;
  const entry = entries.find((item) => item.id === selected) ?? (selected && resonanceNames[selected] ? { id: selected, label: `${resonanceNames[selected]} · 未激活`, detail: `当前 ${selectedCount} 人；下一档需要 ${nextTier ?? "已满"} 人。` } : entries[0]);
  if (!entry) return null;
  const tierLines: Record<string, string[]> = {
    greece: ["2：古希腊与另一阵营各施法后进行一次对话；讲席获得 +8 能量、+34 护盾。", "4：每完成 3 次对话且阵容有 3 个不同阵营，讲席下一次技能额外施放一次 40% 威力的派生效果。"],
    germany: ["2：普通德国技能累计概念；6 层（4 人时为 4 层）时，全体德国单位各得 +55 护盾、+18 能量，冷却 4 秒。", "4：体系触发后获得 1 次 35% 回响资格。", "6：六名德国单位本波都正常施法后，绝对体系持续 8 秒；每人仅可获得一次 50% 回响资格。"],
    france: ["2：法国单位正常施法积累热度；热度 8（4 人时 6）时，以革命节点为中心 18 格范围减速 50%、禁止回能 2.5 秒并清除护盾，冷却 8 秒。", "4：本波第一次革命自动在节点生成容量 2、持续 5 秒的街垒。", "6：街垒升级为容量 3、持续 7 秒的公社；消失时对范围内敌人造成 34 伤害并减速 35%。"],
    britain: ["2：每名英国单位对同一敌人的普通攻击或普通技能每 0.6 秒最多积累 1 层证据。6 层后施加 5 秒定律：防御 -15%，且不能获得护盾。", "4：本波哲人之石未受伤且至少触发一次定律时，下个准备阶段可选一项研究成果；每波最多一次。", "6：可选两项不同研究。力学与医学持续两波；政治算术立即给 2 金币，每波最多领取一次。"],
    "philosopher-king": ["1：部署二阶柏拉图后解锁哲人之石王座。任命单位仍占 1 人口，离开原格且阻挡变为 0，攻击与技能射程遍布全图。射手/群攻伤害 +30%；治疗/辅助的治疗与护盾 +30%；控场主要效果 +20%；重装主要效果 +10%。", "开战：在核心外生成三路共用的王城护罩。敌人抵达最终防线时由同一屏障阻挡；容量为 min(4, 1 + 卡面基础阻挡)，生命为哲人王最大生命 × (40% + 10% × 基础阻挡)，防御为基础防御的 50%。高阻挡哲人王仍以更强的王城屏障体现防御专长。"],
    dialectic: ["2：普通技能积累矛盾；2 层造成一次额外伤害与减速，不会递归叠加。", "3：爆发伤害提高，并提供 18 点回能窗口。", "4：爆发进一步提高，并授予一次安全派生施法资格。"],
    contract: ["2：相邻地面成员获得减伤，并可进行一次非递归伤害分摊。", "3：本波一次濒危救援。"],
    enlightenment: ["3：准备阶段三选一：市场 +2 金币、教育 +4 经验、公民开战 +10% 最大生命护盾。", "4：可同时选择两项议程；进入战斗后冻结。"],
    phenomenology: ["2：成员开战获得 8% 最大生命护盾，并共享 1 次悬置免死；悬置后获得 25% 护盾与短暂无敌。", "3：开战护盾提高到 12%，共享悬置增加到 2 次。"],
    eudaimonia: ["2：有效治疗的 30% 与全部过量治疗转为护盾，护盾上限为目标最大生命的 30%。"],
    "logical-analysis": ["2：两名不同成员命中后施加命题。", "3：罗素拆分产生的原子敌人出生即减速；派生效果不会再次触发命题。"],
  };
  const rostrumPiece = snapshot.rostrumId ? state.pieces.find((piece) => piece.id === snapshot.rostrumId) : undefined;
  const currentStatus: Record<string, string> = {
    greece: `本局对话 ${battle.greekDialogueCount ?? 0}/3；讲席 ${rostrumPiece ? characterById[rostrumPiece.characterId]?.name ?? "自动选择" : "自动选择"}。`,
    germany: `概念 ${battle.concepts ?? 0}/${snapshot.factionTiers.germany >= 4 ? 4 : 6}；体系冷却至 ${Math.max(0, Math.ceil((battle.systemCooldownUntil ?? 0) - (battle.gameTime ?? 0)))} 秒。`,
    france: `革命热度 ${battle.frenchHeat ?? 0}/${snapshot.factionTiers.france >= 4 ? 6 : 8}；节点 ${snapshot.revolutionNodeId === "debate-plaza" ? "A/B 汇合点" : snapshot.revolutionNodeId === "side-gate" ? "C 路瓶颈" : "核心前最后防线"}；冷却至 ${Math.max(0, Math.ceil((battle.revolutionCooldownUntil ?? 0) - (battle.gameTime ?? 0)))} 秒。`,
    britain: `证据 ${battle.britishEvidence ?? 0}；本波已触发定律 ${battle.britishLawTriggers ?? 0} 次；研究结论不依赖敌人入口。`,
  };
  const triggerPrefixes: Record<string, string[]> = { greece: ["greece:"], germany: ["germany:"], france: ["france:"], britain: ["britain:"], dialectic: ["dialectic:"], contract: ["contract:"], enlightenment: ["enlightenment:"], phenomenology: ["phenomenology:"], eudaimonia: ["eudaimonia:"], "logical-analysis": ["logical-analysis:"] }; const triggerCount = Object.entries(battle.synergyTriggers ?? {}).filter(([id]) => (triggerPrefixes[entry.id] ?? []).some((prefix) => id.startsWith(prefix))).reduce((sum, [, count]) => sum + count, 0);
  return <><section className="resonance-detail resonance-detail--complete"><header><small>共鸣详情 · {locked ? "本波已冻结" : "准备阶段可调整"}</small><button onClick={() => onSelect(null)} aria-label="收起共鸣详情">×</button></header><b>{entry.label}</b><p>{entry.detail}</p><div className="resonance-tier-list">{(tierLines[entry.id] ?? []).map((line) => <span key={line}>{line}</span>)}</div>{currentStatus[entry.id] && <small className="resonance-live-state">{currentStatus[entry.id]}</small>}<small className="resonance-live-state">本波实际触发 {triggerCount} 次。</small><ResonanceRoster id={entry.id} pieces={state.pieces} />
    {entry.id === "greece" && <div className="preparation-controls"><small>{locked ? "战斗中不可修改。讲席已冻结。" : `讲席是整局常驻选择，不需要每波重选；当前 ${snapshot.rostrumId ? "已指定" : "自动选择最高星级、同星取费用最高的古希腊单位"}。开战时讲席获得 +15 能量与 10% 最大生命护盾；每次对话再获得 +8 能量、+34 护盾。`}</small>{!locked && <div>{state.pieces.filter((piece) => isFieldedSlot(piece.slotId) && characterById[piece.characterId]?.faction === "greece").map((piece) => <button key={piece.id} className={snapshot.rostrumId === piece.id ? "active" : ""} onClick={() => { emitPreparation({ kind: "plan", patch: { rostrumId: piece.id } }); onSelect(null); }}>{characterById[piece.characterId]?.name} · {piece.star}★</button>)}</div>}</div>}
    {entry.id === "france" && <div className="preparation-controls"><small>{locked ? "战斗中不可修改。革命节点已冻结。" : "革命节点是整局常驻选择，不需要每波重选；热度达到阈值后，街垒/公社会自动生成在所选位置。"}</small>{!locked && <button className="decision-open-button" onClick={(event) => { event.stopPropagation(); setDecision("revolution"); }}>调整革命节点（3 项）</button>}</div>}
    {entry.id === "britain" && <div className="preparation-controls"><small>{locked ? "战斗中不可修改。研究结论已冻结。" : "英国实验作用于全局：任意敌人均可积累证据，不选择地图入口。"}</small>{(state.preparationPlan.pendingResearchChoices ?? 0) > 0 && !locked && <button className="decision-open-button urgent" onClick={(event) => { event.stopPropagation(); setDecision("research"); }}>选择研究路线（力学 / 医学 / 政治算术）</button>}</div>}
    {entry.id === "enlightenment" && <div className="preparation-controls"><small>{locked ? "战斗中不可修改；本波已冻结。" : "启蒙 3 人选一项、4 人选两项；未选默认公民。"}</small>{!locked && <button className="decision-open-button" onClick={(event) => { event.stopPropagation(); setDecision("enlightenment"); }}>选择启蒙议程（3 项）</button>}</div>}
  </section>{visibleDecision && <DecisionCards kind={visibleDecision} state={state} battle={battle} onClose={() => setDecision(null)} onFinish={() => onSelect(null)} onChooseEnlightenment={onChooseEnlightenment} />}</>;
}
function DecisionCards({ kind, state, battle, onClose, onFinish, onChooseEnlightenment }: { kind: DecisionKind; state: GameState; battle: BattleState; onClose: () => void; onFinish: () => void; onChooseEnlightenment: (agendas: EnlightenmentAgenda[]) => void }) {
  const snapshot = battle.status === "running" ? battle.traitSnapshot ?? createTraitSnapshot(state.pieces, state.preparationPlan) : createTraitSnapshot(state.pieces, state.preparationPlan);
  const locked = battle.status === "running" || battle.status === "complete" || battle.status === "defeat";
  if (locked) return null;
  const selectedAgendas = state.preparationPlan.enlightenmentAgendas ?? [];
  const agendaLimit = snapshot.smallSynergyTiers.enlightenment >= 4 ? 2 : 1;
  const pending = state.preparationPlan.pendingResearchChoices ?? 0;
  const selections = state.preparationPlan.pendingResearchSelections ?? [];
  const choosePlan = (revolutionNodeId: "debate-plaza" | "side-gate" | "core-front") => { emitPreparation({ kind: "plan", patch: { revolutionNodeId } }); onClose(); onFinish(); };
  const chooseAgenda = (agenda: EnlightenmentAgenda) => onChooseEnlightenment(selectedAgendas.includes(agenda) ? selectedAgendas.filter((item) => item !== agenda) : selectedAgendas.length >= agendaLimit ? [...selectedAgendas.slice(1), agenda] : [...selectedAgendas, agenda]);
  const chooseResearchCard = (choice: "mechanics" | "medicine" | "political-arithmetic") => { emitPreparation({ kind: "research", choice }); if (pending <= 1) onFinish(); else onClose(); };
  const title = kind === "revolution" ? "选择革命节点" : kind === "research" ? "选择研究路线" : "选择启蒙议程";
  const subtitle = kind === "revolution" ? "革命热度达到阈值时，效果与临时结构会在这里出现。" : kind === "research" ? `本次还需确定 ${pending} 项不同研究；结论作用于全场，不依赖敌人入口。` : snapshot.smallSynergyTiers.enlightenment >= 4 ? "启蒙 4：选择两项，本波开始后冻结。" : "启蒙 3：选择一项，本波开始后冻结。";
  const researchCard = (choice: "mechanics" | "medicine" | "political-arithmetic", title: string, description: string, disabled = false) => <button title={`${title}：${description}`} disabled={disabled} className={disabled ? "disabled" : ""} onClick={() => chooseResearchCard(choice)}><b>{title}</b><span>{description}</span></button>;
  return <div className={`decision-overlay decision-overlay--${kind}`} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}><section className="decision-cards"><header><small>PREPARATION DECISION</small><h2>{title}</h2><p>{subtitle}</p><button className="decision-close" onClick={onClose} aria-label="稍后决定">×</button></header>
    {kind === "revolution" && <div className="decision-card-grid"><button className={snapshot.revolutionNodeId === "debate-plaza" ? "selected" : ""} onClick={() => choosePlan("debate-plaza")}><b>A/B 汇合点</b><span>同时覆盖两条汇合路线；适合正面拦截。</span></button><button className={snapshot.revolutionNodeId === "side-gate" ? "selected" : ""} onClick={() => choosePlan("side-gate")}><b>C 路瓶颈</b><span>封锁独立侧路，优先处理绕行威胁。</span></button><button className={snapshot.revolutionNodeId === "core-front" ? "selected" : ""} onClick={() => choosePlan("core-front")}><b>核心前最后防线</b><span>把革命浪潮留给接近哲人之石的敌人。</span></button></div>}
    {kind === "research" && <div className="decision-card-grid">{researchCard("mechanics", "力学", "下一波全体友军攻击速度 +15%；英国 6 持续两波。", selections.includes("mechanics"))}{researchCard("medicine", "医学", "下一波治疗与护盾 +25%，开战获得 8% 最大生命护盾；英国 6 持续两波。", selections.includes("medicine"))}{researchCard("political-arithmetic", "政治算术", "立刻获得 2 金币；每波最多领取一次。", selections.includes("political-arithmetic") || state.preparationPlan.politicalArithmeticClaimed === true)}</div>}
    {kind === "enlightenment" && <><div className="decision-card-grid"><button className={selectedAgendas.includes("market") ? "selected" : ""} onClick={() => chooseAgenda("market")}><b>市场</b><span>本波开始时获得 +2 金币。</span></button><button className={selectedAgendas.includes("education") ? "selected" : ""} onClick={() => chooseAgenda("education")}><b>教育</b><span>本波开始时获得 +4 经验。</span></button><button className={selectedAgendas.includes("citizen") ? "selected" : ""} onClick={() => chooseAgenda("citizen")}><b>公民</b><span>本波开始时全队获得 10% 最大生命护盾。</span></button></div><footer><button className="decision-confirm" onClick={() => { onClose(); onFinish(); }}>确认议程</button></footer></>}
  </section></div>;
}
function BossPhaseBanner({ battle }: { battle: BattleState }) {
  const phaseEvent = battle.bossPhaseLog?.at(-1); if (battle.status !== "running" || !phaseEvent || (battle.gameTime ?? 0) - phaseEvent.triggeredAt > 4.5) return null;
  const phase = Object.values(BOSS_PHASES_BY_KIND).flat().find((item) => item.id === phaseEvent.id); if (!phase) return null;
  return <div className={`boss-phase-banner ${phase.id === "world-night" ? "world-night" : ""}`} role="status"><small>BOSS PHASE · {Math.round(phase.threshold * 100)}%</small><strong>{phase.name}</strong><span>{phase.description}</span></div>;
}
function BossHealthBar({ battle }: { battle: BattleState }) {
  const boss = battle.enemies.find((enemy) => isBossKind(enemy.kind) && enemy.hp > 0); if (!boss) return null;
  const fragments = boss.isAtom ? battle.enemies.filter((enemy) => enemy.isAtom && enemy.atomicGroupId === boss.atomicGroupId && enemy.kind === boss.kind && enemy.hp > 0) : [boss];
  const hp = fragments.reduce((sum, enemy) => sum + enemy.hp, 0); const maxHp = fragments.reduce((sum, enemy) => sum + enemy.maxHp, 0); const shield = fragments.reduce((sum, enemy) => sum + (enemy.shield ?? 0), 0);
  const phases = boss.isAtom ? [] : bossPhasesFor(boss.kind); const ratio = Math.max(0, Math.min(1, hp / Math.max(1, maxHp))); const phase = phases.findLast((item) => boss.bossPhasesTriggered?.includes(item.id)); const next = phases.find((item) => !boss.bossPhasesTriggered?.includes(item.id)); const name = enemyTemplates[boss.kind].name;
  return <section className={`boss-health-display ${isFinalBossKind(boss.kind) ? "" : "mini-boss"} ${boss.isAtom ? "fragmented-boss" : ""}`} aria-label={`${name}生命`}><header><span><small>{isFinalBossKind(boss.kind) ? "FINAL BOSS" : "MID BOSS"}</small><b>{name}</b></span><em>{boss.isAtom ? `逻辑原子化 · ${fragments.length} 个分有` : phase?.name ?? "第一阶段"}</em><strong>{Math.ceil(hp)} / {Math.ceil(maxHp)}</strong></header><div><i style={{ width: `${ratio * 100}%` }} />{phases.map((item) => <span key={item.id} style={{ left: `${item.threshold * 100}%` }} />)}</div><footer>{shield ? `护盾 ${Math.ceil(shield)}` : "无护盾"}<b>{boss.isAtom ? "每个分有拥有独立生命，阶段能力不再重复触发" : next ? `下一阶段：${next.name}（${Math.round(next.threshold * 100)}%）` : "阶段机制已触发"}</b></footer></section>;
}
const victoryThoughts: Record<string, string> = {
  greece: "让每一次追问，都成为守住理念的城墙。", germany: "体系并非终点，而是思想在矛盾中完成自身。", france: "革命发生之处，空间便开始重新分配可能。", britain: "从经验中取得证据，让结论接受下一次检验。",
  dialectic: "矛盾不是裂缝，而是思想继续运动的入口。", contract: "共同体的力量，来自每个人愿意为彼此承担。", enlightenment: "理性之光并不替人选择，而使选择成为可能。", phenomenology: "回到事情本身，世界便重新显现。", eudaimonia: "幸福不是终点，而是合乎德性的生活方式。", "logical-analysis": "能够被清楚说出的，才真正进入了共同世界。",
};
function victoryIdentity(state: GameState) {
  const deployed = state.pieces.filter((piece) => isFieldedSlot(piece.slotId));
  const deployedIds = new Set(deployed.map((piece) => piece.characterId));
  const factionLabels = { greece: "古希腊·理念学园", germany: "德国·体系", france: "法国·革命", britain: "英国·实验" } as const;
  const factionCounts = (Object.keys(factionLabels) as Array<keyof typeof factionLabels>).map((id) => ({ id, count: [...deployedIds].filter((characterId) => characterById[characterId]?.faction === id).length })).sort((a, b) => b.count - a.count);
  const highestFactionCount = factionCounts[0]?.count ?? 0; const formation = factionCounts.filter((item) => item.count === highestFactionCount && item.count > 0).map((item) => `${factionLabels[item.id]} ×${item.count}`).join(" / ") || "跨阵营阵容";
  const candidates = allResonanceIds.map((id) => { const count = resonanceCountForPieces(id, state.pieces); const thresholds = resonanceThresholds[id] ?? []; const tier = [...thresholds].reverse().find((threshold) => count >= threshold) ?? 0; return { id, count, tier, maximum: Math.max(...thresholds, 1), score: tier ? tier / Math.max(...thresholds, 1) : 0 }; }).filter((item) => item.tier > 0).sort((a, b) => b.score - a.score || b.count - a.count || b.tier - a.tier);
  const main = candidates[0]; const resonance = main ? `${resonanceNames[main.id]} ${main.tier}/${main.maximum}` : "尚未形成主力共鸣";
  const factions = factionCounts.filter((item) => item.count > 0).map((item) => `${factionLabels[item.id]} ×${item.count}`);
  const resonances = candidates.map((item) => `${resonanceNames[item.id]} ${item.tier}/${item.maximum}`);
  return { formation, resonance, factions, resonances, thought: victoryThoughts[main?.id ?? factionCounts[0]?.id ?? "greece"], seconds: Math.max(0, Math.round(state.campaignElapsedSeconds ?? 0)) };
}
const victorySlotOrder: readonly SlotId[] = [...DEPLOY_SLOTS, THRONE_SLOT];
function VictoryLineup({ pieces }: { pieces: readonly Piece[] }) {
  const winners = pieces.filter((piece) => isFieldedSlot(piece.slotId)).sort((left, right) => victorySlotOrder.indexOf(left.slotId) - victorySlotOrder.indexOf(right.slotId));
  return <section className="victory-lineup" aria-label="取得胜利的最终阵容"><header><small>胜利阵容</small><b>{winners.length} 位思想者完成征程</b></header><div className="victory-lineup-grid">{winners.map((piece) => {
    const unit = characterById[piece.characterId]; if (!unit) return null;
    const asset = characterAssets[unit.id];
    return <article className={`victory-unit-card faction-${unit.faction} accent-${asset?.accent}`} data-victory-character-id={unit.id} key={piece.id} title={`${unit.name} · ${piece.star} 星 · ${unit.cost} 费`}>
      <div className={`victory-unit-portrait ${asset?.portraitShape ? `portrait-${asset.portraitShape}` : ""}`}><PortraitAsset asset={asset} fallback={unit.portrait} /></div>
      <strong>{unit.name}</strong><small>{piece.star}★ · {unit.cost} 费</small>
    </article>;
  })}</div></section>;
}
function VictorySequence({ state, profile, newMissionIds, summary, onRestart }: { state: GameState; profile: PlayerProfile; newMissionIds: MissionId[]; summary: BattleState["summary"]; onRestart: () => void }) {
  const [recordOpen, setRecordOpen] = useState(false);
  const [rankingMetric, setRankingMetric] = useState<"damage" | "damageTaken" | "healing" | "shielding">("damage");
  if (!summary) return null;
  const result = victoryIdentity(state); const run = summarizeVictoryRun(state.balanceHistory ?? []); const minutes = Math.floor(result.seconds / 60); const seconds = String(result.seconds % 60).padStart(2, "0");
  const event = state.historicalEvents.eventId ? historicalEventDefinitionById.get(state.historicalEvents.eventId)?.title : undefined;
  const stance = state.historicalEvents.selectedStanceId ? historicalStanceDefinitionById.get(state.historicalEvents.selectedStanceId)?.title : undefined;
  const machineRecords = profile.history.warMachineWaves.filter((record) => record.runWaveId.startsWith(`${state.historicalEvents.seed}:W`));
  const machines = machineRecords.reduce((sum, record) => sum + record.encountered, 0); const machinesDefeated = machineRecords.reduce((sum, record) => sum + record.defeated, 0);
  const missions = missionDefinitions.filter((mission) => newMissionIds.includes(mission.id));
  const rankingLabels = { damage: "伤害", damageTaken: "承伤", healing: "治疗", shielding: "护盾" } as const;
  const ranking = run.rankings[rankingMetric];
  return <section className="victory-sequence" role="dialog" aria-label="往哲荣耀最终成果">
    <div className="victory-stars" aria-hidden="true">✦　✧　✦　✧　✦</div><small className="victory-kicker">思想完成了它的远征</small><h2>往哲荣耀</h2><p>最终的敌对理念已经沉寂，这一局思想留下了自己的形状。</p>
    <div className="victory-record"><span><small>本局战斗耗时</small><b>{minutes}:{seconds}</b></span><span><small>最终成型阵营</small><b>{result.formation}</b></span><span><small>主力羁绊</small><b>{result.resonance}</b></span></div>
    <VictoryLineup pieces={state.pieces} />
    <blockquote>“{result.thought}”</blockquote>
    <div className="victory-actions"><button className="victory-restart" onClick={onRestart}>重新开始一局　↻</button><button className="victory-record-toggle" type="button" aria-expanded={recordOpen} aria-controls="victory-run-record" onClick={() => setRecordOpen(true)}><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 5h16v22H8zM12 10h8M12 15h8M12 20h5" /></svg><span><b>查看战绩</b><small>结算数据与历史卷宗</small></span></button></div>
    {recordOpen && <div className="victory-record-layer" onClick={() => setRecordOpen(false)}><section id="victory-run-record" className="victory-record-drawer" role="region" aria-label="本局战绩与结算数据" onClick={(event) => event.stopPropagation()}><header><div><small>GLORY ARCHIVE</small><b>阵容与贡献战绩</b></div><button type="button" aria-label="关闭战绩" onClick={() => setRecordOpen(false)}>×</button></header><div className="victory-ledger-grid"><span><small>完成征程</small><b>{run.waves} / {MAX_WAVES}</b></span><span><small>哲人之石</small><b>{state.coreHp} / 100</b></span><span><small>战斗耗时</small><b>{minutes}:{seconds}</b></span><span><small>本局总收入</small><b>{run.totalIncome}</b></span></div><section className="victory-build-record"><small>最终阵营</small><b>{result.factions.join(" · ") || "跨阵营阵容"}</b><small>激活羁绊</small><b>{result.resonances.join(" · ") || "尚未形成羁绊"}</b></section><section><small>历史与意识形态</small><b>{event ?? "未记录历史事件"} · {stance ?? "未确定意识形态"}</b>{state.historicalEvents.eventId === "event:world_war" && machines > 0 && <em>战争机器：击破 {machinesDefeated} / {machines}</em>}</section><section className="victory-ranking" data-victory-ranking={rankingMetric}><small>棋子贡献榜</small><nav aria-label="切换棋子贡献榜">{(Object.keys(rankingLabels) as Array<keyof typeof rankingLabels>).map((metric) => <button type="button" key={metric} aria-pressed={rankingMetric === metric} onClick={() => setRankingMetric(metric)}>{rankingLabels[metric]}</button>)}</nav><div>{ranking.length ? ranking.map((unit, index) => <p key={unit.characterId}><i>{index + 1}</i><span><b>{characterById[unit.characterId]?.name ?? unit.characterId}</b><small>{rankingLabels[rankingMetric]}贡献</small></span><strong>{whole(unit[rankingMetric])}</strong></p>) : <p className="empty">本局没有有效{rankingLabels[rankingMetric]}记录</p>}</div></section>{missions.length > 0 && <section><small>本局新荣誉</small><b>{missions.map((mission) => mission.title).join(" · ")}</b></section>}</section></div>}
  </section>;
}
function DefeatSequence({ summary, onRetry, onRestart }: { summary: BattleState["summary"]; onRetry: () => void; onRestart: () => void }) { const wave = summary?.wave ?? 1; const leaked = summary?.statistics.enemiesLeaked ?? 0; const coreDamage = Math.round(summary?.coreDamage ?? 0); return <section className="victory-sequence defeat-sequence" role="dialog" aria-label="本局挑战失败"><div className="defeat-sigil" aria-hidden="true">◇　╱　◇</div><small>PHILOSOPHER&apos;S STONE FRACTURED</small><h2>思想防线崩解</h2><p>第 {wave} 波突破了哲人之石，但这次论证仍可重新展开。</p><div className="victory-record defeat-record"><span><small>止步波次</small><b>W{wave}</b></span><span><small>漏过敌人</small><b>{leaked}</b></span><span><small>核心承伤</small><b>{coreDamage}</b></span></div><div className="defeat-actions"><button onClick={onRetry}>重试本波　↻</button><button className="restart-run" onClick={onRestart}>重新开始整局　⟲</button></div></section>; }
function WaveForecast({ wave, historicalEvents, compact = false }: { wave: number; historicalEvents?: GameState["historicalEvents"]; compact?: boolean }) {
  const definition = historicalEvents ? encounterDefinition(Math.min(wave, MAX_WAVES), historicalEvents.seed) : waveDefinition(Math.min(wave, MAX_WAVES));
  const lanes: Array<{ lane: "upper" | "lower" | "side"; label: string }> = [{ lane: "upper", label: "入口 A · 汇合上路" }, { lane: "lower", label: "入口 B · 汇合下路" }, { lane: "side", label: "入口 C · 独立侧路" }];
  const machineRoutes = historicalEvents ? startWaveForecastRoutes(historicalEvents, wave) : [];
  const groups = lanes.map(({ lane, label }, index) => {
    const laneOffset = "laneOffset" in definition && typeof definition.laneOffset === "number" ? definition.laneOffset : 0;
    const list = [...definition.enemies.filter((_, enemyIndex) => (enemyIndex + laneOffset) % 3 === index), ...machineRoutes.filter((route) => route === lane).map(() => "war-machine" as const)];
    const counts = list.reduce<Record<string, number>>((result, kind) => ({ ...result, [kind]: (result[kind] ?? 0) + 1 }), {});
    return { lane, label, counts };
  });
  return <section className={`wave-forecast ${compact ? "compact" : ""}`}><header><small>WAVE INTELLIGENCE</small><b>波次预告</b></header><div className="forecast-title"><strong>{definition.title}</strong><div className="threat-meter" title={`本波威胁预算 ${definition.threatBudget}`}><span><i style={{ width: `${Math.min(100, definition.threatBudget / 120 * 100)}%` }} /></span><b>THREAT {definition.threatBudget}</b></div></div><div className="lane-forecast">{groups.map((group) => <div key={group.lane} className={`lane-row ${group.lane}`}><b>{group.label}</b><span>{Object.entries(group.counts).length ? Object.entries(group.counts).map(([kind, count]) => <i key={kind} title={enemyTemplates[kind as keyof typeof enemyTemplates].name}>{enemyAssets[kind as keyof typeof enemyAssets].glyph} {enemyAssets[kind as keyof typeof enemyAssets].label}×{count}</i>) : <em>本波无敌人</em>}</span></div>)}</div></section>;
}

function startWaveForecastRoutes(historicalEvents: GameState["historicalEvents"], wave: number) {
  const plan = resolveWarMachinePlan(historicalEvents, wave);
  return plan ? warMachineRoutesForWave(wave, plan.machines) : [];
}
function OperationGrid({ state, battle, dragTerrain }: { state: GameState; battle: BattleState; dragTerrain?: "ground" | "highland" }) {
  const locked = battle.status === "running"; const snapshot = locked ? battle.traitSnapshot ?? createTraitSnapshot(state.pieces, state.preparationPlan) : createTraitSnapshot(state.pieces, state.preparationPlan);
  const canChooseNode = snapshot.factionTiers.france >= 2 && !locked;
  return <div className={`operation-grid ${dragTerrain ? "dragging" : ""}`} aria-label="1600乘900卫城三路线战术地图">
    {snapshot.factionTiers.france >= 2 && <div className="map-choice-layer map-choice-layer--revolution" aria-label="革命节点选择">{Object.entries(revolutionNodes).map(([id, node]) => <button title={`革命节点：${node.label}；革命浪潮和临时结构会在此处触发`} key={id} disabled={!canChooseNode} className={snapshot.revolutionNodeId === id ? "active" : ""} style={{ left: `${node.point.x}%`, top: `${node.point.y}%` }} onClick={(event) => { event.stopPropagation(); emitPreparation({ kind: "plan", patch: { revolutionNodeId: id } }); }}>{node.label}</button>)}</div>}
  </div>;
}
function BossSigil({ kind }: { kind: Enemy["kind"] }) {
  const common = { viewBox: "0 0 100 100", role: "presentation", focusable: false } as const;
  if (kind === "cave-boss") return <svg {...common}><path d="M16 82V54c0-24 14-39 34-39s34 15 34 39v28" /><path d="M30 82V60c0-16 9-27 25-31" /><circle cx="66" cy="34" r="5" /><circle cx="43" cy="57" r="5" /><path d="M43 62v15m-8-7 8-8 8 8" /></svg>;
  if (kind === "skeptic-boss") return <svg {...common}><path d="M18 50 50 18l32 32-32 32Z" /><path d="M32 50h12m12 0h12" /><circle cx="50" cy="50" r="4" /></svg>;
  if (kind === "dialectic-boss") return <svg {...common}><path d="m17 31 24 19-24 19M83 31 59 50l24 19" /><path d="M41 50h18" /><path d="m50 39 11 11-11 11-11-11Z" /></svg>;
  if (kind === "leviathan-boss") return <svg {...common}><path d="M50 12 83 25v25c0 20-12 31-33 39-21-8-33-19-33-39V25Z" /><path d="M31 39h38M36 39v24m14-24v31m14-31v24" /><path d="m31 29 8-8 11 8 11-8 8 8" /></svg>;
  return <svg {...common} className="absolute-spirit-sigil"><circle className="spirit-orbit spirit-orbit-outer" cx="50" cy="50" r="35" /><path className="spirit-triad" d="M50 13 82 69H18Z" /><circle className="spirit-orbit" cx="50" cy="50" r="21" /><path className="spirit-axis" d="M50 22v56M26 64l48-28M26 36l48 28" /><path className="spirit-core" d="m50 34 14 16-14 16-14-16Z" /><circle className="spirit-node" cx="50" cy="13" r="4" /><circle className="spirit-node" cx="82" cy="69" r="4" /><circle className="spirit-node" cx="18" cy="69" r="4" /><circle className="spirit-core-eye" cx="50" cy="50" r="5" /></svg>;
}

function EnemyToken({ enemy, battle, selected, onSelect }: { enemy: Enemy; battle: BattleState; selected: boolean; onSelect: () => void }) { const template = enemyTemplates[enemy.kind]; const effects = battle.effects.filter((effect) => effect.enemyId === enemy.id && ["attack", "hit", "skill", "synergy", "echo"].includes(effect.type)); const latest = effects.at(-1); const boss = isBossKind(enemy.kind); const point = routePoint(boss && enemy.progress < .055 ? .055 : enemy.progress, enemy.lane); const asset = enemyAssets[enemy.kind]; const phase = bossPhasesFor(enemy.kind).findLast((item) => enemy.bossPhasesTriggered?.includes(item.id)); const bossClass = boss ? `boss boss-kind-${enemy.kind} ${enemy.isAtom ? "atom-boss" : ""}` : ""; const fragmentNumber = enemy.isAtom ? Number(enemy.id.match(/-atom-(\d+)$/)?.[1] ?? 1) : 0; const fragmentOffset = enemy.isAtom ? (fragmentNumber - 2) * 36 : 0; const fragmentMark = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ"][fragmentNumber - 1] ?? fragmentNumber; const displayName = enemy.isAtom ? `${template.name}·分有 ${fragmentMark}` : template.name; const mapLabel = enemy.isAtom ? `分有 ${fragmentMark}` : template.name; return <button title={`${displayName}｜${template.role}：${template.description}${enemy.blockedBy ? "；当前已被地面单位阻挡" : ""}${phase && !enemy.isAtom ? ` 当前阶段 ${phase.name}` : ""}`} className={`enemy-token lane-${enemy.lane} ${template.className} ${bossClass} accent-${asset.accent} ${latest ? "hit" : ""} ${enemy.blockedBy ? "blocked" : ""} ${selected ? "selected" : ""}`} onClick={onSelect} style={{ left: `${point.x}%`, top: `calc(${point.y}% + ${fragmentOffset}px)` }} aria-label={`查看${displayName}，${template.role}${enemy.blockedBy ? "，当前已阻挡" : ""}`}><span>{boss ? <BossSigil kind={enemy.kind} /> : asset.glyph}</span>{boss && <strong className="boss-name">{mapLabel}<small>{enemy.isAtom ? "绝对精神的逻辑分有" : template.role}</small></strong>}{latest && <em>-{latest.amount}</em>}<i aria-label={`${displayName}生命 ${Math.ceil(enemy.hp)} / ${Math.ceil(enemy.maxHp)}`}><b style={{ width: `${Math.max(0, enemy.hp / enemy.maxHp) * 100}%` }} /></i></button>; }
function AttackBeam({ slotId, enemy, kind, mode }: { slotId: string; enemy: Enemy; kind: "attack" | "skill"; mode: "melee" | "ranged" }) { const source = deploymentPoint(slotId); const target = routePoint(enemy.progress, enemy.lane); const dx = target.x - source.x; const dy = (target.y - source.y) / MAP_ASPECT_RATIO; const length = Math.hypot(dx, dy); const angle = Math.atan2(dy, dx) * (180 / Math.PI); return <span className={`attack-beam ${kind} ${mode}`} style={{ left: `${source.x}%`, top: `${source.y}%`, width: `${length}%`, transform: `rotate(${angle}deg)` }} />; }
function CombatEffects({ battle }: { battle: BattleState }) { const corePoint = routePoint(1, "upper"); return <div className="combat-effects" aria-hidden="true">{battle.effects.map((effect) => { if (effect.type === "core") return <span key={effect.id} className="effect-core" style={{ left: `${corePoint.x}%`, top: `${corePoint.y}%` }}>-{effect.amount}</span>; if (!effect.slotId || !["heal", "shield", "enemyHit", "debuff", "synergy"].includes(effect.type)) return null; const target = effect.enemyId ? battle.enemies.find((enemy) => enemy.id === effect.enemyId) : undefined; const point = target && effect.type === "debuff" ? routePoint(target.progress, target.lane) : deploymentPoint(effect.slotId); const icon = effect.type === "heal" ? "+" : effect.type === "shield" ? "◈" : effect.type === "debuff" ? "⌁" : effect.type === "enemyHit" ? "!" : "✦"; return <span key={effect.id} className={`effect-pulse ${effect.type}`} style={{ left: `${point.x}%`, top: `${point.y}%` }}>{icon}{effect.amount ? <b>{effect.amount}</b> : null}</span>; })}</div>; }
function debugLineup(tokens: string[]): Piece[] { const used = new Set<string>(); return tokens.slice(0, 8).flatMap((token, index) => { const [characterId, requestedStar] = token.split("@"); const unit = characterById[characterId]; if (!unit) return []; const star: Piece["star"] = requestedStar === "3" ? 3 : requestedStar === "2" ? 2 : 1; const slotId = DEPLOY_SLOTS.find((slot) => !used.has(slot) && slotTerrain[slot] === unit.terrain); if (!slotId) return []; used.add(slotId); return [{ id: `debug-${characterId}-${index}`, characterId, star, slotId }]; }); }
function debugFormation(scenario: "merge" | "split" | "max" | "core"): Piece[] { const slots = scenario === "split" ? ["deploy-1", "deploy-3", "deploy-8", "deploy-12", "deploy-13", "deploy-15", "deploy-18", "deploy-20"] : scenario === "core" ? ["deploy-7", "deploy-10", "deploy-11", "deploy-12", "deploy-17", "deploy-18", "deploy-19", "deploy-20"] : ["deploy-5", "deploy-6", "deploy-7", "deploy-10", "deploy-14", "deploy-15", "deploy-17", "deploy-18"]; const groundIds = ["fichte", "heidegger", "hobbes", "epicurus"]; const highlandIds = ["schelling", "kant", "hegel", "bacon"]; let ground = 0; let highland = 0; return slots.map((slotId, index) => { const terrain = slotTerrain[slotId]; const characterId = terrain === "ground" ? groundIds[ground++] : highlandIds[highland++]; return { id: `calibration-${scenario}-${index}`, characterId, star: scenario === "max" ? 3 as const : 1 as const, slotId: slotId as SlotId }; }); }
const whole = (value: number | undefined) => Math.round(value ?? 0);
function WaveDiagnostic({ report }: { report: BalanceWaveReport }) {
  const units = Object.entries(report.units ?? {}).sort(([, left], [, right]) => (right.damage + right.healing + right.shielding + right.damageTaken) - (left.damage + left.healing + left.shielding + left.damageTaken));
  const deaths = report.outcome?.deaths ?? units.reduce((sum, [, unit]) => sum + (unit.deaths ?? 0), 0);
  const leaks = report.outcome?.leaks ?? Object.values(report.routes).reduce((sum, route) => sum + route.leaked, 0);
  const coreDamage = report.outcome?.coreDamage ?? Object.values(report.coreDamageBySource ?? {}).reduce((sum, amount) => sum + amount, 0);
  const king = report.philosopherKing;
  return <details className="post-wave-report"><summary><b>W{report.wave} · {report.success ? "守住" : "失败"}</b><span>金币 {report.economy.endGold} · 等级 {report.progress.level} · 人口 {report.progress.deployed} · 阵亡 {deaths} · 漏怪 {leaks}</span></summary><div className="post-wave-body"><section className="post-wave-overview"><span>结算金币 <b>{report.economy.startGold} → {report.economy.endGold}</b></span><span>刷新 <b>{report.economy.refreshes}</b></span><span>购买经验 <b>{report.economy.xpPurchases}</b></span><span>利息 <b>+{report.economy.interest}</b></span><span>核心损失 <b>{whole(coreDamage)}</b></span><span>战斗时长 <b>{report.elapsedSeconds}s</b></span></section><section className="post-route-report"><b>路线漏怪</b>{(["upper", "lower", "side"] as const).map((route) => <span key={route}>{route === "upper" ? "A 上路" : route === "lower" ? "B 下路" : "C 侧路"}：{report.routes[route]?.leaked ?? 0}（击杀 {report.routes[route]?.defeated ?? 0}/{report.routes[route]?.spawned ?? 0}）</span>)}</section><section className="post-unit-report"><b>棋子贡献</b>{units.length ? units.map(([id, unit]) => <span key={id} className={(unit.deaths ?? 0) > 0 ? "fallen" : ""}><strong>{unit.characterId ? characterById[unit.characterId]?.name ?? unit.characterId : id}{(unit.deaths ?? 0) > 0 ? " · 阵亡" : ""}</strong><small>伤 {whole(unit.damage)} · 承 {whole(unit.damageTaken)} · 疗 {whole(unit.healing)} · 盾 {whole(unit.shielding)} · 阻挡 {(unit.blockedWeight ?? 0).toFixed(1)}</small></span>) : <p>本波没有棋子统计。</p>}</section>{king && <section className="post-king-report"><b>哲人王 · {characterById[king.characterId]?.name ?? king.characterId} {king.star}★{king.normalSlot ? ` · 对照位置 ${king.normalSlot}` : ""}</b><span>本体总贡献：伤 {whole(king.output.damage)} · 疗 {whole(king.output.healing)} · 盾 {whole(king.output.shielding)}</span><span>王座职业实际增量：伤 +{whole(king.throneBonus.damage)} · 疗 +{whole(king.throneBonus.healing)} · 盾 +{whole(king.throneBonus.shielding)}</span><span>王城屏障：吸收 {whole(king.barrier.damageTaken)} · 阻挡重量秒 {king.barrier.blockedWeight.toFixed(1)} · 受击 {king.barrier.hits}{king.barrier.broke ? " · 已破碎" : " · 未破碎"}</span><em>以上是王座可量化增益；全图射程和站位变化仍需与同阵容正常部署的另一局比较。</em></section>}</div></details>;
}
function FeedbackTools({ state }: { state: GameState }) {
  const [copied, setCopied] = useState(false);
  const report = useMemo(() => JSON.stringify({
    format: "idea-garrison-balance-report-v2",
    generatedAt: new Date().toISOString(),
    demoVersion: releaseInfo.versionId,
    progress: { wave: state.wave, level: state.level, xp: state.xp, gold: state.gold, coreHp: state.coreHp, campaignElapsedSeconds: state.campaignElapsedSeconds ?? 0 },
    finalRoster: state.pieces.map((piece) => ({ characterId: piece.characterId, star: piece.star, slotId: piece.slotId })),
    preparationPlan: state.preparationPlan,
    waves: state.balanceHistory ?? [],
  }, null, 2), [state]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([report], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `idea-garrison-balance-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    URL.revokeObjectURL(url);
  };
  const copy = async () => { await navigator.clipboard?.writeText(report); setCopied(true); window.setTimeout(() => setCopied(false), 1200); };
  const history = [...(state.balanceHistory ?? [])].reverse();
  return <details className="feedback-tools"><summary>局后报告与反馈 <span>POST-BATTLE REPORT</span></summary><p>逐波查看经济、阵亡、路线和棋子贡献；哲人王额外拆分本体总量、王座增量与屏障价值。</p><section className="post-battle-history">{history.length ? history.map((wave, index) => <WaveDiagnostic key={`${wave.wave}-${history.length - index}`} report={wave} />) : <p>完成一波战斗后显示局后报告。</p>}</section><div><button onClick={download}>导出平衡报告</button><button onClick={() => { void copy(); }}>{copied ? "已复制" : "复制报告"}</button></div></details>;
}
function TestControls({ state, locked, onApply, onSpawn, onFormation, onStress, onFragments, mapDebug, onMapDebug, onReset, onResetProfile }: { state: GameState; locked: boolean; onApply: (state: GameState) => void; onSpawn: (wave: 5 | 10, kind: "elite" | "boss") => void; onFormation: (scenario: "merge" | "split" | "max") => void; onStress: () => void; onFragments: () => void; mapDebug: boolean; onMapDebug: (value: boolean) => void; onReset: () => void; onResetProfile: () => void }) {
  const [gold, setGold] = useState(state.gold); const [level, setLevel] = useState(state.level); const [population, setPopulation] = useState(maxDeployForLevel(state.level)); const [xp, setXp] = useState(state.xp); const [wave, setWave] = useState(state.wave); const [coreHp, setCoreHp] = useState(state.coreHp); const [pendingResearch, setPendingResearch] = useState<number>(state.preparationPlan.pendingResearchChoices ?? 0); const [shopText, setShopText] = useState(state.shop.filter(Boolean).join(",")); const [lineupText, setLineupText] = useState(state.pieces.filter((piece) => isDeploySlot(piece.slotId)).map((piece) => piece.characterId).join(",")); const [saveText, setSaveText] = useState("");
  const apply = () => { const populationLevel = Array.from({ length: MAX_LEVEL }, (_, index) => index + 1).find((candidate) => maxDeployForLevel(candidate) >= Math.min(8, Math.max(2, population))) ?? MAX_LEVEL; const progress = normalizeProgress(Math.max(level, populationLevel), xp); const validShop = shopText.split(",").map((id) => id.trim()).filter((id) => Boolean(characterById[id])).slice(0, 5); const shop: Array<string | null> = [...validShop]; while (shop.length < 5) shop.push(null); const requestedLineup = lineupText.split(",").map((id) => id.trim()).filter(Boolean); onApply({ ...state, gold: Math.max(0, gold), level: progress.level, xp: progress.xp, wave: Math.min(10, Math.max(1, wave)), coreHp: Math.min(100, Math.max(0, coreHp)), shop, pieces: requestedLineup.length ? debugLineup(requestedLineup) : state.pieces, preparationPlan: { ...state.preparationPlan, pendingResearchChoices: Math.max(0, Math.min(2, Math.floor(pendingResearch))) as 0 | 1 | 2, pendingResearchSelections: [] }, battle: undefined }); };
  const exportSave = () => setSaveText(JSON.stringify(JSON.parse(serializeGameState(state)), null, 2));
  const importSave = () => { try { onApply(migrateState(JSON.parse(saveText))); } catch { setSaveText("存档 JSON 无法解析"); } };
  const statistics = { currentWave: { battle: state.battle?.statistics, synergyTriggers: state.battle?.synergyTriggers, bossPhases: state.battle?.bossPhaseLog, summary: state.battle?.summary }, balanceHistory: state.balanceHistory ?? [] };
  return <details className="test-controls developer-tools"><summary>开发平衡工具</summary><p>仅 localhost 且带 <code>?devtools=1</code> 时显示；所有入口默认折叠。</p><div><label>金币<input disabled={locked} type="number" value={gold} onChange={(event) => setGold(Number(event.target.value))} /></label><label>等级<input disabled={locked} type="number" value={level} onChange={(event) => setLevel(Number(event.target.value))} /></label><label>人口<input disabled={locked} type="number" min="2" max="8" value={population} onChange={(event) => setPopulation(Number(event.target.value))} /></label><label>经验<input disabled={locked} type="number" value={xp} onChange={(event) => setXp(Number(event.target.value))} /></label><label>波次<input disabled={locked} type="number" value={wave} onChange={(event) => setWave(Number(event.target.value))} /></label><label>核心<input disabled={locked} type="number" value={coreHp} onChange={(event) => setCoreHp(Number(event.target.value))} /></label><label>英国研究待选<input data-debug="pending-research" disabled={locked} type="number" min="0" max="2" value={pendingResearch} onChange={(event) => setPendingResearch(Number(event.target.value))} /></label></div><label>指定商店（角色 ID，逗号分隔）<input data-debug="shop" disabled={locked} value={shopText} onChange={(event) => setShopText(event.target.value)} /></label><label>指定棋盘阵容（最多 8 人）<textarea data-debug="lineup" disabled={locked} value={lineupText} onChange={(event) => setLineupText(event.target.value)} /></label><div className="developer-actions"><button data-debug="apply" disabled={locked} onClick={apply}>应用开发配置</button><button disabled={locked} onClick={() => onSpawn(5, "elite")}>生成 W5 洞穴之影</button><button disabled={locked} onClick={() => onSpawn(10, "boss")}>生成 W10 绝对精神</button><button data-debug="absolute-fragments" onClick={onFragments}>检视绝对精神三分有</button><button data-debug="map-merge" onClick={() => onFormation("merge")}>八人集中汇合区</button><button data-debug="map-split" onClick={() => onFormation("split")}>八人三路分守</button><button data-debug="map-max" onClick={() => onFormation("max")}>最大棋子密集格</button><button data-debug="map-stress" onClick={onStress}>核心前 Boss 压力</button><button data-debug="map-debug" onClick={() => onMapDebug(!mapDebug)}>{mapDebug ? "关闭坐标碰撞框" : "开启坐标碰撞框"}</button><button onClick={exportSave}>导出稳定存档</button><button disabled={locked || !saveText.trim()} onClick={importSave}>导入并迁移存档</button><button disabled={locked} onClick={onReset}>清空存档</button><button data-debug="reset-profile" disabled={locked} onClick={onResetProfile}>重置局外档案</button></div><label>存档 JSON<textarea data-debug="save-json" value={saveText} onChange={(event) => setSaveText(event.target.value)} /></label><details><summary>对局平衡报告 JSON</summary><pre>{JSON.stringify(statistics, null, 2)}</pre><button onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(statistics, null, 2)); }}>复制报告</button></details></details>;
}
function Slot({ slot, piece, selected, hasSelection, locked, dropAllowed, rostrumCandidate = false, buffs, firing, struck, blocking, onDrag, onDrop, onActivate, onSelect, onChooseRostrum, onBlocked }: { slot: SlotId; piece?: Piece; selected: boolean; hasSelection: boolean; locked: boolean; dropAllowed: boolean; rostrumCandidate?: boolean; buffs: string[]; firing: boolean; struck: boolean; blocking: boolean; onDrag: (id: string | null) => void; onDrop: (slot: SlotId) => void; onActivate: (slot: SlotId) => void; onSelect: (id: string) => void; onChooseRostrum?: (id: string) => void; onBlocked: () => void }) {
  const ownedPieceAction = useContext(OwnedPieceActionContext);
  const unit = piece ? characterById[piece.characterId] : undefined;
  const hpRatio = piece && unit ? Math.max(0, Math.min(1, (piece.hp ?? unit.stats.resolve) / (piece.maxHp ?? unit.stats.resolve))) : 1;
  const energyRatio = piece && unit ? Math.max(0, Math.min(1, (piece.energy ?? 0) / (piece.maxEnergy ?? unit.combat.maxEnergy))) : 0;
  const asset = unit ? characterAssets[unit.id] : undefined;
  const point = isFieldedSlot(slot) ? deploymentPoint(slot) : undefined;
  const placeStyle = point ? { left: `${point.x}%`, top: `${point.y}%` } : undefined;
  const throne = isThroneSlot(slot);
  const canRefund = Boolean(piece && ownedPieceAction.canLiberalRefund && (piece.paidCost ?? 0) > 0);
  const thronePower = piece && throne ? Math.round((philosopherKingEffectMultiplier(piece, unit?.role.id === "support" ? "heal" : "damage") - 1) * 100) : 0;
  return <div data-slot={slot} title={throne ? piece && unit ? `哲人王：${unit.name}。射程遍布全图，${unit.role.id === "support" ? "治疗/护盾" : unit.role.id === "sniper" || unit.role.id === "caster" ? "伤害" : "主要效果"} +${thronePower}%；屏障容量 ${Math.min(4, 1 + unit.block)}。` : "哲人王王座：部署二阶柏拉图后，将一名已部署棋子拖入。" : undefined} style={placeStyle} className={`slot ${throne ? "throne-slot" : ""} ${piece ? "occupied" : ""} ${selected ? "selected" : ""} ${locked ? "locked" : ""} ${dropAllowed ? "drop-allowed" : ""} ${rostrumCandidate ? "rostrum-candidate" : ""} ${firing ? "firing" : ""} ${struck ? "struck" : ""} ${blocking ? "blocking" : ""} ${asset?.portraitShape ? `portrait-${asset.portraitShape}` : ""} ${unit && piece ? `faction-${unit.faction} role-${unit.role.id} terrain-${unit.terrain} accent-${asset?.accent} star-${piece.star}` : ""}`} onClick={() => { if (!piece && !locked) onActivate(slot); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (locked) onBlocked(); else onDrop(slot); }}>
    {piece && unit ? <div data-character-id={unit.id} title={`${unit.name}：${unit.skill.summary}`} className="unit-card" draggable onClick={(event) => { event.stopPropagation(); if (rostrumCandidate && onChooseRostrum) { onChooseRostrum(piece.id); return; } if (hasSelection && !selected) onActivate(slot); else onSelect(piece.id); }} onDragStart={(event) => { if (locked) { event.preventDefault(); onBlocked(); return; } event.dataTransfer?.setData("text/plain", piece.id); if (event.dataTransfer) { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setDragImage(event.currentTarget, event.currentTarget.offsetWidth / 2, event.currentTarget.offsetHeight / 2); } onDrag(piece.id); }} onDragEnd={() => onDrag(null)}>
      <div className="unit-top"><b>{piece.star} 阶</b><span>{asset?.label ?? unit.role.label}</span></div>
      <div className="unit-avatar"><PortraitAsset asset={asset} fallback={unit.portrait} /></div>
      {buffs.length > 0 && <div className="unit-buffs">{buffs.map((buff, index) => <i key={`${buff}-${index}`}>{buff}</i>)}</div>}
      <div className="unit-name"><strong>{unit.name}</strong></div>
      <div className="unit-gauges"><i className="unit-hp"><b style={{ width: `${hpRatio * 100}%` }} /></i><i className="unit-energy"><b style={{ width: `${energyRatio * 100}%` }} /></i></div>
      {canRefund && <button type="button" className="liberal-refund-button" data-historical-action="liberal-sale" draggable={false} title={`按实际购入成本完整退款 ${piece.paidCost} 金币`} onDragStart={(event) => event.preventDefault()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); ownedPieceAction.refund(piece.id); }}>全退 {piece.paidCost}◈</button>}
    </div> : <span className="slot-empty">{throne ? "王座" : slot.startsWith("deploy-") ? "可部署" : slotLabel(slot)}</span>}
  </div>;
}
function rangeStyle(piece: Piece) { const point = deploymentPoint(piece.slotId); const radius = Math.min(48, effectiveAttackRange(piece)); return { left: `${point.x - radius}%`, top: `${point.y - radius * MAP_ASPECT_RATIO}%`, width: `${radius * 2}%`, height: `${radius * 2 * MAP_ASPECT_RATIO}%` }; }
