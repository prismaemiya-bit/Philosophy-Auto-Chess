export const SOUND_CUE_IDS = [
  "ui.purchase", "ui.refresh", "ui.deploy", "ui.sell", "ui.wave-start",
  "ui.merge", "ui.level-up", "ui.freeze",
  "combat.attack", "combat.cast", "combat.block", "combat.leak",
  "history.event", "history.ideology", "boss.arrival", "boss.phase",
  "result.wave-clear", "result.victory", "result.defeat",
] as const;

export const MUSIC_TRACK_IDS = [
  "menu", "preparation", "battle", "boss", "victory", "defeat",
] as const;

export type SoundCueId = (typeof SOUND_CUE_IDS)[number];
export type MusicTrackId = (typeof MUSIC_TRACK_IDS)[number];
export type SoundAssetRegistry = Partial<Record<SoundCueId, string>>;
export type AudioAsset = { source: string; gain?: number };
export type AudioAssetManifest = {
  effects: Partial<Record<SoundCueId, AudioAsset>>;
  music: Partial<Record<MusicTrackId, AudioAsset & { loop?: boolean }>>;
};

/**
 * Stable contributor-facing asset contract. Adding files only requires filling
 * this manifest; game rules and React event wiring must not depend on media.
 */
export const audioAssets: AudioAssetManifest = {
  effects: {
    "ui.purchase": { source: "/assets/audio/ui-purchase.wav", gain: .7 },
    "ui.refresh": { source: "/assets/audio/ui-refresh.wav", gain: .62 },
    "ui.deploy": { source: "/assets/audio/ui-deploy.wav", gain: .6 },
    "ui.sell": { source: "/assets/audio/ui-sell.wav", gain: .62 },
    "ui.wave-start": { source: "/assets/audio/ui-wave-start.wav", gain: .72 },
    "ui.merge": { source: "/assets/audio/ui-merge.wav", gain: .72 },
    "ui.level-up": { source: "/assets/audio/ui-level-up.wav", gain: .72 },
    "ui.freeze": { source: "/assets/audio/ui-freeze.wav", gain: .55 },
    "combat.attack": { source: "/assets/audio/combat-attack.wav", gain: .38 },
    "combat.cast": { source: "/assets/audio/combat-cast.wav", gain: .46 },
    "combat.block": { source: "/assets/audio/combat-block.wav", gain: .46 },
    "combat.leak": { source: "/assets/audio/combat-leak.wav", gain: .72 },
    "history.event": { source: "/assets/audio/history-event.wav", gain: .68 },
    "history.ideology": { source: "/assets/audio/history-ideology.wav", gain: .68 },
    "boss.arrival": { source: "/assets/audio/boss-arrival.wav", gain: .7 },
    "boss.phase": { source: "/assets/audio/boss-phase.wav", gain: .65 },
    "result.wave-clear": { source: "/assets/audio/result-wave-clear.wav", gain: .62 },
    "result.victory": { source: "/assets/audio/result-victory.wav", gain: .72 },
    "result.defeat": { source: "/assets/audio/result-defeat.wav", gain: .64 },
  },
  music: {},
};
/** Backward-compatible effect registry used by the original file-cue gate. */
export const soundAssets: SoundAssetRegistry = {};

export const AUDIO_SETTINGS_KEY = "philosophy-auto-chess-audio-v1";
export const AUDIO_SETTINGS_VERSION = 2;
export type AudioSettings = {
  version: typeof AUDIO_SETTINGS_VERSION;
  musicVolume: number;
  effectsVolume: number;
  muted: boolean;
};
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  version: AUDIO_SETTINGS_VERSION,
  musicVolume: .28,
  effectsVolume: .3,
  muted: false,
};

const normalizedVolume = (value: unknown, fallback: number) => (
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback
);

export function migrateAudioSettings(input: unknown): AudioSettings {
  if (!input || typeof input !== "object") return { ...DEFAULT_AUDIO_SETTINGS };
  const raw = input as Partial<AudioSettings> & { volume?: unknown };
  const legacyVolume = normalizedVolume(raw.volume, DEFAULT_AUDIO_SETTINGS.effectsVolume);
  const hasLegacyVolume = typeof raw.volume === "number" && Number.isFinite(raw.volume);
  return {
    version: AUDIO_SETTINGS_VERSION,
    musicVolume: normalizedVolume(raw.musicVolume, hasLegacyVolume ? legacyVolume : DEFAULT_AUDIO_SETTINGS.musicVolume),
    effectsVolume: normalizedVolume(raw.effectsVolume, hasLegacyVolume ? legacyVolume : DEFAULT_AUDIO_SETTINGS.effectsVolume),
    muted: raw.muted === true,
  };
}

export const serializeAudioSettings = (settings: AudioSettings) => JSON.stringify(migrateAudioSettings(settings));

export class SoundCueGate {
  private readonly seen = new Set<string>();

  constructor(private readonly assets: SoundAssetRegistry = soundAssets, private readonly historyLimit = 512) {}

  emit(cueId: SoundCueId, occurrenceId: string, play: (source: string, cueId: SoundCueId) => void = playBrowserSound) {
    const token = `${cueId}:${occurrenceId}`;
    if (this.seen.has(token)) return false;
    this.seen.add(token);
    if (this.seen.size > this.historyLimit) this.seen.delete(this.seen.values().next().value ?? "");
    const source = this.assets[cueId];
    if (!source) return false;
    try { play(source, cueId); return true; } catch { return false; }
  }

  reset() { this.seen.clear(); }
}

export function playBrowserSound(source: string) {
  if (!source || typeof Audio === "undefined") return;
  try {
    const audio = new Audio(source);
    void audio.play().catch(() => undefined);
  } catch {
    // Missing/unsupported audio is presentation-only and must never break play.
  }
}

export type SynthNote = {
  frequency: number;
  endFrequency?: number;
  offset?: number;
  gain: number;
  wave: "sine" | "triangle";
};
export type SynthCueProfile = {
  duration: number;
  attack: number;
  lowpass: number;
  notes: readonly SynthNote[];
};

/**
 * Quiet, rounded fallback motifs. Formal audio files can still replace any cue
 * through audioAssets; these profiles avoid the harsh square/saw beeps used by
 * the first interface-only implementation.
 */
export const SYNTH_CUE_PROFILES: Record<SoundCueId, SynthCueProfile> = {
  "ui.purchase": { duration: .105, attack: .008, lowpass: 2200, notes: [{ frequency: 523.25, gain: .065, wave: "sine" }, { frequency: 659.25, offset: .038, gain: .052, wave: "sine" }] },
  "ui.refresh": { duration: .095, attack: .007, lowpass: 2100, notes: [{ frequency: 392, endFrequency: 466.16, gain: .048, wave: "triangle" }, { frequency: 587.33, offset: .035, gain: .036, wave: "sine" }] },
  "ui.deploy": { duration: .105, attack: .006, lowpass: 1500, notes: [{ frequency: 196, endFrequency: 174.61, gain: .058, wave: "triangle" }, { frequency: 293.66, offset: .018, gain: .032, wave: "sine" }] },
  "ui.sell": { duration: .12, attack: .007, lowpass: 1900, notes: [{ frequency: 523.25, endFrequency: 392, gain: .052, wave: "sine" }, { frequency: 261.63, offset: .045, gain: .035, wave: "triangle" }] },
  "ui.wave-start": { duration: .18, attack: .012, lowpass: 1600, notes: [{ frequency: 146.83, endFrequency: 196, gain: .072, wave: "triangle" }, { frequency: 293.66, offset: .06, gain: .038, wave: "sine" }] },
  "ui.merge": { duration: .22, attack: .012, lowpass: 2200, notes: [{ frequency: 392, gain: .046, wave: "sine" }, { frequency: 523.25, offset: .055, gain: .04, wave: "sine" }, { frequency: 659.25, offset: .11, gain: .034, wave: "sine" }] },
  "ui.level-up": { duration: .26, attack: .014, lowpass: 2200, notes: [{ frequency: 261.63, gain: .045, wave: "sine" }, { frequency: 392, offset: .065, gain: .04, wave: "sine" }, { frequency: 523.25, offset: .13, gain: .035, wave: "sine" }] },
  "ui.freeze": { duration: .16, attack: .014, lowpass: 2500, notes: [{ frequency: 493.88, gain: .035, wave: "sine" }, { frequency: 739.99, offset: .035, gain: .022, wave: "sine" }] },
  "combat.attack": { duration: .04, attack: .003, lowpass: 1000, notes: [{ frequency: 155.56, endFrequency: 110, gain: .027, wave: "triangle" }] },
  "combat.cast": { duration: .12, attack: .01, lowpass: 2400, notes: [{ frequency: 523.25, endFrequency: 698.46, gain: .035, wave: "sine" }, { frequency: 783.99, offset: .045, gain: .025, wave: "sine" }] },
  "combat.block": { duration: .075, attack: .003, lowpass: 850, notes: [{ frequency: 110, endFrequency: 82.41, gain: .04, wave: "triangle" }, { frequency: 164.81, gain: .022, wave: "sine" }] },
  "combat.leak": { duration: .23, attack: .008, lowpass: 1200, notes: [{ frequency: 196, endFrequency: 98, gain: .07, wave: "triangle" }, { frequency: 146.83, offset: .055, endFrequency: 73.42, gain: .035, wave: "sine" }] },
  "history.event": { duration: .2, attack: .014, lowpass: 2000, notes: [{ frequency: 261.63, gain: .052, wave: "triangle" }, { frequency: 392, offset: .05, gain: .04, wave: "sine" }, { frequency: 523.25, offset: .1, gain: .032, wave: "sine" }] },
  "history.ideology": { duration: .18, attack: .012, lowpass: 2200, notes: [{ frequency: 329.63, gain: .045, wave: "sine" }, { frequency: 415.3, offset: .045, gain: .038, wave: "sine" }, { frequency: 493.88, offset: .09, gain: .03, wave: "sine" }] },
  "boss.arrival": { duration: .32, attack: .02, lowpass: 720, notes: [{ frequency: 73.42, endFrequency: 61.74, gain: .085, wave: "triangle" }, { frequency: 110, offset: .06, endFrequency: 92.5, gain: .04, wave: "sine" }] },
  "boss.phase": { duration: .22, attack: .012, lowpass: 950, notes: [{ frequency: 98, endFrequency: 82.41, gain: .068, wave: "triangle" }, { frequency: 146.83, offset: .05, gain: .033, wave: "sine" }] },
  "result.wave-clear": { duration: .24, attack: .014, lowpass: 2200, notes: [{ frequency: 329.63, gain: .042, wave: "sine" }, { frequency: 415.3, offset: .06, gain: .037, wave: "sine" }, { frequency: 493.88, offset: .12, gain: .032, wave: "sine" }] },
  "result.victory": { duration: .28, attack: .014, lowpass: 2400, notes: [{ frequency: 392, gain: .052, wave: "sine" }, { frequency: 523.25, offset: .065, gain: .047, wave: "sine" }, { frequency: 659.25, offset: .13, gain: .042, wave: "sine" }] },
  "result.defeat": { duration: .3, attack: .014, lowpass: 1350, notes: [{ frequency: 220, endFrequency: 196, gain: .055, wave: "triangle" }, { frequency: 164.81, offset: .075, endFrequency: 146.83, gain: .044, wave: "sine" }, { frequency: 110, offset: .15, gain: .032, wave: "sine" }] },
};

let sharedAudioContext: AudioContext | undefined;
let activeSynthVoices = 0;
const MAX_SYNTH_VOICES = 4;

function browserAudioContext() {
  if (typeof globalThis === "undefined") return undefined;
  const constructor = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!constructor) return undefined;
  if (!sharedAudioContext || sharedAudioContext.state === "closed") sharedAudioContext = new constructor();
  return sharedAudioContext;
}

/** Resume the shared context directly from a user gesture so later cues start immediately. */
export function primeBrowserAudio(): boolean {
  try {
    const context = browserAudioContext();
    if (!context) return false;
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** A tiny synthesized cue. Unsupported audio and autoplay rejection are presentation-only. */
export function playSynthCue(cueId: SoundCueId, settings: AudioSettings): boolean {
  const normalized = migrateAudioSettings(settings);
  if (normalized.muted || normalized.effectsVolume <= 0 || activeSynthVoices >= MAX_SYNTH_VOICES) return false;
  try {
    const context = browserAudioContext();
    if (!context) return false;
    const schedule = () => {
      if (context.state === "closed" || activeSynthVoices >= MAX_SYNTH_VOICES) return;
      const profile = SYNTH_CUE_PROFILES[cueId];
      const now = context.currentTime;
      const nodes: Array<{ oscillator: OscillatorNode; gain: GainNode; filter: BiquadFilterNode }> = [];
      let ended = 0;
      activeSynthVoices += 1;
      for (const note of profile.notes) {
        const start = now + (note.offset ?? 0);
        const end = start + profile.duration;
        const oscillator = context.createOscillator();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();
        nodes.push({ oscillator, gain, filter });
        oscillator.type = note.wave;
        oscillator.frequency.setValueAtTime(note.frequency, start);
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, note.endFrequency ?? note.frequency), end);
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(profile.lowpass, start);
        filter.Q.setValueAtTime(.55, start);
        gain.gain.setValueAtTime(.0001, start);
        gain.gain.exponentialRampToValueAtTime(Math.max(.0001, note.gain * normalized.effectsVolume), start + profile.attack);
        gain.gain.exponentialRampToValueAtTime(.0001, end);
        oscillator.connect(filter); filter.connect(gain); gain.connect(context.destination);
        oscillator.onended = () => {
          ended += 1;
          oscillator.disconnect(); filter.disconnect(); gain.disconnect();
          if (ended === nodes.length) activeSynthVoices = Math.max(0, activeSynthVoices - 1);
        };
        oscillator.start(start);
        oscillator.stop(end);
      }
    };
    if (context.state === "suspended") void context.resume().then(schedule).catch(() => undefined); else schedule();
    return true;
  } catch {
    return false;
  }
}

type BrowserAudioLike = {
  loop: boolean;
  muted: boolean;
  preload: string;
  volume: number;
  currentTime: number;
  playbackRate?: number;
  play: () => Promise<void> | void;
  pause: () => void;
};
export type BrowserAudioFactory = (source: string) => BrowserAudioLike | undefined;

const makeBrowserAudio: BrowserAudioFactory = (source) => {
  if (!source || typeof Audio === "undefined") return undefined;
  try { return new Audio(source); } catch { return undefined; }
};

const assetGain = (asset: AudioAsset) => normalizedVolume(asset.gain, 1);

const stableVariation = (token: string) => {
  let hash = 2_166_136_261;
  for (const character of token) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  return ((hash >>> 0) % 9 - 4) / 100;
};

/** Plays a registered effect file, falling back to the bounded synth when absent. */
export function playSoundEffectCue(cueId: SoundCueId, settings: AudioSettings, occurrenceId: string = cueId): boolean {
  const normalized = migrateAudioSettings(settings);
  if (normalized.muted || normalized.effectsVolume <= 0) return false;
  const asset = audioAssets.effects[cueId];
  if (!asset) return playSynthCue(cueId, normalized);
  const media = makeBrowserAudio(asset.source);
  if (!media) return playSynthCue(cueId, normalized);
  try {
    media.preload = "auto";
    media.volume = normalized.effectsVolume * assetGain(asset);
    media.muted = normalized.muted;
    if (typeof media.playbackRate === "number") media.playbackRate = 1 + stableVariation(`${cueId}:${occurrenceId}`);
    void Promise.resolve(media.play()).catch(() => undefined);
    return true;
  } catch {
    return playSynthCue(cueId, normalized);
  }
}

/**
 * Owns one looping music element. Missing files, autoplay rejection and media
 * errors remain presentation-only and never alter game state.
 */
export class MusicTrackPlayer {
  private current?: { id: MusicTrackId; media: BrowserAudioLike; gain: number };
  private requested?: MusicTrackId;
  private settings: AudioSettings;

  constructor(
    settings: AudioSettings = DEFAULT_AUDIO_SETTINGS,
    private readonly assets = audioAssets.music,
    private readonly createAudio: BrowserAudioFactory = makeBrowserAudio,
  ) {
    this.settings = migrateAudioSettings(settings);
  }

  setSettings(settings: AudioSettings) {
    const wasAudible = !this.settings.muted && this.settings.musicVolume > 0;
    this.settings = migrateAudioSettings(settings);
    this.applySettings();
    if (!wasAudible && !this.settings.muted && this.settings.musicVolume > 0) this.resume();
  }

  setTrack(trackId?: MusicTrackId) {
    this.requested = trackId;
    if (!trackId) { this.stop(); return false; }
    if (this.current?.id === trackId) { this.applySettings(); return this.resume(); }
    this.stop();
    const asset = this.assets[trackId];
    if (!asset?.source) return false;
    const media = this.createAudio(asset.source);
    if (!media) return false;
    media.loop = asset.loop !== false;
    media.preload = "auto";
    this.current = { id: trackId, media, gain: assetGain(asset) };
    this.applySettings();
    return this.resume();
  }

  resume() {
    if (!this.current || this.settings.muted || this.settings.musicVolume <= 0) return false;
    try {
      void Promise.resolve(this.current.media.play()).catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  stop() {
    if (!this.current) return;
    try {
      this.current.media.pause();
      this.current.media.currentTime = 0;
    } catch {
      // A detached or unsupported media element is safe to abandon.
    }
    this.current = undefined;
  }

  requestedTrack() { return this.requested; }
  activeTrack() { return this.current?.id; }

  private applySettings() {
    if (!this.current) return;
    try {
      this.current.media.volume = normalizedVolume(this.settings.musicVolume * this.current.gain, 0);
      this.current.media.muted = this.settings.muted;
      if (this.settings.muted || this.settings.musicVolume <= 0) this.current.media.pause();
    } catch {
      // Volume and mute failures must not escape into the game loop.
    }
  }
}

export function musicTrackForScene(scene: {
  started: boolean;
  battleStatus?: string;
  hasBoss?: boolean;
}): MusicTrackId {
  if (!scene.started) return "menu";
  if (scene.battleStatus === "complete") return "victory";
  if (scene.battleStatus === "defeat") return "defeat";
  if (scene.battleStatus === "running") return scene.hasBoss ? "boss" : "battle";
  return "preparation";
}

export type SoundCuePolicy = {
  cooldownMs: number;
  globalIntervalMs: number;
  priority: 0 | 1 | 2;
  quietWindowMs: number;
};

/**
 * Perceptual mix policy. Repeated combat texture yields to decisions and
 * warnings; important cues reserve a short pocket of silence around themselves.
 */
export const SOUND_CUE_POLICIES: Record<SoundCueId, SoundCuePolicy> = {
  "ui.purchase": { cooldownMs: 70, globalIntervalMs: 45, priority: 1, quietWindowMs: 0 },
  "ui.refresh": { cooldownMs: 120, globalIntervalMs: 55, priority: 1, quietWindowMs: 0 },
  "ui.deploy": { cooldownMs: 90, globalIntervalMs: 50, priority: 1, quietWindowMs: 0 },
  "ui.sell": { cooldownMs: 100, globalIntervalMs: 50, priority: 1, quietWindowMs: 0 },
  "ui.wave-start": { cooldownMs: 700, globalIntervalMs: 80, priority: 2, quietWindowMs: 280 },
  "ui.merge": { cooldownMs: 500, globalIntervalMs: 70, priority: 2, quietWindowMs: 180 },
  "ui.level-up": { cooldownMs: 650, globalIntervalMs: 70, priority: 2, quietWindowMs: 240 },
  "ui.freeze": { cooldownMs: 180, globalIntervalMs: 55, priority: 1, quietWindowMs: 0 },
  "combat.attack": { cooldownMs: 240, globalIntervalMs: 70, priority: 0, quietWindowMs: 0 },
  "combat.cast": { cooldownMs: 210, globalIntervalMs: 65, priority: 1, quietWindowMs: 0 },
  "combat.block": { cooldownMs: 260, globalIntervalMs: 70, priority: 1, quietWindowMs: 0 },
  "combat.leak": { cooldownMs: 600, globalIntervalMs: 80, priority: 2, quietWindowMs: 420 },
  "history.event": { cooldownMs: 900, globalIntervalMs: 100, priority: 2, quietWindowMs: 520 },
  "history.ideology": { cooldownMs: 900, globalIntervalMs: 100, priority: 2, quietWindowMs: 520 },
  "boss.arrival": { cooldownMs: 900, globalIntervalMs: 100, priority: 2, quietWindowMs: 620 },
  "boss.phase": { cooldownMs: 700, globalIntervalMs: 90, priority: 2, quietWindowMs: 480 },
  "result.wave-clear": { cooldownMs: 700, globalIntervalMs: 90, priority: 2, quietWindowMs: 460 },
  "result.victory": { cooldownMs: 1_200, globalIntervalMs: 100, priority: 2, quietWindowMs: 900 },
  "result.defeat": { cooldownMs: 1_200, globalIntervalMs: 100, priority: 2, quietWindowMs: 900 },
};

export class SoundEffectPlayer {
  private readonly seen = new Set<string>();
  private readonly lastByCue = new Map<SoundCueId, number>();
  private lastPlayedAt = Number.NEGATIVE_INFINITY;
  private quietUntil = Number.NEGATIVE_INFINITY;

  constructor(
    private settings: AudioSettings = DEFAULT_AUDIO_SETTINGS,
    private readonly now: () => number = Date.now,
    private readonly play: (cueId: SoundCueId, settings: AudioSettings, occurrenceId: string) => boolean = playSoundEffectCue,
    private readonly historyLimit = 512,
  ) {}

  setSettings(settings: AudioSettings) { this.settings = migrateAudioSettings(settings); }

  emit(cueId: SoundCueId, occurrenceId: string) {
    const token = `${cueId}:${occurrenceId}`;
    if (this.seen.has(token)) return false;
    this.seen.add(token);
    if (this.seen.size > this.historyLimit) this.seen.delete(this.seen.values().next().value ?? "");
    const timestamp = this.now();
    const policy = SOUND_CUE_POLICIES[cueId];
    if (policy.priority < 2 && timestamp < this.quietUntil) return false;
    if (timestamp - this.lastPlayedAt < policy.globalIntervalMs || timestamp - (this.lastByCue.get(cueId) ?? Number.NEGATIVE_INFINITY) < policy.cooldownMs) return false;
    if (this.settings.muted || this.settings.effectsVolume <= 0) return false;
    try {
      if (!this.play(cueId, this.settings, occurrenceId)) return false;
      this.lastPlayedAt = timestamp;
      this.lastByCue.set(cueId, timestamp);
      if (policy.quietWindowMs > 0) this.quietUntil = Math.max(this.quietUntil, timestamp + policy.quietWindowMs);
      return true;
    } catch {
      return false;
    }
  }

  reset() { this.seen.clear(); this.lastByCue.clear(); this.lastPlayedAt = Number.NEGATIVE_INFINITY; this.quietUntil = Number.NEGATIVE_INFINITY; }
}

export const battleSoundCueForEvent = (event: { type: string; message?: string }): SoundCueId | undefined => {
  if (event.type === "attack" || event.type === "hit" || event.type === "enemyHit") return "combat.attack";
  if (event.type === "skill" || event.type === "synergy" || event.type === "echo" || event.type === "debuff") return "combat.cast";
  if (event.type === "core") return "combat.leak";
  if (event.type === "barrierHit" || event.type === "barrierBreak" || event.type === "shield" || event.message?.includes("阻挡")) return "combat.block";
  return undefined;
};
