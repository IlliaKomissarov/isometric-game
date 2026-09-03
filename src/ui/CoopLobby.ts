/**
 * @module ui/CoopLobby
 * THE PARTY LOBBY (it.59, rebuilt it.60): CO-OP MULTIPLAYER from the title.
 *
 *   CREATE PARTY → a room code (`KNG-482`) on a bronze badge, one click to copy.
 *   JOIN PARTY   → type a friend's code — into the lobby, or straight into a
 *                  delve already under way (the leader hands over the history).
 *   Four PLAYER CARDS: the hero breathing in its portrait, nickname, class
 *   badge, READY mark, latency (green / amber / red ms) and the link state.
 *   A CHARACTER SELECTOR with a live, cross-fading class preview.
 *   NETWORK RELAY: the player's own TURN (never in code) for mobile hotspots
 *   and carrier NAT, with a TEST that reports what the network can reach.
 *
 * The lobby never touches the simulation: it produces one `CoopStart`
 * bundle (seed, roster, the leader's stash — or the run's history) that
 * main hands to `startRun`.
 */

import { audio } from '@/engine/AudioManager';
import {
  type HistoryPayload,
  type MemberInfo,
  PARTY_COLOR_CSS,
  PeerNet,
  loadRelaySettings,
  normalizeRoomCode,
  probeIce,
  sanitizeName,
  saveRelaySettings,
} from '@/net/PeerNet';
import type { ClassArchetype } from '@/network/Serialization';
import type { PlayerSave, StashState } from '@/persist/SaveGame';

export interface CoopStart {
  net: PeerNet;
  seed: number;
  members: MemberInfo[];
  localSlot: number;
  stash: StashState;
  /** Joining a delve in progress (it.60): the party's start and every frame since. */
  history?: HistoryPayload;
  /** The local hero's sheet (the seat a mid-run joiner brings). */
  hero: PlayerSave | null;
}

export interface CoopLobbyHooks {
  /** Stream the four idle atlases (portraits need them; the title may not have them yet). */
  ensurePreviews: () => Promise<void>;
  /** Idle frames of the class (south-facing) for portraits and the preview. */
  previewFor: (cls: ClassArchetype) => HTMLCanvasElement[];
  /** The hero sheet this class keeps for co-op (null = fresh). */
  heroFor: (cls: ClassArchetype) => PlayerSave | null;
  /** The leader's stash, handed to the party. */
  stashFor: (cls: ClassArchetype) => StashState;
  /** Everyone is ready and the leader pressed START (or the START / history arrived). */
  start: (cfg: CoopStart) => void;
  /** Back to the title. */
  closed: () => void;
}

const CLASSES: Array<{ id: ClassArchetype; name: string; blurb: string; glyph: string }> = [
  { id: 'warrior', name: 'WARRIOR', blurb: 'steel and stamina', glyph: '⚔' },
  { id: 'mage', name: 'MAGE', blurb: 'fire and frost', glyph: '✦' },
  { id: 'ranger', name: 'RANGER', blurb: 'arrows and traps', glyph: '➶' },
  { id: 'rogue', name: 'ROGUE', blurb: 'blades and shadow', glyph: '☽' },
];
const GLYPH: Record<ClassArchetype, string> = { warrior: '⚔', mage: '✦', ranger: '➶', rogue: '☽' };

const NICK_KEY = 'iso-arpg-nick';
const PORTRAIT_FPS = 7;

export class CoopLobbyUI {
  private readonly root: HTMLElement;
  private readonly abort = new AbortController();
  private net: PeerNet | null = null;
  private cls: ClassArchetype = 'warrior';
  private ready = false;
  private busy = false;
  private offNet: Array<() => void> = [];
  private started = false;
  /** Every animated portrait on screen: canvas + its frames. */
  private readonly portraits = new Map<HTMLCanvasElement, { frames: HTMLCanvasElement[]; cls: ClassArchetype }>();
  private raf = 0;
  private lastFrameAt = 0;
  private frameIndex = 0;
  private copyTimer = 0;

  constructor(private readonly hooks: CoopLobbyHooks) {
    this.root = document.createElement('div');
    this.root.id = 'coop-panel';
    this.root.innerHTML = `
      <div class="cp-frame">
        <div class="cp-corner tl"></div><div class="cp-corner tr"></div><div class="cp-corner bl"></div><div class="cp-corner br"></div>
        <header class="cp-head">
          <h2>CO-OP MULTIPLAYER</h2>
          <p class="cp-sub">four delvers · one crypt · peer to peer</p>
        </header>

        <section class="cp-stage" data-stage="setup">
          <div class="cp-setup">
            <div class="cp-selector">
              <div class="cp-preview-frame"><canvas class="cp-preview" data-preview width="96" height="120"></canvas></div>
              <div class="cp-classes" data-classes></div>
              <p class="cp-note" data-note></p>
            </div>
            <div class="cp-form">
              <label class="cp-field"><span>NICKNAME</span><input type="text" data-nick maxlength="14" placeholder="Delver" spellcheck="false" autocomplete="off" /></label>
              <button class="cp-btn primary" data-create>CREATE PARTY</button>
              <div class="cp-or"><i></i><span>or</span><i></i></div>
              <div class="cp-join"><input type="text" data-code maxlength="7" placeholder="KNG-482" spellcheck="false" autocomplete="off" /><button class="cp-btn" data-join>JOIN PARTY</button></div>
              <details class="cp-relay" data-relay>
                <summary>NETWORK RELAY <em>optional · mobile hotspots, carrier NAT</em></summary>
                <p class="cp-relay-help">Two home connections meet directly. A phone hotspot or a strict ISP needs a TURN relay: paste the credentials of any free TURN account (Metered, ExpressTURN, Cloudflare Calls, your own coturn). They stay in this browser only.</p>
                <label class="cp-field"><span>TURN URL(S)</span><input type="text" data-turn-urls placeholder="turn:relay.example.com:3478" spellcheck="false" autocomplete="off" /></label>
                <div class="cp-relay-row">
                  <label class="cp-field"><span>USERNAME</span><input type="text" data-turn-user spellcheck="false" autocomplete="off" data-lpignore="true" /></label>
                  <label class="cp-field"><span>CREDENTIAL</span><input type="text" class="cp-secret" data-turn-pass autocomplete="off" data-lpignore="true" spellcheck="false" /></label>
                </div>
                <div class="cp-relay-actions">
                  <button type="button" class="cp-btn small" data-turn-save>SAVE</button>
                  <button type="button" class="cp-btn small" data-turn-test>TEST NETWORK</button>
                  <label class="cp-check"><input type="checkbox" data-relay-only /><span>join through the relay only</span></label>
                </div>
                <p class="cp-status" data-turn-status></p>
              </details>
            </div>
          </div>
          <p class="cp-status" data-status></p>
          <button class="cp-back" data-back>BACK</button>
        </section>

        <section class="cp-stage" data-stage="party" hidden>
          <div class="cp-codebar">
            <span class="cp-codelabel">ROOM CODE</span>
            <b class="cp-code" data-codeout>———</b>
            <button type="button" class="cp-copy" data-copy>COPY CODE</button>
            <span class="cp-path" data-path></span>
          </div>
          <div class="cp-cards" data-cards></div>
          <div class="cp-party-lower">
            <div class="cp-selector cp-selector-small">
              <div class="cp-classes cp-classes-small" data-classes2></div>
              <p class="cp-note" data-note2></p>
            </div>
            <div class="cp-chat"><div class="cp-log" data-log></div><input type="text" data-chat maxlength="200" placeholder="Say something to the party… (Enter)" spellcheck="false" autocomplete="off" /></div>
          </div>
          <div class="cp-actions">
            <button class="cp-btn" data-ready>READY</button>
            <button class="cp-btn primary" data-start hidden>START DELVE</button>
            <button class="cp-back" data-leave>LEAVE PARTY</button>
          </div>
          <p class="cp-status" data-status2></p>
        </section>
      </div>`;
    document.body.appendChild(this.root);
    const { signal } = this.abort;
    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector<T>(sel)!;

    // Class pickers (one on each stage).
    for (const holder of ['[data-classes]', '[data-classes2]']) {
      const el = q(holder);
      for (const c of CLASSES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.cls = c.id;
        b.innerHTML = `<i>${c.glyph}</i><b>${c.name}</b><span>${c.blurb}</span>`;
        b.addEventListener('mouseenter', () => audio.sfx('uiHover'), { signal });
        b.addEventListener('click', () => this.pickClass(c.id, true), { signal });
        el.appendChild(b);
      }
    }
    this.portraits.set(q<HTMLCanvasElement>('[data-preview]'), { frames: [], cls: 'warrior' });
    try {
      q<HTMLInputElement>('[data-nick]').value = localStorage.getItem(NICK_KEY) ?? '';
    } catch {
      /* ignore */
    }
    const relay = loadRelaySettings();
    if (relay) {
      q<HTMLInputElement>('[data-turn-urls]').value = relay.urls;
      q<HTMLInputElement>('[data-turn-user]').value = relay.username;
      q<HTMLInputElement>('[data-turn-pass]').value = relay.credential;
      q<HTMLDetailsElement>('[data-relay]').open = true;
    }
    q('[data-turn-save]').addEventListener('click', () => this.saveRelay(), { signal });
    q('[data-turn-test]').addEventListener('click', () => void this.testNetwork(), { signal });
    q('[data-create]').addEventListener('click', () => void this.create(), { signal });
    q('[data-join]').addEventListener('click', () => void this.join(), { signal });
    q<HTMLInputElement>('[data-code]').addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'Enter') void this.join();
        e.stopPropagation();
      },
      { signal },
    );
    q('[data-back]').addEventListener('click', () => this.close(), { signal });
    q('[data-leave]').addEventListener('click', () => this.leave(), { signal });
    q('[data-copy]').addEventListener('click', () => void this.copyCode(), { signal });
    q('[data-ready]').addEventListener('click', () => this.toggleReady(), { signal });
    q('[data-start]').addEventListener('click', () => this.startDelve(), { signal });
    this.root.querySelectorAll<HTMLButtonElement>('.cp-btn, .cp-back, .cp-copy').forEach((b) => b.addEventListener('mouseenter', () => audio.sfx('uiHover'), { signal }));
    const chat = q<HTMLInputElement>('[data-chat]');
    chat.addEventListener(
      'keydown',
      (e) => {
        e.stopPropagation();
        if (e.code !== 'Enter') return;
        const text = chat.value.trim();
        chat.value = '';
        if (text && this.net) this.net.chat(text);
      },
      { signal },
    );
    for (const sel of ['[data-nick]', '[data-code]', '[data-chat]', '[data-turn-urls]', '[data-turn-user]', '[data-turn-pass]']) {
      q(sel).addEventListener('keyup', (e) => e.stopPropagation(), { signal });
      q(sel).addEventListener('keydown', (e) => e.stopPropagation(), { signal });
    }
    // ESC closes only while still on the setup stage (a party is left explicitly).
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.isOpen || e.code !== 'Escape') return;
        if (!this.net) this.close();
      },
      { signal },
    );
    this.pickClass('warrior', false);
  }

  get isOpen(): boolean {
    return this.root.classList.contains('show');
  }

  open(lastHero: ClassArchetype | null): void {
    this.started = false;
    if (lastHero) this.pickClass(lastHero, false);
    this.showStage('setup');
    this.status('', false);
    this.root.classList.add('show');
    this.startPortraits();
    this.root.querySelector<HTMLInputElement>('[data-nick]')?.focus();
    // Portraits need the idle atlases; bind them again once they have streamed in.
    void this.hooks.ensurePreviews().then(() => {
      if (!this.isOpen) return;
      for (const [canvas, p] of [...this.portraits]) {
        if (p.frames.length) continue;
        this.portraits.delete(canvas);
        this.bindPortrait(canvas, p.cls);
      }
    });
  }

  /** Back to the title without a party. */
  close(): void {
    this.leaveNet();
    this.root.classList.remove('show');
    this.stopPortraits();
    this.hooks.closed();
  }

  destroy(): void {
    this.leaveNet();
    this.stopPortraits();
    this.abort.abort();
    this.root.remove();
  }

  // --- Portraits (animated idle frames) ----------------------------------------

  private startPortraits(): void {
    if (this.raf) return;
    const tick = (now: number): void => {
      if (!this.isOpen) {
        this.raf = 0;
        return;
      }
      if (now - this.lastFrameAt > 1000 / PORTRAIT_FPS) {
        this.lastFrameAt = now;
        this.frameIndex++;
        for (const [canvas, p] of this.portraits) if (canvas.isConnected) this.drawPortrait(canvas, p.frames, this.frameIndex);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopPortraits(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private bindPortrait(canvas: HTMLCanvasElement, cls: ClassArchetype): void {
    const cur = this.portraits.get(canvas);
    if (cur && cur.cls === cls && cur.frames.length) return;
    let frames: HTMLCanvasElement[] = [];
    try {
      frames = this.hooks.previewFor(cls);
    } catch {
      frames = [];
    }
    this.portraits.set(canvas, { frames, cls });
    this.drawPortrait(canvas, frames, this.frameIndex);
    // Cross-fade on a class switch.
    canvas.classList.remove('swap');
    void canvas.offsetWidth;
    canvas.classList.add('swap');
  }

  private drawPortrait(canvas: HTMLCanvasElement, frames: HTMLCanvasElement[], index: number): void {
    if (!frames.length) return;
    const f = frames[index % frames.length];
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / f.width, canvas.height / f.height);
    const w = f.width * scale;
    const h = f.height * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(f, (canvas.width - w) / 2, canvas.height - h, w, h);
  }

  // --- Setup stage -----------------------------------------------------------

  private get nick(): string {
    const raw = this.root.querySelector<HTMLInputElement>('[data-nick]')?.value ?? '';
    const name = sanitizeName(raw);
    try {
      localStorage.setItem(NICK_KEY, name);
    } catch {
      /* ignore */
    }
    return name;
  }

  private pickClass(cls: ClassArchetype, byUser: boolean): void {
    if (byUser && this.ready) return; // Locked in once ready.
    this.cls = cls;
    if (byUser) audio.sfx('uiClick');
    this.root.querySelectorAll<HTMLButtonElement>('[data-cls]').forEach((b) => b.classList.toggle('on', b.dataset.cls === cls));
    const hero = this.hooks.heroFor(cls);
    const note = hero ? `your co-op hero: level ${hero.level} ${cls}` : `a fresh level-1 ${cls} — kept between parties`;
    this.root.querySelectorAll<HTMLElement>('[data-note], [data-note2]').forEach((el) => (el.textContent = note));
    this.bindPortrait(this.root.querySelector<HTMLCanvasElement>('[data-preview]')!, cls);
    if (this.net && !this.ready) {
      if (this.net.isHost) this.net.setMember(0, { cls, hero });
      else this.net.send({ t: 'set', cls, hero });
    }
  }

  private saveRelay(): void {
    const urls = this.root.querySelector<HTMLInputElement>('[data-turn-urls]')!.value.trim();
    const username = this.root.querySelector<HTMLInputElement>('[data-turn-user]')!.value.trim();
    const credential = this.root.querySelector<HTMLInputElement>('[data-turn-pass]')!.value;
    saveRelaySettings(urls ? { urls, username, credential } : null);
    audio.sfx('uiConfirm');
    this.relayStatus(urls ? 'Relay saved in this browser.' : 'Relay cleared — direct paths only.', false);
  }

  private async testNetwork(): Promise<void> {
    const urls = this.root.querySelector<HTMLInputElement>('[data-turn-urls]')!.value.trim();
    const username = this.root.querySelector<HTMLInputElement>('[data-turn-user]')!.value.trim();
    const credential = this.root.querySelector<HTMLInputElement>('[data-turn-pass]')!.value;
    this.relayStatus('Gathering candidates… (6 s)', false);
    audio.sfx('uiClick');
    try {
      const r = await probeIce(urls ? { urls, username, credential } : null);
      if (r.relay) this.relayStatus('Relay reachable ✓ — this party can cross mobile and carrier networks.', false);
      else if (r.srflx) this.relayStatus(urls ? 'STUN answered, but the relay gave no candidate — check the URL and credentials.' : 'STUN answered (direct paths work). No relay configured: a phone hotspot may not connect.', !!urls);
      else this.relayStatus('No public candidate at all — this network blocks STUN. A relay over TCP 443 is the way through.', true);
    } catch (err) {
      this.relayStatus((err as Error).message, true);
    }
  }

  private async create(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    audio.sfx('uiConfirm');
    this.status('Opening the party — reaching the broker…', false);
    try {
      const net = await PeerNet.host(this.nick, this.cls, this.hooks.heroFor(this.cls));
      this.attach(net);
      this.status('Share the room code. The delve starts when every seat is ready.', false);
    } catch (err) {
      this.status((err as Error).message, true);
    } finally {
      this.busy = false;
    }
  }

  private async join(): Promise<void> {
    if (this.busy) return;
    const raw = this.root.querySelector<HTMLInputElement>('[data-code]')?.value ?? '';
    const code = normalizeRoomCode(raw);
    if (!code) {
      this.status('A room code looks like KNG-482.', true);
      return;
    }
    this.busy = true;
    audio.sfx('uiConfirm');
    const relayOnly = this.root.querySelector<HTMLInputElement>('[data-relay-only]')?.checked ?? false;
    this.status(`Knocking on ${code}…${relayOnly ? ' (relay only)' : ''}`, false);
    try {
      const net = await PeerNet.join(code, this.nick, this.cls, this.hooks.heroFor(this.cls), { relayOnly });
      this.attach(net);
      this.status(net.phase === 'run' ? 'The party is in the crypt — catching up with the delve…' : 'You are in. Pick a class and READY up.', false);
    } catch (err) {
      this.status((err as Error).message, true);
    } finally {
      this.busy = false;
    }
  }

  // --- Party stage -----------------------------------------------------------

  private attach(net: PeerNet): void {
    this.net = net;
    this.ready = false;
    this.offNet.push(net.onRoster(() => this.renderCards()));
    this.offNet.push(
      net.onMessage((msg) => {
        if (msg.t === 'chat') {
          const m = net.members.find((x) => x.slot === msg.slot);
          this.log(`[${m?.name ?? `Delver ${msg.slot + 1}`}]: ${msg.text}`, PARTY_COLOR_CSS[msg.slot] ?? '#ddd');
        } else if (msg.t === 'sys') {
          this.log(`[System] ${msg.text}`, '#a89c80');
        } else if (msg.t === 'start' && !net.isHost) {
          this.launch({ net, seed: msg.seed, members: msg.members, localSlot: net.localSlot, stash: msg.stash, hero: this.hooks.heroFor(this.cls) });
        }
      }),
    );
    this.offNet.push(
      net.onHistory((h) => {
        // A delve in progress: replay it, then step in.
        this.launch({ net, seed: h.seed, members: net.members, localSlot: net.localSlot, stash: h.stash, history: h, hero: this.hooks.heroFor(this.cls) });
      }),
    );
    net.onHostLost((reason) => {
      if (this.started) return; // The run owns the net now.
      this.detachNet();
      this.showStage('setup');
      this.status(reason, true);
    });
    this.root.querySelector<HTMLElement>('[data-codeout]')!.textContent = net.code;
    this.root.querySelector<HTMLElement>('[data-path]')!.textContent = net.isHost ? 'you are the Party Leader' : net.path === 'relay' ? 'connected through the relay' : 'connected directly';
    this.root.querySelector<HTMLElement>('[data-start]')!.hidden = !net.isHost;
    this.showStage('party');
    this.renderCards();
    this.log(net.isHost ? `[System] Party ${net.code} is open. You are the Party Leader.` : `[System] Joined party ${net.code}.`, '#a89c80');
  }

  private renderCards(): void {
    const net = this.net;
    const holder = this.root.querySelector<HTMLElement>('[data-cards]');
    if (!net || !holder) return;
    // Rebuild the four cards; portraits are re-bound (frames cached by class).
    for (const c of [...this.portraits.keys()]) if (c.dataset.card !== undefined) this.portraits.delete(c);
    holder.innerHTML = '';
    for (let slot = 0; slot < 4; slot++) {
      const m = net.members.find((x) => x.slot === slot);
      const card = document.createElement('article');
      card.className = 'cp-card';
      card.style.setProperty('--slot-color', PARTY_COLOR_CSS[slot]);
      if (!m) {
        card.classList.add('empty');
        card.innerHTML = '<div class="cp-portrait"></div><b>EMPTY SEAT</b><span>waiting for a delver</span>';
        holder.appendChild(card);
        continue;
      }
      if (!m.online) card.classList.add('offline');
      if (m.ready) card.classList.add('ready');
      if (m.link === 'reconnecting') card.classList.add('reconnecting');
      if (slot === net.localSlot) card.classList.add('me');
      const portrait = document.createElement('div');
      portrait.className = 'cp-portrait';
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 80;
      canvas.dataset.card = String(slot);
      portrait.appendChild(canvas);
      this.bindPortrait(canvas, m.cls);
      const name = document.createElement('b');
      name.textContent = m.name + (slot === net.localSlot ? ' (you)' : '');
      const badge = document.createElement('span');
      badge.className = 'cp-badge';
      badge.innerHTML = `<i>${GLYPH[m.cls]}</i>${m.cls.toUpperCase()} · LVL ${m.hero?.level ?? 1}`;
      const readyMark = document.createElement('label');
      readyMark.className = 'cp-ready';
      readyMark.innerHTML = `<i>${m.ready ? '✓' : ''}</i><span>${slot === 0 ? 'LEADER' : m.ready ? 'READY' : 'not ready'}</span>`;
      const ping = document.createElement('em');
      const ms = slot === 0 ? (net.isHost ? -1 : 0) : slot === net.localSlot ? net.ping : (m.ping ?? 0);
      ping.className = 'cp-ping ' + (m.link === 'reconnecting' ? 'poor' : !m.online ? 'off' : ms < 80 ? 'good' : ms < 200 ? 'fair' : 'poor');
      ping.textContent = m.link === 'reconnecting' ? 'RECONNECTING…' : !m.online ? 'OFFLINE' : ms < 0 ? 'HOST' : `${ms} ms`;
      const crown = document.createElement('u');
      crown.className = 'cp-crown';
      crown.textContent = slot === 0 ? '♛' : '';
      card.append(crown, portrait, name, badge, readyMark, ping);
      holder.appendChild(card);
    }
    const me = net.members.find((x) => x.slot === net.localSlot);
    this.ready = !!me?.ready;
    const readyBtn = this.root.querySelector<HTMLElement>('[data-ready]')!;
    readyBtn.textContent = this.ready ? '✓ READY' : 'READY';
    readyBtn.classList.toggle('on', this.ready);
    const startBtn = this.root.querySelector<HTMLButtonElement>('[data-start]')!;
    const online = net.members.filter((x) => x.online);
    const allReady = online.length > 0 && online.every((x) => x.ready);
    startBtn.disabled = !allReady;
    startBtn.title = allReady ? 'Everyone is ready' : 'Every seat must be ready';
    this.root.querySelectorAll<HTMLButtonElement>('[data-classes2] [data-cls]').forEach((b) => (b.disabled = this.ready));
  }

  private toggleReady(): void {
    if (!this.net) return;
    audio.sfx('uiClick');
    const ready = !this.ready;
    const hero = this.hooks.heroFor(this.cls);
    if (this.net.isHost) this.net.setMember(0, { ready, cls: this.cls, hero });
    else this.net.send({ t: 'set', ready, cls: this.cls, hero });
  }

  private async copyCode(): Promise<void> {
    const code = this.net?.code ?? '';
    const btn = this.root.querySelector<HTMLElement>('[data-copy]')!;
    try {
      await navigator.clipboard.writeText(code);
      btn.textContent = 'CODE COPIED!';
      btn.classList.add('done');
      audio.sfx('uiConfirm');
    } catch {
      btn.textContent = `SHARE: ${code}`;
    }
    clearTimeout(this.copyTimer);
    this.copyTimer = window.setTimeout(() => {
      btn.textContent = 'COPY CODE';
      btn.classList.remove('done');
    }, 1600);
  }

  private startDelve(): void {
    const net = this.net;
    if (!net || !net.isHost) return;
    const online = net.members.filter((x) => x.online);
    if (!online.every((x) => x.ready)) return;
    audio.sfx('uiConfirm');
    const seedBytes = new Uint32Array(1);
    crypto.getRandomValues(seedBytes);
    const seed = seedBytes[0] >>> 0;
    net.phase = 'run';
    const members = online.map((m) => ({ ...m }));
    const stash = this.hooks.stashFor(this.cls);
    net.broadcast({ t: 'start', seed, members, stash });
    this.launch({ net, seed, members, localSlot: 0, stash, hero: this.hooks.heroFor(this.cls) });
  }

  private launch(cfg: CoopStart): void {
    if (this.started) return;
    this.started = true;
    this.detachNet(false);
    this.root.classList.remove('show');
    this.stopPortraits();
    this.hooks.start(cfg);
  }

  private leave(): void {
    audio.sfx('uiBack');
    this.leaveNet();
    this.showStage('setup');
    this.status('You left the party.', false);
  }

  private leaveNet(): void {
    this.detachNet();
  }

  /** Unhook lobby listeners; destroy the net unless the run is taking it over. */
  private detachNet(destroy = true): void {
    for (const off of this.offNet) off();
    this.offNet = [];
    if (destroy) {
      if (this.net?.isHost) this.net.broadcast({ t: 'end', reason: 'The Party Leader closed the party.' });
      this.net?.destroy();
    }
    this.net = null;
    this.ready = false;
    const log = this.root.querySelector('[data-log]');
    if (log) log.innerHTML = '';
  }

  // --- Helpers ----------------------------------------------------------------

  private showStage(stage: 'setup' | 'party'): void {
    this.root.querySelectorAll<HTMLElement>('[data-stage]').forEach((el) => (el.hidden = el.dataset.stage !== stage));
  }

  private status(text: string, error: boolean): void {
    for (const sel of ['[data-status]', '[data-status2]']) {
      const el = this.root.querySelector<HTMLElement>(sel);
      if (!el) continue;
      el.textContent = text;
      el.classList.toggle('err', error);
    }
  }

  private relayStatus(text: string, error: boolean): void {
    const el = this.root.querySelector<HTMLElement>('[data-turn-status]');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('err', error);
  }

  private log(text: string, color: string): void {
    const log = this.root.querySelector<HTMLElement>('[data-log]');
    if (!log) return;
    const line = document.createElement('div');
    line.textContent = text; // Data, never markup.
    line.style.color = color;
    log.appendChild(line);
    while (log.childElementCount > 60) log.firstElementChild?.remove();
    log.scrollTop = log.scrollHeight;
  }
}
