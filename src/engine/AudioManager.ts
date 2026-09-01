/**
 * @module engine/AudioManager
 * Modular Web Audio sound engine (it.18): BGM + SFX with per-bus gains.
 *
 * REAL TRACKS (public/assets/audio) carry the atmosphere:
 *   - mystic-reveal        → intro sting on first interaction
 *   - dark-mystery         → looping dungeon BGM (starts after the intro)
 *   - war-horn             → a boss is sighted
 *   - dark-magic-4 / -6    → fire-bolt cast / boss death undertone
 *   - dark-spell-chant     → the Hollow King's summoning
 * PUNCHY COMBAT SFX (swing/hit/crit/pickup/UI…) are SYNTHESIZED with the
 * Web Audio API in a crisp retro voice (noise bursts + square/triangle
 * envelopes — the Diablo 1 / GBA fidelity band), so no essential effect
 * can ever be a missing file.
 *
 * Browser autoplay policy: everything stays silent until `unlock()` fires
 * on the first user gesture (main wires pointerdown/keydown).
 * Volumes (master/bgm/sfx/muted) persist in localStorage.
 *
 * RENDER-SIDE ONLY: nothing here touches simulation state.
 */

export type SfxName =
  | 'swing'
  | 'enemySwing'
  | 'miss'
  | 'hit'
  | 'crit'
  | 'bow'
  | 'bolt'
  | 'boltImpact'
  | 'arrowHit'
  | 'hurt'
  | 'freeze'
  | 'step'
  | 'enemyDie'
  | 'bossDie'
  | 'bossHorn'
  | 'summon'
  | 'gore'
  | 'gateOpen'
  | 'bossCast'
  | 'arrowWall'
  | 'equip'
  | 'pickup'
  | 'gold'
  | 'levelUp'
  | 'enemyHit'
  | 'enemyGrowl'
  | 'chest'
  | 'stairs'
  | 'ui'
  | 'victory'
  | 'skillWhirl'
  | 'skillDash'
  | 'skillShout'
  | 'skillBuff'
  | 'skillFire'
  | 'skillArrows'
  | 'skillTrap'
  | 'skillTrapSet'
  | 'skillPoison'
  | 'skillVanish';

// Base-aware root (it.31): '/' in dev, '/isometric-game/' on GitHub Pages.
const AUDIO_BASE = `${import.meta.env.BASE_URL}assets/audio`;
const FILES = {
  intro: `${AUDIO_BASE}/universfield-mystic-reveal-567294.mp3`,
  bgm: `${AUDIO_BASE}/universfield-dark-mystery-cinematic-485921.mp3`,
  bgmDeep: `${AUDIO_BASE}/alesiadavina-dark-demonic-atmosphere-gloomy-horror-drone-sfx-541953.mp3`,
  horn: `${AUDIO_BASE}/kave_msri-war-horn-sfx-319881.mp3`,
  magic4: `${AUDIO_BASE}/yodguard-dark-magic-4-378653.mp3`,
  magic6: `${AUDIO_BASE}/yodguard-dark-magic-6-378652.mp3`,
  chant: `${AUDIO_BASE}/yodguard-dark-spell-chant-3-533018.mp3`,
  beast: `${AUDIO_BASE}/alesiadavina-demonic-presence-detected-dark-beast-breathing-sfx-543185.mp3`,
  doom: `${AUDIO_BASE}/alesiadavina-unleashed-demon-ambience-dark-cinematic-horror-drone-543191.mp3`,
} as const;

/**
 * The Fantasy SFX pack (TomMusic, OGG set): VARIANT BANKS per event —
 * each trigger picks a random take with slight pitch jitter, the classic
 * ARPG trick that keeps a thousand sword-hits from sounding like a loop.
 */
const PACK = `${AUDIO_BASE}/Free Fantasy SFX Pack By TomMusic/OGG Files/SFX`;
const SWORDS = `${PACK}/Attacks/Sword Attacks Hits and Blocks`;
const BOWS = `${PACK}/Attacks/Bow Attacks Hits and Blocks`;
const VARIANTS: Record<string, string[]> = {
  swordAttack: [1, 2, 3].map((n) => `${SWORDS}/Sword Attack ${n}.ogg`),
  swordHit: [1, 2, 3].map((n) => `${SWORDS}/Sword Impact Hit ${n}.ogg`),
  swordBlocked: [1, 2, 3].map((n) => `${SWORDS}/Sword Blocked ${n}.ogg`),
  parry: [1, 2, 3].map((n) => `${SWORDS}/Sword Parry ${n}.ogg`),
  sheath: [1, 2].map((n) => `${SWORDS}/Sword Sheath ${n}.ogg`),
  bowAttack: [1, 2].map((n) => `${BOWS}/Bow Attack ${n}.ogg`),
  bowHit: [1, 2, 3].map((n) => `${BOWS}/Bow Impact Hit ${n}.ogg`),
  chop: [1, 2, 3, 4].map((n) => `${PACK}/Chopping and Mining/chop ${n}.ogg`),
  fireball: [1, 2, 3].map((n) => `${PACK}/Spells/Fireball ${n}.ogg`),
  spellImpact: [1, 2, 3].map((n) => `${PACK}/Spells/Spell Impact ${n}.ogg`),
  iceFreeze: [1, 2].map((n) => `${PACK}/Spells/Ice Freeze ${n}.ogg`),
  chestOpen: [1, 2].map((n) => `${PACK}/Doors Gates and Chests/Chest Open ${n}.ogg`),
  stoneRun: [1, 2, 3, 4, 5].map((n) => `${PACK}/Footsteps/Stone/Stone Run ${n}.ogg`),
  // Level-up shimmer + coin clink.
  firebuff: [1, 2].map((n) => `${PACK}/Spells/Firebuff ${n}.ogg`),
  coin: [`${PACK}/Doors Gates and Chests/Lock Unlock.ogg`],
  // It.26 deep-scan round 2: the pack's unused corners, mapped.
  gateOpen: [`${PACK}/Doors Gates and Chests/Gate Open.ogg`],
  firespray: [1, 2].map((n) => `${PACK}/Spells/Firespray ${n}.ogg`),
  bowBlocked: [1, 2, 3].map((n) => `${BOWS}/Bow Blocked ${n}.ogg`),
  unsheath: [1, 2].map((n) => `${SWORDS}/Sword Unsheath ${n}.ogg`),
  // Ambient stinger material: distant doors and gates groaning in the dark.
  creak: [
    `${PACK}/Doors Gates and Chests/Door Open 1.ogg`,
    `${PACK}/Doors Gates and Chests/Door Open 2.ogg`,
    `${PACK}/Doors Gates and Chests/Door Close 1.ogg`,
    `${PACK}/Doors Gates and Chests/Gate Open.ogg`,
    `${PACK}/Doors Gates and Chests/Lock Unlock.ogg`,
  ],
};

/** Looping ambient bed: the pack's cave atmosphere, under everything. */
const AMBIENT_BED = `${PACK.replace('/SFX', '')}/BGS Loops/Cave/Cave.ogg`;

/**
 * BOSS FIGHT MUSIC (it.28, exact path public/assets/audio/boss fight):
 * one intense track per warden's arena; crossfaded in when the arena
 * seals and back out when it is fully cleared.
 */
const BOSS_MUSIC_DIR = `${AUDIO_BASE}/boss fight`;
const BOSS_TRACKS: Record<number, string> = {
  5: `${BOSS_MUSIC_DIR}/2. Shadowforge Convergence.mp3`,
  10: `${BOSS_MUSIC_DIR}/6. Veil of Eternal Nightfall.mp3`,
  15: `${BOSS_MUSIC_DIR}/3. Eclipsed Desolation.mp3`,
  20: `${BOSS_MUSIC_DIR}/5. Dread March .mp3`, // (Filename really has the space.)
};
const BOSS_TRACK_DEFAULT = `${BOSS_MUSIC_DIR}/1. Whispers of the Abyss.mp3`;

/**
 * HORROR SFX hard-map (it.25, from the exact path
 * public/assets/audio/Horror SFX Free): screams, gore impacts, monster
 * voices, boss roars, dissonant stingers, and long ambient dread.
 */
const HORROR = `${AUDIO_BASE}/Horror SFX Free`;
const HG = `${HORROR}/Monsters & Ghosts`;
const HA = `${HORROR}/Ambient`;
const HS = `${HORROR}/Stingers and Spooky Triggers`;
const HORROR_BANKS: Record<string, string[]> = {
  hScream: [`${HA}/Scream.wav`, `${HG}/Ghost_scream_3.wav`, `${HA}/Distant Yell_Echo and Reverb_2.wav`],
  hZombie: [`${HG}/Zombie.wav`, `${HG}/Zombie_6.wav`, `${HG}/Zombie_8.wav`],
  hGrowl: [`${HG}/Monster_growl_1.wav`, `${HG}/Monster_growl_5.wav`, `${HG}/Monster_breath.wav`],
  hGrunt: [`${HG}/Monster_grunt x2 (ghmmm).wav`, `${HG}/Monster_grunt_long.wav`],
  hHiss: [`${HG}/Hiss.wav`],
  hRoar: [`${HG}/Monster_Roar_2.wav`, `${HG}/Monster_Roar_4.wav`],
  hGore: [`${HG}/Gore_Wet_4.wav`, `${HG}/Gore_Wet_7.wav`, `${HG}/Gore_Ripping_4.wav`, `${HG}/Gore_Ripping_5.wav`, `${HG}/Bite.wav`],
  hHurt: [`${HG}/Injured.wav`, `${HORROR}/Character/Gasp.wav`, `${HORROR}/Character/Gasp_3.wav`],
  hMoan: [`${HG}/Ghost_moan_2.wav`, `${HG}/Tone_Moaning.wav`],
  hStinger: [`${HS}/Piano_stinger_dissonent.wav`, `${HS}/Piano_stinger_dissonent_2.wav`, `${HS}/Stinger.wav`, `${HS}/Metal_resonance.wav`, `${HA}/Bell_low.wav`],
  hAmbience: [`${HA}/Creepy_ambience_3.wav`, `${HA}/Creepy_ambience_5.wav`, `${HS}/Spooky Ambience.wav`, `${HA}/Drone_doom.wav`, `${HG}/Ghost chior.wav`, `${HA}/Old House_creeky metal and wood_ambiance_7.wav`],
};

const STORAGE_KEY = 'iso-arpg-audio';

interface AudioSettings {
  master: number;
  bgm: number;
  sfx: number;
  amb: number;
  muted: boolean;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain!: GainNode;
  private bgmGain!: GainNode;
  private sfxGain!: GainNode;
  /** The AMBIENT channel: cave bed + random stingers, mixed apart from
   *  music and combat so layers never fight (it.21). */
  private ambGain!: GainNode;
  private unlocked = false;
  private introEl: HTMLAudioElement | null = null;
  private bgmEl: HTMLAudioElement | null = null;
  private ambEl: HTMLAudioElement | null = null;
  /** Wall-clock time before which no new ambient stinger may start —
   *  the NON-OVERLAP guarantee (one stinger at a time, with breathing room). */
  private stingerQuietUntil = 0;
  private readonly buffers = new Map<string, AudioBuffer>();
  private noiseBuffer: AudioBuffer | null = null;
  /** Simple throttle so spammy events can't stack into clipping. */
  private readonly lastPlayed = new Map<SfxName, number>();

  settings: AudioSettings = { master: 0.8, bgm: 0.5, sfx: 0.7, amb: 0.5, muted: false };

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.settings = { ...this.settings, ...(JSON.parse(raw) as Partial<AudioSettings>) };
    } catch {
      /* storage unavailable — defaults */
    }
  }

  /** First user gesture: build the graph, play the reveal, then loop BGM. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.bgmGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.ambGain = this.ctx.createGain();
      this.bgmGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.ambGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
      this.applyVolumes();
      void this.ctx.resume();

      // Shared noise source for the synth voices.
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      // File-based SFX decode lazily in the background (guarded — a missing
      // file falls back to the synth voice, never an engine halt).
      for (const key of ['horn', 'magic6', 'chant', 'beast', 'doom'] as const) {
        void this.loadBuffer(key, FILES[key]);
      }
      // The Fantasy-pack variant banks (small oggs, decoded in background).
      for (const [group, urls] of Object.entries(VARIANTS)) {
        urls.forEach((url, i) => void this.loadBuffer(`${group}_${i}`, url));
      }
      // The Horror SFX banks (it.25) — same variant machinery.
      for (const [group, urls] of Object.entries(HORROR_BANKS)) {
        urls.forEach((url, i) => void this.loadBuffer(`${group}_${i}`, url));
      }
      // Probe the numbered voice-pack folders (activates them if real
      // audio data ever lands there — currently 0-byte stubs).
      void this.probeVoicePack();

      // THE REVEAL: the mystic intro sting, then the dark-mystery loop.
      this.introEl = this.hookMediaElement(FILES.intro, false);
      this.bgmEl = this.hookMediaElement(FILES.bgm, true);
      // The cave breathes underneath everything (own channel, quiet loop).
      this.ambEl = this.hookMediaElement(AMBIENT_BED, true, this.ambGain);
      if (this.ambEl) {
        this.ambEl.volume = 0.55;
        this.ambEl.play().catch(() => undefined);
      }
      // Random atmospheric stingers: checked every 4 s, at most ONE at a
      // time and never inside another's quiet window (non-overlap).
      // It.27 density boost: tighter check interval + shorter quiet gaps.
      window.setInterval(() => this.maybeStinger(), 4000);
      this.stingerQuietUntil = performance.now() + 15000; // Let the intro land first.
      const startBgm = (): void => {
        if (this.bgmEl) void this.bgmEl.play().catch(() => undefined);
      };
      if (this.introEl) {
        this.introEl.addEventListener('ended', startBgm, { once: true });
        this.introEl.play().catch(() => this.retryOnNextGesture());
        // Safety: if the intro stalls, the loop still arrives.
        setTimeout(() => {
          if (this.introEl && this.introEl.ended) return;
          if (this.bgmEl && this.bgmEl.paused && this.introEl?.paused !== false) startBgm();
        }, 12000);
      } else {
        startBgm();
      }
    } catch (err) {
      console.warn('[Audio] Web Audio unavailable:', err);
      this.ctx = null;
    }
  }

  /**
   * If the first play was rejected (a synthetic "gesture" that the browser
   * didn't honor), re-arm on the next REAL gesture: intro → bgm chain.
   */
  private retryOnNextGesture(): void {
    const retry = (): void => {
      void this.ctx?.resume();
      if (this.introEl && !this.introEl.ended) {
        this.introEl.play().catch(() => undefined);
      } else if (this.bgmEl) {
        void this.bgmEl.play().catch(() => undefined);
      }
      this.ambEl?.play().catch(() => undefined);
    };
    window.addEventListener('pointerdown', retry, { once: true });
    window.addEventListener('keydown', retry, { once: true });
  }

  private hookMediaElement(url: string, loop: boolean, bus?: GainNode): HTMLAudioElement | null {
    if (!this.ctx) return null;
    try {
      const el = new Audio(encodeURI(url));
      el.loop = loop;
      el.crossOrigin = 'anonymous';
      const src = this.ctx.createMediaElementSource(el);
      src.connect(bus ?? this.bgmGain);
      return el;
    } catch {
      return null;
    }
  }

  /**
   * Occasionally let the dungeon SPEAK: a distant door groan, a gate, or a
   * beast's breath — played through the AMBIENT bus at low volume. A quiet
   * window after each stinger guarantees they never stack or clash.
   */
  private maybeStinger(): void {
    if (!this.ctx || this.settings.muted) return;
    const now = performance.now();
    if (now < this.stingerQuietUntil) return;
    if (Math.random() < 0.25) return; // Unpredictable, but rarely silent long.
    let played = false;
    const roll = Math.random();
    if (this.voicePools.has('ambient') && roll < 0.2) {
      played = this.playPool('ambient', 0.85, 0.14);
    } else if (roll < 0.4) {
      // HORROR ambient dread: a long creepy soundscape, very low (it.25).
      played = this.playVariant('hAmbience', 0.2, 0.95, 0.05, 0, this.ambGain);
    } else if (roll < 0.62) {
      // A dissonant stinger — the piano in the dark.
      played = this.playVariant('hStinger', 0.18, 0.9, 0.08, 0, this.ambGain);
    } else if (roll < 0.82) {
      played = this.playVariant('creak', 0.16, 0.7 + Math.random() * 0.25, 0.05, 0, this.ambGain);
    } else {
      // A distant moan — something alive, far away.
      played = this.playVariant('hMoan', 0.16, 0.85, 0.1, 0, this.ambGain) ||
        this.playSlice('beast', 1 + Math.random() * 8, 2.4, 0.75, 0.13, 0.1, this.ambGain);
    }
    if (played) this.stingerQuietUntil = now + 9000 + Math.random() * 11000;
  }

  private async loadBuffer(key: string, url: string): Promise<void> {
    if (!this.ctx) return;
    try {
      const res = await fetch(encodeURI(url));
      const buf = await res.arrayBuffer();
      this.buffers.set(key, await this.ctx.decodeAudioData(buf));
    } catch {
      /* synth fallback covers it */
    }
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const m = this.settings.muted ? 0 : this.settings.master;
    this.masterGain.gain.value = m;
    this.bgmGain.gain.value = this.settings.bgm;
    this.sfxGain.gain.value = this.settings.sfx;
    this.ambGain.gain.value = this.settings.amb;
  }

  setAmb(v: number): void {
    this.settings.amb = v;
    this.persist();
  }

  setMaster(v: number): void {
    this.settings.master = v;
    this.persist();
  }

  setBgm(v: number): void {
    this.settings.bgm = v;
    this.persist();
  }

  setSfx(v: number): void {
    this.settings.sfx = v;
    this.persist();
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    this.persist();
  }

  private persist(): void {
    this.applyVolumes();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  // ---- Synth voices --------------------------------------------------------

  /** A pitched oscillator blip with an exponential decay envelope. */
  private blip(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, f0), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** A filtered noise burst (whooshes, impacts, gore). */
  private noise(dur: number, f0: number, f1: number, vol: number, q = 1, delay = 0): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(Math.max(20, f0), t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** Play a decoded file buffer through the SFX bus. Returns false if absent. */
  private playBuffer(key: string, vol = 1): boolean {
    if (!this.ctx) return false;
    const buf = this.buffers.get(key);
    if (!buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.sfxGain);
    src.start();
    return true;
  }

  /**
   * Play a SLICE of a decoded buffer — offset/duration/rate carve punchy
   * one-shots out of the real recordings (the 16-bit ARPG trick: one good
   * sample, many pitches). ±jitter on the rate keeps repeats organic.
   * A 40 ms tail fade prevents end-of-slice clicks.
   */
  private playSlice(
    key: string,
    offset: number,
    dur: number,
    rate: number,
    vol: number,
    jitter = 0.1,
    bus?: GainNode,
  ): boolean {
    if (!this.ctx) return false;
    const buf = this.buffers.get(key);
    if (!buf) return false;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.setValueAtTime(vol, t + Math.max(0.01, dur - 0.04));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(g).connect(bus ?? this.sfxGain);
    src.start(t, Math.min(offset, Math.max(0, buf.duration - 0.05)), dur + 0.05);
    return true;
  }

  /**
   * Play a random take from a Fantasy-pack variant bank with pitch jitter.
   * Returns false if none of the bank's takes have decoded yet.
   */
  private playVariant(group: string, vol: number, rate = 1, jitter = 0.07, delay = 0, bus?: GainNode): boolean {
    if (!this.ctx) return false;
    const urls = VARIANTS[group] ?? HORROR_BANKS[group];
    if (!urls) return false;
    // Collect decoded takes (loading is async — play whatever is ready).
    const ready: AudioBuffer[] = [];
    for (let i = 0; i < urls.length; i++) {
      const b = this.buffers.get(`${group}_${i}`);
      if (b) ready.push(b);
    }
    if (ready.length === 0) return false;
    const buf = ready[Math.floor(Math.random() * ready.length)];
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(bus ?? this.sfxGain);
    src.start(t);
    return true;
  }

  private lastVoiceAt = 0;

  /**
   * Voice-pack pools (it.24): the 10 numbered folders are auto-probed at
   * unlock. As shipped they contain ONLY 0-byte macOS ._stubs (no audio
   * data — verified three times), so probing finds nothing and the beast
   * slices carry the voices. The moment REAL wavs are copied in, these
   * pools fill and take over the mapping with zero code changes:
   *   7-Damage → hurt · 8-Death → die · 9-Grunting → idle ·
   *   10-Shouting → attack · 6-Miscellaneous → ambient stingers.
   */
  private readonly voicePools = new Map<string, AudioBuffer[]>();

  private async probeVoicePack(): Promise<void> {
    if (!this.ctx) return;
    const cats: Array<[pool: string, dir: string, stem: string]> = [
      ['hurt', '7 - Damage', 'damage'],
      ['die', '8 - Death', 'death'],
      ['idle', '9 - Grunting', 'grunting'],
      ['attack', '10 - Shouting', 'shouting'],
      ['ambient', '6 - Miscellaneous', 'miscellaneous'],
    ];
    const actors = ['alex', 'ian', 'sean', 'karen', 'meghan'];
    for (const [pool, dir, stem] of cats) {
      const found: AudioBuffer[] = [];
      for (const actor of actors) {
        for (let n = 1; n <= 10; n++) {
          try {
            const res = await fetch(encodeURI(`${AUDIO_BASE}/${dir}/${stem}_${n}_${actor}.wav`));
            if (!res.ok) break; // Actor absent — stop probing this voice.
            found.push(await this.ctx.decodeAudioData(await res.arrayBuffer()));
          } catch {
            break;
          }
        }
      }
      if (found.length > 0) this.voicePools.set(pool, found);
    }
    if (this.voicePools.size > 0) {
      console.info(`[Audio] Voice pack active: ${[...this.voicePools.entries()].map(([k, v]) => `${k}×${v.length}`).join(', ')}`);
    }
  }

  /** Random take from a discovered voice pool through the SFX bus. */
  private playPool(pool: string, pitch: number, vol: number): boolean {
    if (!this.ctx) return false;
    const list = this.voicePools.get(pool);
    if (!list || list.length === 0) return false;
    const buf = list[Math.floor(Math.random() * list.length)];
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch * (1 + (Math.random() * 2 - 1) * 0.08);
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.sfxGain);
    src.start();
    return true;
  }

  /**
   * Species-pitched enemy voice (it.23 density pass): every state pulls a
   * FRESH random slice of the beast recording at the creature's own pitch
   * (rot rumbles at 0.6×, scaled things hiss at 1.35×) with ±12% jitter —
   * no two groans repeat. The uploaded voice-actor pack is still 0-byte
   * stubs; when real files land they replace these slices 1:1.
   */
  /**
   * @param bank The species' HORROR voice bank ('hZombie' | 'hGrowl' |
   *             'hHiss' | 'hScream' | 'hGrunt' | 'hRoar' | 'hMoan').
   * Priority: user voice-pack pool → horror bank → beast slice fallback.
   */
  enemyVoice(state: 'idle' | 'hurt' | 'die' | 'attack', pitch: number, bank = 'hGrunt'): void {
    if (!this.ctx || this.settings.muted) return;
    const now = performance.now();
    if (now - this.lastVoiceAt < 70) return; // Anti-chorus (it.27: denser).
    this.lastVoiceAt = now;
    // Discovered voice-pack pools take priority (randomized takes).
    if (this.playPool(state, pitch, state === 'die' ? 0.65 : 0.5)) return;
    // HORROR mapping (it.25): deaths scream, everything else speaks its bank.
    const dieBank = bank === 'hZombie' || bank === 'hRoar' ? bank : 'hScream';
    if (state === 'die') {
      if (this.playVariant(dieBank, 0.65, pitch >= 1 ? 1 : pitch * 1.1, 0.1)) return;
    } else {
      const rate = state === 'hurt' ? pitch * 1.2 : pitch;
      const vol = state === 'idle' ? 0.45 : 0.5;
      if (this.playVariant(bank, vol, rate, 0.1)) return;
    }
    // Fallback: beast-recording slices (pre-horror behavior).
    const offset = 0.5 + Math.random() * 10;
    if (state === 'hurt') this.playSlice('beast', offset, 0.38, pitch * 1.25, 0.4, 0.12);
    else if (state === 'idle') this.playSlice('beast', offset, 1.3, pitch, 0.38, 0.12);
    else if (state === 'attack') this.playSlice('beast', offset, 0.5, pitch * 1.1, 0.32, 0.12);
    else {
      this.playSlice('beast', offset, 1.6, pitch * 0.88, 0.55, 0.12);
      this.blip('sawtooth', 160 * pitch, 40 * pitch, 0.35, 0.18);
    }
  }

  /** Fire a named effect (render feedback — never called from sim logic). */
  sfx(name: SfxName): void {
    if (!this.ctx || this.settings.muted) return;
    // Throttle identical effects to 60 ms apart (AoE cleave, mob packs).
    const now = performance.now();
    if (now - (this.lastPlayed.get(name) ?? -1000) < 60) return;
    this.lastPlayed.set(name, now);

    // FANTASY-PACK VOICES (it.20): every combat/world trigger plays a real
    // recorded take from the TomMusic pack (random variant + pitch jitter).
    // The old synth blips remain ONLY as decode-failure fail-safes.
    switch (name) {
      case 'swing':
        if (!this.playVariant('swordAttack', 0.55)) this.noise(0.12, 900, 220, 0.5, 1.2);
        break;
      case 'enemySwing':
        // Enemy strikes whoosh heavier and slower — you HEAR who is swinging.
        if (!this.playVariant('swordAttack', 0.38, 0.85)) this.noise(0.14, 600, 160, 0.3, 1.2);
        break;
      case 'miss':
        if (!this.playVariant('swordAttack', 0.35, 1.12)) this.noise(0.16, 700, 180, 0.28, 1.2);
        break;
      case 'hit':
        if (!this.playVariant('swordHit', 0.85)) {
          this.blip('sine', 150, 70, 0.12, 0.7);
          this.noise(0.06, 2200, 900, 0.32, 0.8);
        }
        break;
      case 'crit':
        // A meaty CHOP under the sword impact — the crit lands heavier —
        // finished with a wet HORROR gore tear (it.25).
        if (!this.playVariant('chop', 0.95, 0.92)) this.blip('sine', 110, 45, 0.2, 0.95);
        this.playVariant('swordHit', 0.5, 1.0, 0.07, 0.02);
        this.playVariant('hGore', 0.55, 1.05, 0.12, 0.03);
        break;
      case 'gore':
        // Heavy-impact wet hit (big damage rolls, it.25).
        this.playVariant('hGore', 0.5, 1.1, 0.12);
        break;
      case 'gateOpen':
        // The warden falls — the barred stair grinds OPEN (it.26).
        this.playVariant('gateOpen', 0.7, 1.0, 0.02);
        break;
      case 'bossCast':
        // The Ember Maw's fire-lance: the full Firespray roar.
        if (!this.playVariant('firespray', 0.7, 1.0, 0.05)) this.playVariant('fireball', 0.7);
        break;
      case 'arrowWall':
        // An arrow clattering off stone (Bow Blocked takes).
        this.playVariant('bowBlocked', 0.4, 1.1, 0.1);
        break;
      case 'equip':
        // Steel drawn from the sheath — gearing up.
        this.playVariant('unsheath', 0.55, 1.05, 0.08);
        break;
      case 'bow':
        if (!this.playVariant('bowAttack', 0.6)) this.blip('triangle', 480, 170, 0.1, 0.5);
        break;
      case 'bolt':
        if (!this.playVariant('fireball', 0.7)) this.blip('sawtooth', 320, 70, 0.28, 0.5);
        break;
      case 'boltImpact':
        if (!this.playVariant('spellImpact', 0.65)) this.blip('sine', 240, 110, 0.07, 0.5);
        break;
      case 'arrowHit':
        if (!this.playVariant('bowHit', 0.6)) this.blip('sine', 240, 110, 0.07, 0.5);
        break;
      case 'hurt':
        // Armor CLANG (Sword Blocked) — a distinct timbre from dealing hits;
        // sometimes the hero GASPS under it (horror Character takes).
        if (!this.playVariant('swordBlocked', 0.6)) this.blip('square', 290, 130, 0.18, 0.4);
        if (Math.random() < 0.35) this.playVariant('hHurt', 0.4, 1.0, 0.08, 0.05);
        break;
      case 'freeze':
        this.playVariant('iceFreeze', 0.7);
        break;
      case 'step':
        this.playVariant('stoneRun', 0.2, 1.0, 0.14);
        break;
      case 'enemyDie':
        // A random breath-groan slice from the beast recording, pitched low.
        if (!this.playSlice('beast', 1 + Math.random() * 8, 1.2, 0.85, 0.6, 0.12)) {
          this.blip('sawtooth', 190, 45, 0.38, 0.5);
          this.noise(0.3, 800, 130, 0.4, 0.9);
        }
        break;
      case 'bossDie':
        this.playSlice('doom', 0, 4.5, 1.0, 0.9, 0);
        this.playBuffer('magic6', 0.9);
        this.playVariant('hRoar', 0.8, 0.8, 0.05, 0.15); // The dying roar.
        this.blip('sawtooth', 90, 26, 1.1, 0.5);
        break;
      case 'bossHorn':
        if (!this.playSlice('horn', 0, 6, 1.0, 0.8, 0)) this.blip('sawtooth', 140, 130, 1.2, 0.5);
        this.playVariant('hRoar', 0.75, 0.9, 0.08, 0.8); // The keeper ROARS back.
        break;
      case 'summon':
        if (!this.playBuffer('chant', 0.8)) this.blip('sawtooth', 70, 180, 0.8, 0.4);
        break;
      case 'pickup':
        // Item stowed: the sword-sheath leather-and-steel rustle.
        if (!this.playVariant('sheath', 0.5, 1.15)) {
          this.blip('triangle', 660, 660, 0.06, 0.4);
          this.blip('triangle', 990, 990, 0.07, 0.4, 0.06);
        }
        break;
      case 'gold':
        // Coins: the lock-clink sped up bright, twice.
        if (!this.playVariant('coin', 0.45, 1.6, 0.1)) this.blip('triangle', 1200, 900, 0.06, 0.35);
        this.playVariant('coin', 0.3, 1.9, 0.1, 0.09);
        break;
      case 'levelUp':
        // The Firebuff shimmer + a rising chime — POWER settles into you.
        if (!this.playVariant('firebuff', 0.85)) this.blip('triangle', 523, 1047, 0.5, 0.6);
        this.blip('triangle', 659, 659, 0.12, 0.35, 0.05);
        this.blip('triangle', 988, 988, 0.14, 0.35, 0.19);
        this.blip('triangle', 1319, 1319, 0.3, 0.4, 0.33);
        break;
      case 'enemyHit':
        // Hit-reaction grunt: a tight beast bark. (The uploaded voice pack
        // arrived as 0-byte metadata — slots ready for real files.)
        this.playSlice('beast', 2 + Math.random() * 7, 0.45, 1.25, 0.35, 0.15);
        break;
      case 'enemyGrowl':
        // An idle thing notices you: low breath-growl from the dark.
        this.playSlice('beast', 1 + Math.random() * 9, 1.4, 0.9, 0.4, 0.12);
        break;
      case 'chest':
        if (!this.playVariant('chestOpen', 0.8)) this.blip('sawtooth', 95, 70, 0.18, 0.35);
        break;
      case 'stairs':
        // Three quick stone footfalls descending into the dark.
        this.playVariant('stoneRun', 0.5, 1.05, 0.1, 0);
        this.playVariant('stoneRun', 0.45, 0.98, 0.1, 0.13);
        this.playVariant('stoneRun', 0.4, 0.9, 0.1, 0.27);
        break;
      case 'ui':
        // A tiny high metallic tick (Sword Parry, fast + quiet).
        if (!this.playVariant('parry', 0.14, 1.85)) this.blip('square', 840, 620, 0.04, 0.18);
        break;
      case 'victory':
        this.blip('triangle', 523, 523, 0.14, 0.5);
        this.blip('triangle', 659, 659, 0.14, 0.5, 0.14);
        this.blip('triangle', 784, 784, 0.14, 0.5, 0.28);
        this.blip('triangle', 1047, 1047, 0.4, 0.55, 0.42);
        break;
      // ---- ACTIVE SKILLS (it.32): every cast speaks from the packs ----
      case 'skillWhirl':
        // Three fast sword whooshes fanning around the spin.
        this.playVariant('swordAttack', 0.55, 1.05, 0.08, 0);
        this.playVariant('swordAttack', 0.5, 0.95, 0.08, 0.09);
        this.playVariant('swordAttack', 0.45, 1.12, 0.08, 0.18);
        break;
      case 'skillDash':
        this.playVariant('stoneRun', 0.55, 1.25, 0.08, 0);
        this.playVariant('stoneRun', 0.45, 1.15, 0.08, 0.08);
        this.playVariant('swordAttack', 0.35, 1.3, 0.08, 0.05);
        break;
      case 'skillShout':
        this.playVariant('hRoar', 0.7, 1.25, 0.08);
        this.playBuffer('chant', 0.4);
        break;
      case 'skillBuff':
        this.playVariant('firebuff', 0.75, 1.0, 0.06);
        break;
      case 'skillFire':
        if (!this.playVariant('fireball', 0.8, 1.0, 0.08)) this.blip('sawtooth', 300, 60, 0.3, 0.5);
        this.playVariant('spellImpact', 0.6, 0.95, 0.08, 0.12);
        break;
      case 'skillArrows':
        this.playVariant('bowAttack', 0.55, 1.05, 0.1, 0);
        this.playVariant('bowAttack', 0.5, 0.95, 0.1, 0.07);
        this.playVariant('bowAttack', 0.45, 1.1, 0.1, 0.14);
        break;
      case 'skillTrap':
        // Detonation: fireball crack + a wet gore tail.
        this.playVariant('fireball', 0.85, 0.9, 0.06);
        this.playVariant('hGore', 0.45, 1.0, 0.1, 0.08);
        break;
      case 'skillTrapSet':
        this.playVariant('coin', 0.4, 0.8, 0.08); // A metallic click into the floor.
        break;
      case 'skillPoison':
        this.playVariant('hHiss', 0.6, 1.15, 0.1);
        this.playVariant('unsheath', 0.4, 1.0, 0.06, 0.05);
        break;
      case 'skillVanish':
        this.playVariant('iceFreeze', 0.45, 1.5, 0.08); // A cold shimmer out of sight.
        break;
    }
  }

  private bossMusicEl: HTMLAudioElement | null = null;
  private bossMusicOn = false;
  private crossfadeTimer: number | null = null;

  /**
   * Boss arena music (it.28): crossfades the dungeon BGM + ambience out
   * and the floor's boss track in (~1.4 s), and back on `false`.
   */
  setBossMusic(on: boolean, floor = 0): void {
    if (!this.ctx || on === this.bossMusicOn) return;
    this.bossMusicOn = on;
    if (on) {
      const track = BOSS_TRACKS[floor] ?? BOSS_TRACK_DEFAULT;
      if (!this.bossMusicEl) {
        this.bossMusicEl = this.hookMediaElement(track, true);
      } else if (!this.bossMusicEl.src.endsWith(encodeURI(track).split('/').pop() ?? '')) {
        this.bossMusicEl.src = encodeURI(track);
        this.bossMusicEl.loop = true;
      }
      if (this.bossMusicEl) {
        this.bossMusicEl.volume = 0;
        this.bossMusicEl.play().catch(() => undefined);
      }
    } else {
      void this.bgmEl?.play().catch(() => undefined);
      void this.ambEl?.play().catch(() => undefined);
    }
    // Smooth crossfade (element volumes; the bus gains stay user-owned).
    if (this.crossfadeTimer !== null) clearInterval(this.crossfadeTimer);
    let i = 0;
    const steps = 24;
    this.crossfadeTimer = window.setInterval(() => {
      i++;
      const t = Math.min(1, i / steps);
      const boss = on ? t : 1 - t;
      if (this.bossMusicEl) {
        this.bossMusicEl.volume = boss;
        // Autoplay-policy safety: keep retrying until the element runs.
        if (on && this.bossMusicEl.paused) this.bossMusicEl.play().catch(() => undefined);
      }
      if (this.bgmEl) this.bgmEl.volume = 1 - boss;
      if (this.ambEl) this.ambEl.volume = 0.55 * (1 - boss * 0.7);
      if (i >= steps) {
        clearInterval(this.crossfadeTimer!);
        this.crossfadeTimer = null;
        if (!on) this.bossMusicEl?.pause();
        else this.bgmEl?.pause();
      }
    }, 60);
  }

  private bgmDeep = false;

  /** Depth-band music: floors 10+ trade the mystery theme for the gloomy
   *  demonic drone (both REAL tracks). No-op until the band changes. */
  setBgmDeep(deep: boolean): void {
    if (deep === this.bgmDeep) return;
    this.bgmDeep = deep;
    if (!this.bgmEl) return;
    const wasPlaying = !this.bgmEl.paused;
    this.bgmEl.src = encodeURI(deep ? FILES.bgmDeep : FILES.bgm);
    this.bgmEl.loop = true;
    if (wasPlaying) void this.bgmEl.play().catch(() => undefined);
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }
}

/** Shared instance; UI modules may import it directly for 'ui' blips. */
export const audio = new AudioManager();
