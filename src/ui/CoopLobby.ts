/**
 * @module ui/CoopLobby
 * THE PARTY LOBBY (it.59): CO-OP MULTIPLAYER from the title screen.
 *
 *   CREATE PARTY → a room code (`KNG-482`) the leader shares.
 *   JOIN PARTY   → type a friend's code.
 *   Pick a nickname and a class, READY up; the leader presses START DELVE
 *   when every seat is ready. The lobby has its own chat.
 *
 * The lobby never touches the simulation: it produces one `CoopStart`
 * bundle (seed, roster, the leader's stash) that main hands to `startRun`.
 * The leader's town stash is the party's — every peer starts from the same
 * items, and every deposit / withdrawal flows through the lockstep stream.
 */

import { audio } from '@/engine/AudioManager';
import { type MemberInfo, PARTY_COLOR_CSS, PeerNet, normalizeRoomCode, sanitizeName } from '@/net/PeerNet';
import type { ClassArchetype } from '@/network/Serialization';
import type { PlayerSave, StashState } from '@/persist/SaveGame';

export interface CoopStart {
  net: PeerNet;
  seed: number;
  members: MemberInfo[];
  localSlot: number;
  stash: StashState;
}

export interface CoopLobbyHooks {
  /** The hero sheet this class keeps for co-op (null = fresh). */
  heroFor: (cls: ClassArchetype) => PlayerSave | null;
  /** The leader's stash, handed to the party. */
  stashFor: (cls: ClassArchetype) => StashState;
  /** Everyone is ready and the leader pressed START (or the START message arrived). */
  start: (cfg: CoopStart) => void;
  /** Back to the title. */
  closed: () => void;
}

const CLASSES: Array<{ id: ClassArchetype; name: string; blurb: string }> = [
  { id: 'warrior', name: 'WARRIOR', blurb: 'steel and stamina' },
  { id: 'mage', name: 'MAGE', blurb: 'fire and frost' },
  { id: 'ranger', name: 'RANGER', blurb: 'arrows and traps' },
  { id: 'rogue', name: 'ROGUE', blurb: 'blades and shadow' },
];

const NICK_KEY = 'iso-arpg-nick';

export class CoopLobbyUI {
  private readonly root: HTMLElement;
  private readonly abort = new AbortController();
  private net: PeerNet | null = null;
  private cls: ClassArchetype = 'warrior';
  private ready = false;
  private busy = false;
  private offNet: Array<() => void> = [];
  private started = false;

  constructor(private readonly hooks: CoopLobbyHooks) {
    this.root = document.createElement('div');
    this.root.id = 'coop-panel';
    this.root.innerHTML = `
      <div class="cp-box">
        <h2>CO-OP MULTIPLAYER</h2>
        <p class="cp-sub">four delvers · one crypt · peer to peer</p>
        <div class="cp-stage" data-stage="setup">
          <label class="cp-field"><span>NICKNAME</span><input type="text" data-nick maxlength="14" placeholder="Delver" spellcheck="false" autocomplete="off" /></label>
          <div class="cp-classes" data-classes></div>
          <div class="cp-actions">
            <button class="menu-btn" data-create>CREATE PARTY</button>
            <div class="cp-join"><input type="text" data-code maxlength="7" placeholder="KNG-482" spellcheck="false" autocomplete="off" /><button class="menu-btn" data-join>JOIN PARTY</button></div>
          </div>
          <p class="cp-status" data-status></p>
          <button class="cp-back" data-back>BACK</button>
        </div>
        <div class="cp-stage" data-stage="party" hidden>
          <div class="cp-code"><span>ROOM CODE</span><b data-codeout>———</b><button type="button" data-copy title="Copy the code">COPY</button></div>
          <ul class="cp-members" data-members></ul>
          <div class="cp-classes cp-classes-small" data-classes2></div>
          <div class="cp-chat"><div class="cp-log" data-log></div><input type="text" data-chat maxlength="200" placeholder="Say something to the party… (Enter)" spellcheck="false" autocomplete="off" /></div>
          <div class="cp-actions">
            <button class="menu-btn" data-ready>READY</button>
            <button class="menu-btn" data-start hidden>START DELVE</button>
          </div>
          <p class="cp-status" data-status2></p>
          <button class="cp-back" data-leave>LEAVE PARTY</button>
        </div>
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
        b.innerHTML = `<b>${c.name}</b><span>${c.blurb}</span>`;
        b.addEventListener('mouseenter', () => audio.sfx('uiHover'), { signal });
        b.addEventListener('click', () => this.pickClass(c.id), { signal });
        el.appendChild(b);
      }
    }
    try {
      q<HTMLInputElement>('[data-nick]').value = localStorage.getItem(NICK_KEY) ?? '';
    } catch {
      /* ignore */
    }
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
    q('[data-copy]').addEventListener(
      'click',
      () => {
        const code = this.net?.code ?? '';
        void navigator.clipboard?.writeText(code).then(
          () => this.status('Code copied.', false),
          () => this.status(`Share the code: ${code}`, false),
        );
      },
      { signal },
    );
    q('[data-ready]').addEventListener('click', () => this.toggleReady(), { signal });
    q('[data-start]').addEventListener('click', () => this.startDelve(), { signal });
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
    for (const sel of ['[data-nick]', '[data-code]', '[data-chat]']) {
      q(sel).addEventListener('keyup', (e) => e.stopPropagation(), { signal });
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
    this.pickClass('warrior');
  }

  get isOpen(): boolean {
    return this.root.classList.contains('show');
  }

  open(lastHero: ClassArchetype | null): void {
    this.started = false;
    if (lastHero) this.pickClass(lastHero);
    this.showStage('setup');
    this.status('', false);
    this.root.classList.add('show');
    this.root.querySelector<HTMLInputElement>('[data-nick]')?.focus();
  }

  /** Back to the title without a party. */
  close(): void {
    this.leaveNet();
    this.root.classList.remove('show');
    this.hooks.closed();
  }

  destroy(): void {
    this.leaveNet();
    this.abort.abort();
    this.root.remove();
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

  private pickClass(cls: ClassArchetype): void {
    this.cls = cls;
    this.root.querySelectorAll<HTMLButtonElement>('[data-cls]').forEach((b) => b.classList.toggle('on', b.dataset.cls === cls));
    const hero = this.hooks.heroFor(cls);
    const note = hero ? `co-op hero: level ${hero.level} ${cls}` : `a fresh level-1 ${cls} (kept between parties)`;
    this.root.querySelectorAll<HTMLElement>('.cp-classes').forEach((el) => el.setAttribute('data-note', note));
    if (this.net && !this.ready) this.net.send({ t: 'set', cls, hero });
    if (this.net?.isHost) this.net.setMember(0, { cls, hero });
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
    this.status(`Knocking on ${code}…`, false);
    try {
      const net = await PeerNet.join(code, this.nick, this.cls, this.hooks.heroFor(this.cls));
      this.attach(net);
      this.status('You are in. Pick a class and READY up.', false);
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
    this.offNet.push(net.onRoster(() => this.renderMembers()));
    this.offNet.push(
      net.onMessage((msg, from) => {
        if (msg.t === 'chat') {
          const m = net.members.find((x) => x.slot === msg.slot);
          this.log(`[${m?.name ?? `Delver ${msg.slot + 1}`}]: ${msg.text}`, PARTY_COLOR_CSS[msg.slot] ?? '#ddd');
        } else if (msg.t === 'sys') {
          this.log(`[System] ${msg.text}`, '#a89c80');
        } else if (msg.t === 'start' && !net.isHost) {
          this.launch({ net, seed: msg.seed, members: msg.members, localSlot: net.localSlot, stash: msg.stash });
        }
        void from;
      }),
    );
    net.onHostLost((reason) => {
      if (this.started) return; // The run owns the net now.
      this.detachNet();
      this.showStage('setup');
      this.status(reason, true);
    });
    this.root.querySelector<HTMLElement>('[data-codeout]')!.textContent = net.code;
    this.root.querySelector<HTMLElement>('[data-start]')!.hidden = !net.isHost;
    this.showStage('party');
    this.renderMembers();
    this.log(net.isHost ? `[System] Party ${net.code} is open. You are the Party Leader.` : `[System] Joined party ${net.code}.`, '#a89c80');
  }

  private renderMembers(): void {
    const net = this.net;
    const ul = this.root.querySelector<HTMLElement>('[data-members]');
    if (!net || !ul) return;
    ul.innerHTML = '';
    for (let slot = 0; slot < 4; slot++) {
      const m = net.members.find((x) => x.slot === slot);
      const li = document.createElement('li');
      li.style.setProperty('--slot-color', PARTY_COLOR_CSS[slot]);
      if (!m) {
        li.className = 'empty';
        li.textContent = 'empty seat';
      } else {
        li.className = m.online ? (m.ready ? 'ready' : '') : 'offline';
        const dot = document.createElement('i');
        const name = document.createElement('b');
        name.textContent = m.name + (slot === net.localSlot ? ' (you)' : '');
        const cls = document.createElement('span');
        cls.textContent = `${m.cls}${m.hero ? ` · lvl ${m.hero.level}` : ' · lvl 1'}`;
        const tag = document.createElement('em');
        tag.textContent = slot === 0 ? 'LEADER' : m.ready ? 'READY' : m.online ? 'not ready' : 'offline';
        li.append(dot, name, cls, tag);
      }
      ul.appendChild(li);
    }
    const me = net.members.find((x) => x.slot === net.localSlot);
    this.ready = !!me?.ready;
    const readyBtn = this.root.querySelector<HTMLElement>('[data-ready]')!;
    readyBtn.textContent = this.ready ? 'NOT READY' : 'READY';
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
    this.launch({ net, seed, members, localSlot: 0, stash });
  }

  private launch(cfg: CoopStart): void {
    if (this.started) return;
    this.started = true;
    this.detachNet(false);
    this.root.classList.remove('show');
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
