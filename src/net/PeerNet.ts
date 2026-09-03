/**
 * @module net/PeerNet
 * 4-PLAYER CO-OP TRANSPORT (it.59): serverless WebRTC through PeerJS.
 *
 * WHY PEERJS: the game ships on GitHub Pages with zero paid infrastructure.
 * PeerJS brokers the WebRTC handshake through its free public signalling
 * server (no account, no API key — the default `peerjs` key is public by
 * design) and then the party talks DIRECTLY, browser to browser, over a
 * reliable ordered DataChannel. Nothing game-related ever touches a server.
 *
 * TOPOLOGY: a star. The PARTY LEADER (host) opens a peer whose id is derived
 * from the room code; every joiner connects to that id. The host relays
 * lobby state, chat and the lockstep frames (see `Lockstep`). A joiner only
 * ever talks to the host, so a member dropping never disturbs the others.
 *
 * SECURITY & PRIVACY: room codes come from `crypto.getRandomValues`, nothing
 * is hardcoded, peers are addressed by the code alone, every inbound message
 * is shape-checked before use, and chat text is treated as data (the UI
 * renders it through `textContent`, never HTML).
 */

import { Peer, type DataConnection } from 'peerjs';
import type { InputCommand } from '@/core/InputQueue';
import type { ClassArchetype } from '@/network/Serialization';
import type { PlayerSave, StashState } from '@/persist/SaveGame';

export const PARTY_MAX = 4;
/** Bump when the wire format changes — mismatched builds refuse each other politely. */
export const PROTOCOL = 1;
/** Slot colours: gold (leader), sky, rose, moss. */
export const PARTY_COLORS: readonly number[] = [0xffd070, 0x7fc8ff, 0xff6f8a, 0x8ee08a];
export const PARTY_COLOR_CSS: readonly string[] = ['#ffd070', '#7fc8ff', '#ff6f8a', '#8ee08a'];
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // No I / O: nothing to misread.
const PEER_PREFIX = 'crypt-hollow-king-';
const HELLO_TIMEOUT_MS = 15000;
const HEARTBEAT_MS = 2000;
const HEARTBEAT_TIMEOUT_MS = 9000;

export interface MemberInfo {
  slot: number;
  name: string;
  cls: ClassArchetype;
  ready: boolean;
  /** The hero sheet this member brings (null = a fresh level-1 hero). */
  hero: PlayerSave | null;
  online: boolean;
}

export type NetMsg =
  | { t: 'hello'; proto: number; name: string; cls: ClassArchetype; hero: PlayerSave | null }
  | { t: 'welcome'; slot: number; code: string }
  | { t: 'refuse'; reason: string }
  | { t: 'lobby'; members: MemberInfo[]; phase: 'lobby' | 'run' }
  | { t: 'set'; cls?: ClassArchetype; ready?: boolean; hero?: PlayerSave | null }
  | { t: 'chat'; slot: number; text: string }
  | { t: 'sys'; text: string }
  | { t: 'start'; seed: number; members: MemberInfo[]; stash: StashState }
  | { t: 'in'; k: number; c: InputCommand[] }
  | { t: 'fr'; k: number; c: Array<[number, InputCommand[]]> }
  | { t: 'bar'; k: number }
  | { t: 'res'; k: number }
  | { t: 'gone'; slot: number }
  | { t: 'end'; reason: string }
  | { t: 'hb' };

export type NetHandler = (msg: NetMsg, fromSlot: number) => void;

/** A cryptographically random room code, `KNG-482` style. */
export function makeRoomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < 3; i++) s += CODE_LETTERS[bytes[i] % CODE_LETTERS.length];
  s += '-';
  for (let i = 3; i < 6; i++) s += String(bytes[i] % 10);
  return s;
}

/** Normalise what a player typed: `kng482`, `KNG 482`, `KNG-482` all match. */
export function normalizeRoomCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 6) return null;
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

const peerIdFor = (code: string): string => `${PEER_PREFIX}${code.replace('-', '').toLowerCase()}`;

/** Nicknames are plain text, trimmed, capped — never markup. */
export function sanitizeName(raw: string): string {
  const s = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 14);
  return s.length > 0 ? s : 'Delver';
}

export function sanitizeChat(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
}

const VALID_CLASSES: ReadonlyArray<string> = ['warrior', 'mage', 'ranger', 'rogue'];

function isMsg(v: unknown): v is NetMsg {
  return typeof v === 'object' && v !== null && typeof (v as { t?: unknown }).t === 'string';
}

interface Link {
  slot: number;
  conn: DataConnection;
  lastSeen: number;
}

export class PeerNet {
  readonly isHost: boolean;
  readonly code: string;
  localSlot = 0;
  /** Host: the roster it owns. Client: the last roster the host sent. */
  members: MemberInfo[] = [];
  phase: 'lobby' | 'run' = 'lobby';

  private peer: Peer | null = null;
  /** Host: one link per joiner. Client: exactly one link (to the host). */
  private readonly links: Link[] = [];
  private readonly handlers = new Set<NetHandler>();
  private readonly rosterHandlers = new Set<() => void>();
  private lostHandler: ((reason: string) => void) | null = null;
  private heartbeat = 0;
  private destroyed = false;
  /** Client: when the host last said anything (frames, chat, heartbeats). */
  private hostSeen = 0;

  private constructor(isHost: boolean, code: string) {
    this.isHost = isHost;
    this.code = code;
  }

  // --- Lifecycle ------------------------------------------------------------

  /** Open a party. Resolves once the broker has registered the room id. */
  static async host(name: string, cls: ClassArchetype, hero: PlayerSave | null): Promise<PeerNet> {
    const code = makeRoomCode();
    const net = new PeerNet(true, code);
    net.members = [{ slot: 0, name, cls, ready: false, hero, online: true }];
    await net.openPeer(peerIdFor(code));
    net.peer!.on('connection', (conn) => net.acceptJoiner(conn));
    net.startHeartbeat();
    return net;
  }

  /** Join a party by code. Resolves with the slot the host assigned. */
  static async join(code: string, name: string, cls: ClassArchetype, hero: PlayerSave | null): Promise<PeerNet> {
    const net = new PeerNet(false, code);
    await net.openPeer(undefined);
    const conn = net.peer!.connect(peerIdFor(code), { reliable: true, serialization: 'json' });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('No party answered that code. Check it and try again.'));
      }, HELLO_TIMEOUT_MS);
      conn.on('open', () => {
        conn.send({ t: 'hello', proto: PROTOCOL, name, cls, hero } satisfies NetMsg);
      });
      conn.on('data', (raw: unknown) => {
        if (!isMsg(raw)) return;
        if (!settled) {
          if (raw.t === 'welcome') {
            settled = true;
            clearTimeout(timer);
            net.localSlot = raw.slot;
            resolve();
          } else if (raw.t === 'refuse') {
            settled = true;
            clearTimeout(timer);
            reject(new Error(raw.reason));
          }
          return;
        }
        net.receive(raw, 0);
      });
      conn.on('close', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('The party closed the door before answering.'));
          return;
        }
        net.hostLost('The connection to the Party Leader was lost.');
      });
      conn.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(String((err as Error).message ?? err)));
        }
      });
      net.peer!.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const type = (err as { type?: string }).type;
        reject(new Error(type === 'peer-unavailable' ? 'No party is open under that code.' : `Connection failed (${type ?? 'error'}).`));
      });
    });
    net.links.push({ slot: 0, conn, lastSeen: performance.now() });
    net.hostSeen = performance.now();
    net.startHeartbeat();
    return net;
  }

  private openPeer(id: string | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      // The public PeerJS broker — no key, no account; only the handshake
      // passes through it, the game itself stays peer-to-peer.
      const peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
      this.peer = peer;
      let settled = false;
      peer.on('open', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      peer.on('error', (err) => {
        const type = (err as { type?: string }).type ?? 'error';
        if (!settled) {
          settled = true;
          reject(
            new Error(
              type === 'unavailable-id'
                ? 'That room code is already in use — create the party again.'
                : type === 'network' || type === 'server-error' || type === 'socket-error'
                  ? 'The matchmaking broker cannot be reached. Check your connection.'
                  : type === 'browser-incompatible'
                    ? 'This browser cannot open peer connections.'
                    : `Connection error (${type}).`,
            ),
          );
          return;
        }
        // Later errors: a joiner's id vanished, or the socket dropped.
        if (type === 'network' || type === 'socket-error' || type === 'socket-closed') {
          if (!this.isHost) this.hostLost('The connection to the Party Leader was lost.');
        }
      });
      peer.on('disconnected', () => {
        // The broker link only matters for NEW joiners; live DataChannels
        // keep flowing. Try to get it back so late joiners can still knock.
        if (!this.destroyed && this.peer && !this.peer.destroyed) {
          try {
            this.peer.reconnect();
          } catch {
            /* the broker may refuse; live links are unaffected */
          }
        }
      });
    });
  }

  /** Tear everything down: links, the peer, timers, handlers. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.heartbeat);
    for (const l of this.links) {
      try {
        l.conn.close();
      } catch {
        /* already closed */
      }
    }
    this.links.length = 0;
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.peer = null;
    this.handlers.clear();
    this.rosterHandlers.clear();
    this.lostHandler = null;
  }

  get alive(): boolean {
    return !this.destroyed;
  }

  // --- Host: membership -----------------------------------------------------

  private acceptJoiner(conn: DataConnection): void {
    let slot = -1;
    const stamp = (): void => {
      const l = this.links.find((x) => x.conn === conn);
      if (l) l.lastSeen = performance.now();
    };
    conn.on('data', (raw: unknown) => {
      if (this.destroyed || !isMsg(raw)) return;
      stamp();
      if (slot < 0) {
        if (raw.t !== 'hello') return;
        const refuse = (reason: string): void => {
          conn.send({ t: 'refuse', reason } satisfies NetMsg);
          window.setTimeout(() => conn.close(), 250);
        };
        if (raw.proto !== PROTOCOL) return refuse('Your game build does not match the leader’s. Reload and try again.');
        if (this.phase === 'run') return refuse('The party is already in the crypt. Ask the leader to return to the lobby.');
        if (!VALID_CLASSES.includes(raw.cls)) return refuse('Unknown class.');
        const free = this.freeSlot();
        if (free === null) return refuse('The party is full (four delvers).');
        slot = free;
        this.members = this.members.filter((m) => m.slot !== slot);
        this.members.push({ slot, name: sanitizeName(String(raw.name ?? '')), cls: raw.cls, ready: false, hero: raw.hero ?? null, online: true });
        this.members.sort((a, b) => a.slot - b.slot);
        this.links.push({ slot, conn, lastSeen: performance.now() });
        conn.send({ t: 'welcome', slot, code: this.code } satisfies NetMsg);
        this.broadcastLobby();
        this.system(`${this.members.find((m) => m.slot === slot)!.name} joined the party.`);
        return;
      }
      this.receive(raw, slot);
    });
    const drop = (): void => {
      if (slot < 0) return;
      const i = this.links.findIndex((x) => x.conn === conn);
      if (i >= 0) this.links.splice(i, 1);
      const m = this.members.find((x) => x.slot === slot);
      if (m && m.online) {
        m.online = false;
        m.ready = false;
        this.system(`${m.name} left the party.`);
        if (this.phase === 'lobby') this.members = this.members.filter((x) => x.slot !== slot);
        this.broadcast({ t: 'gone', slot });
        this.dispatch({ t: 'gone', slot }, slot); // The host's own lockstep drops the seat too.
        this.broadcastLobby();
      }
      slot = -1;
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  private freeSlot(): number | null {
    for (let s = 1; s < PARTY_MAX; s++) if (!this.members.some((m) => m.slot === s && m.online)) return s;
    return null;
  }

  /** Host: push the roster to everyone (and to local listeners). */
  broadcastLobby(): void {
    if (!this.isHost) return;
    this.broadcast({ t: 'lobby', members: this.members, phase: this.phase });
    for (const fn of this.rosterHandlers) fn();
  }

  /** Host: set a member's lobby fields (its own via slot 0). */
  setMember(slot: number, patch: { cls?: ClassArchetype; ready?: boolean; hero?: PlayerSave | null }): void {
    const m = this.members.find((x) => x.slot === slot);
    if (!m) return;
    if (patch.cls && VALID_CLASSES.includes(patch.cls)) m.cls = patch.cls;
    if (patch.ready !== undefined) m.ready = !!patch.ready;
    if (patch.hero !== undefined) m.hero = patch.hero;
    this.broadcastLobby();
  }

  /** Host: kick a member out of the sim after they dropped (lockstep injects the LEAVE). */
  onlineSlots(): number[] {
    return this.members.filter((m) => m.online).map((m) => m.slot);
  }

  // --- Messaging ------------------------------------------------------------

  /** Host → every joiner. */
  broadcast(msg: NetMsg): void {
    if (!this.isHost || this.destroyed) return;
    for (const l of this.links) {
      try {
        if (l.conn.open) l.conn.send(msg);
      } catch {
        /* a closing link */
      }
    }
  }

  /** Client → host. (On the host this loops straight back to the local handlers.) */
  send(msg: NetMsg): void {
    if (this.destroyed) return;
    if (this.isHost) {
      this.receive(msg, 0);
      return;
    }
    const l = this.links[0];
    try {
      if (l && l.conn.open) l.conn.send(msg);
    } catch {
      /* closing */
    }
  }

  sendTo(slot: number, msg: NetMsg): void {
    if (!this.isHost) return;
    const l = this.links.find((x) => x.slot === slot);
    try {
      if (l && l.conn.open) l.conn.send(msg);
    } catch {
      /* closing */
    }
  }

  onMessage(fn: NetHandler): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  onRoster(fn: () => void): () => void {
    this.rosterHandlers.add(fn);
    return () => this.rosterHandlers.delete(fn);
  }

  /** Client: the host vanished (close, error, heartbeat silence). Fires once. */
  onHostLost(fn: (reason: string) => void): void {
    this.lostHandler = fn;
  }

  /** Chat from the local player: the host stamps and relays it. */
  chat(text: string): void {
    const clean = sanitizeChat(text);
    if (!clean) return;
    this.send({ t: 'chat', slot: this.localSlot, text: clean });
  }

  /** Host: a `[System]` line to everyone (and itself). */
  system(text: string): void {
    if (!this.isHost) return;
    const msg: NetMsg = { t: 'sys', text };
    this.broadcast(msg);
    this.dispatch(msg, 0);
  }

  private receive(msg: NetMsg, fromSlot: number): void {
    if (this.destroyed) return;
    if (!this.isHost) this.hostSeen = performance.now();
    if (msg.t === 'hb') return;
    if (this.isHost) {
      // Relay duties.
      switch (msg.t) {
        case 'chat': {
          const relayed: NetMsg = { t: 'chat', slot: fromSlot, text: sanitizeChat(String(msg.text ?? '')) };
          if (!relayed.text) return;
          this.broadcast(relayed);
          this.dispatch(relayed, fromSlot);
          return;
        }
        case 'set':
          this.setMember(fromSlot, { cls: msg.cls, ready: msg.ready, hero: msg.hero });
          return;
        default:
          break;
      }
    } else {
      if (msg.t === 'lobby') {
        this.members = Array.isArray(msg.members) ? msg.members : [];
        this.phase = msg.phase === 'run' ? 'run' : 'lobby';
        for (const fn of this.rosterHandlers) fn();
      } else if (msg.t === 'end') {
        this.hostLost(msg.reason);
        return;
      }
    }
    this.dispatch(msg, fromSlot);
  }

  private dispatch(msg: NetMsg, fromSlot: number): void {
    for (const fn of this.handlers) {
      try {
        fn(msg, fromSlot);
      } catch (err) {
        console.error('[net] handler threw:', err);
      }
    }
  }

  private hostLost(reason: string): void {
    if (this.destroyed) return;
    const fn = this.lostHandler;
    this.lostHandler = null;
    this.destroy();
    fn?.(reason);
  }

  private startHeartbeat(): void {
    this.heartbeat = window.setInterval(() => {
      if (this.destroyed) return;
      const now = performance.now();
      if (this.isHost) {
        this.broadcast({ t: 'hb' });
        for (const l of [...this.links]) {
          if (now - l.lastSeen > HEARTBEAT_TIMEOUT_MS) {
            try {
              l.conn.close(); // Triggers the drop handler.
            } catch {
              /* ignore */
            }
          }
        }
      } else {
        this.send({ t: 'hb' });
        if (this.hostSeen > 0 && now - this.hostSeen > HEARTBEAT_TIMEOUT_MS) this.hostLost('The Party Leader stopped answering.');
      }
    }, HEARTBEAT_MS);
  }
}
