/**
 * @module net/PeerNet
 * 4-PLAYER CO-OP TRANSPORT (it.59, hardened it.60): serverless WebRTC via PeerJS.
 *
 * WHY PEERJS: the game ships on GitHub Pages with zero paid infrastructure.
 * PeerJS brokers the WebRTC handshake through its free public signalling
 * server (no account, no API key — the default `peerjs` key is public by
 * design) and then the party talks DIRECTLY, browser to browser, over a
 * reliable ordered DataChannel. Nothing game-related ever touches a server.
 *
 * NAT TRAVERSAL (it.60): ICE gathers over Google + Cloudflare STUN (both
 * verified live) and, when the player has entered one, a TURN relay (UDP,
 * TCP and TLS forms of the URL) — the only thing that carries a party across
 * symmetric NAT / CGNAT (mobile hotspots). Relay credentials are the
 * player's own (any free tier: Metered, ExpressTURN, Cloudflare Calls, a
 * coturn), stored in localStorage, never in code. A join that has not
 * opened its channel within 8 s is retried RELAY-ONLY.
 *
 * FAULT TOLERANCE (it.60): a 2 s ping-pong heartbeat measures latency both
 * ways; a link silent for 10 s is marked RECONNECTING (the seat is kept,
 * the party plays on); silence past 25 s drops it. A joiner whose channel
 * dies re-dials the leader on its own and asks for the frames it missed
 * (`resync`); a player who comes back through the lobby with the room code
 * is welcomed mid-run and handed the full command history to replay.
 *
 * TOPOLOGY: a star. The PARTY LEADER (host) opens a peer whose id is derived
 * from the room code; every joiner connects to that id. Every inbound
 * message is shape-checked; chat and nicknames are treated as data.
 */

import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import type { InputCommand } from '@/core/InputQueue';
import type { ClassArchetype } from '@/network/Serialization';
import type { FloorMemory, PlayerSave, StashState } from '@/persist/SaveGame';
import type { EnemyRec, HeroRec } from './StateSync';

export const PARTY_MAX = 4;
/** Bump when the wire format changes — mismatched builds refuse each other politely. */
export const PROTOCOL = 3;
/** Slot colours: gold (leader), sky, rose, moss. */
export const PARTY_COLORS: readonly number[] = [0xffd070, 0x7fc8ff, 0xff6f8a, 0x8ee08a];
export const PARTY_COLOR_CSS: readonly string[] = ['#ffd070', '#7fc8ff', '#ff6f8a', '#8ee08a'];
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // No I / O: nothing to misread.
const PEER_PREFIX = 'crypt-hollow-king-';
/** A direct channel that has not opened by now is retried relay-only. */
const DIRECT_TIMEOUT_MS = 8000;
const RELAY_TIMEOUT_MS = 15000;
const HEARTBEAT_MS = 2000;
/** Silence before a link reads RECONNECTING (the seat is kept). */
export const GRACE_MS = 10000;
/** Silence before a link is given up on. */
export const DROP_MS = 25000;
/** History is shipped in pieces this size (DataChannel messages stay small). */
const CHUNK = 48000;

export type LinkState = 'ok' | 'reconnecting';

export interface MemberInfo {
  slot: number;
  name: string;
  cls: ClassArchetype;
  ready: boolean;
  /** The hero sheet this member brings (null = a fresh level-1 hero). */
  hero: PlayerSave | null;
  online: boolean;
  /** Round trip to the leader in ms (the leader's own is 0). */
  ping?: number;
  link?: LinkState;
  /** Host bookkeeping: when the seat's link fell silent. */
  lastSilent?: number;
}

/** What a mid-run joiner replays: the party's start + every executed frame. */
export interface HistoryPayload {
  seed: number;
  members: MemberInfo[];
  stash: StashState;
  /** Last executed tick the frames cover. */
  upto: number;
  /** Non-empty frames only: [tick, commands]. */
  frames: Array<[number, InputCommand[]]>;
}

export interface ResyncPayload {
  from: number;
  upto: number;
  frames: Array<[number, InputCommand[]]>;
  /** Barrier ticks the leader resumed inside the window. */
  resumed: number[];
}

/**
 * A WORLD SNAPSHOT (it.73): what a player joining a delve in progress
 * receives instead of the whole command history. The floor is rebuilt from
 * the seed and its memory (what a save restores); the live things a save
 * does not keep — where every foe and hero stands, their health, the loot
 * on the ground, the exact point of every random stream — ride along, and
 * the frames from the snapshot's tick to the leader's present follow.
 */
export interface SnapshotPayload {
  seed: number;
  /** The tick the world below was taken at (the leader's last executed). */
  tick: number;
  floor: number;
  arena: boolean;
  /** The seats standing in the world right now, sheets current. */
  members: MemberInfo[];
  stash: StashState;
  floors: Record<number, FloorMemory>;
  seats: Array<{ slot: number; x: number; y: number; hp: number; res: number; dead: boolean }>;
  enemies: EnemyRec[];
  loot: { next: number; items: Array<{ uid: number; itemId: string; x: number; y: number }> };
  rng: { combat: number; loot: number; chests: number };
  bossSeen: boolean;
  /** The entity id counter when this floor was built (foes get the same ids). */
  idBase: number;
  floorStartTick: number;
  deepest: number;
  townVisits: number;
  portalReturn: { floor: number; arena: boolean; x: number; y: number } | null;
  /** The frames from `tick` to the leader's present. */
  frames: ResyncPayload;
}

export type NetMsg =
  | { t: 'hello'; proto: number; name: string; cls: ClassArchetype; hero: PlayerSave | null; rejoin?: { slot: number; lastTick: number } }
  | { t: 'welcome'; slot: number; code: string; phase: 'lobby' | 'run' }
  | { t: 'refuse'; reason: string }
  | { t: 'lobby'; members: MemberInfo[]; phase: 'lobby' | 'run' }
  | { t: 'set'; cls?: ClassArchetype; ready?: boolean; hero?: PlayerSave | null }
  | { t: 'chat'; slot: number; text: string }
  | { t: 'sys'; text: string }
  | { t: 'start'; seed: number; members: MemberInfo[]; stash: StashState }
  | { t: 'hist'; i: number; n: number; s: string }
  | { t: 'resync'; p: ResyncPayload }
  | { t: 'in'; k: number; c: InputCommand[] }
  | { t: 'fr'; k: number; c: Array<[number, InputCommand[]]> }
  | { t: 'bar'; k: number }
  | { t: 'res'; k: number }
  | { t: 'gone'; slot: number }
  | { t: 'link'; slot: number; state: LinkState }
  | { t: 'pings'; p: Record<number, number> }
  | { t: 'end'; reason: string }
  | { t: 'hb'; at: number }
  | { t: 'hba'; at: number }
  /** Host → all: the authoritative sample (it.73). */
  | { t: 'st'; k: number; e: EnemyRec[]; h: HeroRec[]; full: boolean; a?: number[] }
  /** Client → host: send a full keyframe. */
  | { t: 'sf' }
  /** Client → host: the frames since `from` (a barrier that never resumed here). */
  | { t: 'rs'; from: number }
  /** Host → a joiner: the world snapshot, in pieces. */
  | { t: 'snap'; i: number; n: number; s: string };

export type NetHandler = (msg: NetMsg, fromSlot: number) => void;

// --- ICE configuration ------------------------------------------------------

export interface RelaySettings {
  /** One or more TURN urls, comma / newline separated (`turn:host:3478`, `turns:host:443`). */
  urls: string;
  username: string;
  credential: string;
}

const RELAY_KEY = 'iso-arpg-turn';

export function loadRelaySettings(): RelaySettings | null {
  try {
    const raw = localStorage.getItem(RELAY_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as RelaySettings;
    return typeof v.urls === 'string' && v.urls.trim() ? { urls: v.urls, username: String(v.username ?? ''), credential: String(v.credential ?? '') } : null;
  } catch {
    return null;
  }
}

export function saveRelaySettings(s: RelaySettings | null): void {
  try {
    if (!s || !s.urls.trim()) localStorage.removeItem(RELAY_KEY);
    else localStorage.setItem(RELAY_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

/**
 * STUN from two independent providers (verified reachable), plus the
 * player's TURN. A bare `turn:host:port` is expanded to its UDP, TCP and
 * TLS forms so a relay is reachable through the strictest firewall.
 */
export function buildIceServers(relay: RelaySettings | null = loadRelaySettings()): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  if (relay) {
    const urls = new Set<string>();
    for (const raw of relay.urls.split(/[\s,]+/)) {
      const u = raw.trim();
      if (!/^turns?:/i.test(u)) continue;
      urls.add(u);
      if (/^turn:/i.test(u) && !u.includes('?')) {
        urls.add(`${u}?transport=tcp`);
        const host = u.slice(5).replace(/:\d+$/, '');
        urls.add(`turns:${host}:443`);
      }
    }
    if (urls.size) servers.push({ urls: [...urls], username: relay.username, credential: relay.credential });
  }
  return servers;
}

/** Gather candidates for a few seconds and report what the network offers (lobby TEST button). */
export async function probeIce(relay: RelaySettings | null, ms = 6000): Promise<{ srflx: boolean; relay: boolean; count: number }> {
  const pc = new RTCPeerConnection({ iceServers: buildIceServers(relay) });
  let srflx = false;
  let relayed = false;
  let count = 0;
  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    count++;
    if (e.candidate.type === 'srflx') srflx = true;
    if (e.candidate.type === 'relay') relayed = true;
  };
  pc.createDataChannel('probe');
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((r) => setTimeout(r, ms));
  pc.close();
  return { srflx, relay: relayed, count };
}

// --- Helpers ------------------------------------------------------------------

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

class TimeoutError extends Error {}
class SeatLostError extends Error {}

interface Link {
  slot: number;
  conn: DataConnection;
  lastSeen: number;
}

export interface JoinOptions {
  /** Skip the direct attempt: TURN only (also the automatic fallback). */
  relayOnly?: boolean;
  /**
   * RECLAIM A SEAT (it.73): a player coming back through the lobby names
   * the seat they held; if the leader still has it in its grace window the
   * seat, the hero and the entity are theirs again — no fresh seat, no
   * doubled name in the roster.
   */
  rejoin?: { slot: number; lastTick: number };
}

// --- The transport --------------------------------------------------------------

export class PeerNet {
  readonly isHost: boolean;
  readonly code: string;
  localSlot = 0;
  /** Host: the roster it owns. Client: the last roster the host sent. */
  members: MemberInfo[] = [];
  phase: 'lobby' | 'run' = 'lobby';
  /** How this peer reached the party ('relay' = through TURN). */
  path: 'direct' | 'relay' = 'direct';
  /** The player's own round trip to the leader (ms). */
  ping = 0;
  /** Client: the leader's link as seen from here. */
  hostLink: LinkState = 'ok';

  /** Host: what a mid-run joiner replays (wired by the run). */
  historyProvider: (() => HistoryPayload) | null = null;
  /** Host: the frames a returning seat missed (wired by the run). */
  resyncProvider: ((from: number) => ResyncPayload) | null = null;
  /** Client: the last tick this sim executed (for `resync`). */
  lastTickProvider: (() => number) | null = null;
  /** Host: a new seat joined mid-run — inject the JOIN (wired by the run). */
  onJoin: ((m: MemberInfo) => void) | null = null;
  /**
   * Host: the world right now, for a joiner (it.73). `null` means "not this
   * instant" (a floor is being raised) and the joiner waits a beat;
   * `undefined` means "no snapshot for this world" and the history goes.
   */
  snapshotProvider: (() => SnapshotPayload | null | undefined) | null = null;

  private peer: Peer | null = null;
  private readonly links: Link[] = [];
  private readonly handlers = new Set<NetHandler>();
  private readonly rosterHandlers = new Set<() => void>();
  private readonly linkHandlers = new Set<(slot: number, state: LinkState) => void>();
  private lostHandler: ((reason: string) => void) | null = null;
  private readonly historyHandlers = new Set<(h: HistoryPayload) => void>();
  private readonly snapshotHandlers = new Set<(s: SnapshotPayload) => void>();
  private readonly snapParts = new Map<number, string>();
  /** Host: joiners waiting for a snapshot the run could not take yet. */
  private readonly pendingJoins: Array<{ conn: DataConnection; member: MemberInfo; join: boolean }> = [];
  /**
   * THE RECENT FRAMES (it.73). A joiner's run is built for a second or two
   * after its snapshot lands, and the leader keeps broadcasting the whole
   * time; the lobby's own handler received those frames and dropped them,
   * the joiner's table had a hole, and its gate never opened again. Every
   * frame and resume a client hears is kept here (the last thirty seconds),
   * and a lockstep that comes to life reads them first.
   */
  private readonly recent: NetMsg[] = [];
  private heartbeat = 0;
  private destroyed = false;
  /** Client: when the host last said anything (frames, chat, heartbeats). */
  private hostSeen = 0;
  private reconnecting = false;
  private relayOnly = false;
  private hello: { name: string; cls: ClassArchetype; hero: PlayerSave | null } = { name: 'Delver', cls: 'warrior', hero: null };
  private readonly histParts = new Map<number, string>();

  private constructor(isHost: boolean, code: string) {
    this.isHost = isHost;
    this.code = code;
  }

  // --- Lifecycle ------------------------------------------------------------

  /** Open a party. Resolves once the broker has registered the room id. */
  static async host(name: string, cls: ClassArchetype, hero: PlayerSave | null): Promise<PeerNet> {
    const code = makeRoomCode();
    const net = new PeerNet(true, code);
    net.members = [{ slot: 0, name, cls, ready: false, hero, online: true, ping: 0, link: 'ok' }];
    await net.openPeer(peerIdFor(code), false);
    net.peer!.on('connection', (conn) => net.acceptJoiner(conn));
    net.startHeartbeat();
    return net;
  }

  /**
   * Join a party by code: a direct attempt first; if the channel has not
   * opened in 8 s the peer is rebuilt RELAY-ONLY and tried again.
   */
  static async join(code: string, name: string, cls: ClassArchetype, hero: PlayerSave | null, opts: JoinOptions = {}): Promise<PeerNet> {
    const net = new PeerNet(false, code);
    net.hello = { name, cls, hero };
    const attempt = async (relay: boolean, timeoutMs: number): Promise<void> => {
      net.relayOnly = relay;
      await net.openPeer(undefined, relay);
      await net.dial(timeoutMs, opts.rejoin);
      net.path = relay ? 'relay' : 'direct';
    };
    try {
      await attempt(!!opts.relayOnly, opts.relayOnly ? RELAY_TIMEOUT_MS : DIRECT_TIMEOUT_MS);
    } catch (err) {
      if (!opts.relayOnly && err instanceof Error && /closed the door/.test(err.message)) {
        // A channel that died before the welcome: one more knock, same path.
        net.closePeer();
        try {
          await attempt(false, DIRECT_TIMEOUT_MS);
          net.hostSeen = performance.now();
          net.startHeartbeat();
          return net;
        } catch (err2) {
          if (!(err2 instanceof TimeoutError)) {
            net.destroy();
            throw err2;
          }
        }
      } else if (opts.relayOnly || !(err instanceof TimeoutError)) {
        net.destroy();
        throw err;
      }
      // Direct path never opened (symmetric NAT / CGNAT): go through the relay.
      net.closePeer();
      try {
        await attempt(true, RELAY_TIMEOUT_MS);
      } catch (err2) {
        net.destroy();
        throw err2 instanceof TimeoutError
          ? new Error(
              loadRelaySettings()
                ? 'No path to the party, even through the relay. Check the TURN credentials.'
                : 'No direct path to the party (mobile hotspot / carrier NAT?). Enter a TURN relay under NETWORK RELAY and try again.',
            )
          : err2;
      }
    }
    net.hostSeen = performance.now();
    net.startHeartbeat();
    return net;
  }

  private peerOptions(relayOnly: boolean): PeerOptions {
    return {
      debug: 0,
      config: { iceServers: buildIceServers(), iceTransportPolicy: relayOnly ? 'relay' : 'all' },
    };
  }

  private openPeer(id: string | undefined, relayOnly: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      // The public PeerJS broker — no key, no account; only the handshake
      // passes through it, the game itself stays peer-to-peer.
      const opts = this.peerOptions(relayOnly);
      const peer = id ? new Peer(id, opts) : new Peer(opts);
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
        }
        // Later errors are per-connection; the links decide what they mean.
      });
      peer.on('disconnected', () => {
        // The broker link only matters for NEW joiners and re-dials; live
        // DataChannels keep flowing. Get it back when we can.
        if (!this.destroyed && this.peer === peer && !peer.destroyed) {
          try {
            peer.reconnect();
          } catch {
            /* the broker may refuse; live links are unaffected */
          }
        }
      });
    });
  }

  private closePeer(): void {
    const doomed = this.links.splice(0);
    for (const l of doomed) {
      try {
        l.conn.close();
      } catch {
        /* closing */
      }
    }
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.peer = null;
  }

  /** Client: open a channel to the leader and complete the hello / welcome. */
  private dial(timeoutMs: number, rejoin: { slot: number; lastTick: number } | undefined): Promise<void> {
    const peer = this.peer;
    if (!peer) return Promise.reject(new Error('No peer.'));
    return new Promise<void>((resolve, reject) => {
      const conn = peer.connect(peerIdFor(this.code), { reliable: true, serialization: 'json' });
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          conn.close();
        } catch {
          /* ignore */
        }
        reject(new TimeoutError('No party answered that code in time.'));
      }, timeoutMs);
      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };
      conn.on('open', () => {
        conn.send({ t: 'hello', proto: PROTOCOL, name: this.hello.name, cls: this.hello.cls, hero: this.hello.hero, rejoin } satisfies NetMsg);
      });
      conn.on('data', (raw: unknown) => {
        if (!isMsg(raw)) return;
        if (!settled) {
          if (raw.t === 'welcome') {
            settled = true;
            clearTimeout(timer);
            if (rejoin && raw.slot !== rejoin.slot) {
              // The grace window closed on the leader's side: the old seat is gone.
              try {
                conn.close();
              } catch {
                /* ignore */
              }
              reject(new SeatLostError('Your seat was given up while you were away. Rejoin from the lobby with the room code.'));
              return;
            }
            this.localSlot = raw.slot;
            this.phase = raw.phase === 'run' ? 'run' : 'lobby';
            this.links.length = 0;
            this.links.push({ slot: 0, conn, lastSeen: performance.now() });
            this.hostSeen = performance.now();
            resolve();
          } else if (raw.t === 'refuse') {
            fail(new Error(raw.reason));
          }
          return;
        }
        this.receive(raw, 0);
      });
      conn.on('close', () => {
        if (!settled) return fail(new Error('The party closed the door before answering.'));
        if (this.links[0]?.conn === conn) this.channelDied();
      });
      conn.on('error', (err) => {
        if (!settled) return fail(new Error(String((err as Error).message ?? err)));
        if (this.links[0]?.conn === conn) this.channelDied();
      });
      peer.on('error', (err) => {
        const type = (err as { type?: string }).type;
        if (!settled) fail(new Error(type === 'peer-unavailable' ? 'No party is open under that code.' : `Connection failed (${type ?? 'error'}).`));
      });
    });
  }

  /** Client: the channel to the leader closed — re-dial inside the grace window. */
  private channelDied(): void {
    if (this.destroyed || this.reconnecting) return;
    if (this.phase !== 'run') {
      this.hostLost('The connection to the Party Leader was lost.');
      return;
    }
    this.reconnecting = true;
    this.setHostLink('reconnecting');
    const deadline = performance.now() + DROP_MS;
    const tryAgain = async (): Promise<void> => {
      while (!this.destroyed && performance.now() < deadline) {
        try {
          if (!this.peer || this.peer.destroyed) await this.openPeer(undefined, this.relayOnly);
          else if (this.peer.disconnected) this.peer.reconnect();
          await this.dial(6000, { slot: this.localSlot, lastTick: this.lastTickProvider?.() ?? -1 });
          this.reconnecting = false;
          this.setHostLink('ok');
          return;
        } catch (err) {
          if (err instanceof SeatLostError) {
            this.reconnecting = false;
            this.hostLost(err.message);
            return;
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      this.reconnecting = false;
      this.hostLost('The Party Leader could not be reached again.');
    };
    void tryAgain();
  }

  /** QA hook: drop the channel to the leader as a network cut would. */
  simulateChannelLoss(): void {
    const l = this.links[0];
    if (!l) return;
    try {
      l.conn.close();
    } catch {
      /* ignore */
    }
  }

  /** Tear everything down: links, the peer, timers, handlers. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.heartbeat);
    this.closePeer();
    this.handlers.clear();
    this.rosterHandlers.clear();
    this.linkHandlers.clear();
    this.historyHandlers.clear();
    this.snapshotHandlers.clear();
    this.pendingJoins.length = 0;
    this.recent.length = 0;
    this.lostHandler = null;
  }

  get alive(): boolean {
    return !this.destroyed;
  }

  // --- Host: membership -----------------------------------------------------

  private acceptJoiner(conn: DataConnection): void {
    let slot = -1;
    conn.on('data', (raw: unknown) => {
      if (this.destroyed || !isMsg(raw)) return;
      const l = this.links.find((x) => x.conn === conn);
      if (l) l.lastSeen = performance.now();
      if (slot >= 0) {
        // Silence over: the seat that read RECONNECTING is talking again.
        const mm = this.members.find((x) => x.slot === slot);
        if (mm && mm.link === 'reconnecting') {
          mm.link = 'ok';
          this.setLink(slot, 'ok');
          this.system(`${mm.name} is back.`);
          this.broadcastLobby();
        }
      }
      if (slot < 0) {
        if (raw.t !== 'hello') return;
        const refuse = (reason: string): void => {
          conn.send({ t: 'refuse', reason } satisfies NetMsg);
          window.setTimeout(() => conn.close(), 250);
        };
        if (raw.proto !== PROTOCOL) return refuse('Your game build does not match the leader’s. Reload and try again.');
        if (!VALID_CLASSES.includes(raw.cls)) return refuse('Unknown class.');
        const name = sanitizeName(String(raw.name ?? ''));
        // A seat coming back keeps everything (it.73): whether its old link
        // has already fallen silent or is still closing — a tab that reloads
        // knocks again before the leader has noticed it left. The room code
        // is the party's secret; the seat number is the claimant's own memory.
        const back = raw.rejoin ? this.members.find((m) => m.slot === raw.rejoin!.slot && m.online) : undefined;
        if (back) {
          slot = back.slot;
          this.dropLink(slot);
          this.links.push({ slot, conn, lastSeen: performance.now() });
          back.link = 'ok';
          back.name = name;
          conn.send({ t: 'welcome', slot, code: this.code, phase: this.phase } satisfies NetMsg);
          // The roster BEFORE the world (it.73): the lobby launches the run
          // from the snapshot and looks its own seat up in the roster — a
          // roster that arrived after the snapshot left it with no seat.
          this.broadcastLobby();
          const last = raw.rejoin!.lastTick;
          if (this.phase === 'run') {
            if (last >= 0 && this.resyncProvider) conn.send({ t: 'resync', p: this.resyncProvider(last) } satisfies NetMsg);
            else if (!this.sendJoinState(conn)) this.pendingJoins.push({ conn, member: back, join: false });
          }
          this.setLink(slot, 'ok');
          this.system(`${back.name} is back.`);
          this.broadcastLobby();
          return;
        }
        const free = this.freeSlot();
        if (free === null) return refuse('The party is full (four delvers).');
        slot = free;
        this.members = this.members.filter((m) => m.slot !== slot);
        const member: MemberInfo = { slot, name, cls: raw.cls, ready: this.phase === 'run', hero: raw.hero ?? null, online: true, ping: 0, link: 'ok' };
        this.members.push(member);
        this.members.sort((a, b) => a.slot - b.slot);
        this.links.push({ slot, conn, lastSeen: performance.now() });
        conn.send({ t: 'welcome', slot, code: this.code, phase: this.phase } satisfies NetMsg);
        this.broadcastLobby();
        if (this.phase === 'run') {
          // Mid-run (it.73): the world as it stands, then a JOIN in the next
          // frame. If a floor is being raised this instant, the joiner waits
          // for the next heartbeat and gets the new floor instead.
          if (this.sendJoinState(conn)) {
            this.onJoin?.(member);
            this.system(`${member.name} joins the delve.`);
          } else this.pendingJoins.push({ conn, member, join: true });
        } else {
          this.system(`${member.name} joined the party.`);
        }
        return;
      }
      this.receive(raw, slot);
    });
    const died = (): void => {
      if (slot < 0) return;
      const s = slot;
      slot = -1;
      const l = this.links.find((x) => x.conn === conn);
      if (!l || l.slot !== s) return; // A newer link already replaced this one.
      this.dropLink(s);
      const m = this.members.find((x) => x.slot === s);
      if (!m) return;
      if (this.phase === 'lobby') {
        this.members = this.members.filter((x) => x.slot !== s);
        this.system(`${m.name} left the party.`);
        this.broadcastLobby();
        return;
      }
      // In the crypt the seat is KEPT: they get the grace window to come back.
      if (m.link !== 'reconnecting') {
        m.link = 'reconnecting';
        m.lastSilent = performance.now();
        this.setLink(s, 'reconnecting');
        this.system(`${m.name} is reconnecting…`);
        this.broadcastLobby();
      }
    };
    conn.on('close', died);
    conn.on('error', died);
  }

  private dropLink(slot: number): void {
    // Remove first, close after: `close()` fires 'close' synchronously, and a
    // re-entrant drop splicing a shifted index once took a NEIGHBOUR's link.
    const doomed = this.links.filter((l) => l.slot === slot);
    for (let i = this.links.length - 1; i >= 0; i--) if (this.links[i].slot === slot) this.links.splice(i, 1);
    for (const l of doomed) {
      try {
        l.conn.close();
      } catch {
        /* closing */
      }
    }
  }

  /** Host: give up on a seat (grace window over). */
  private dropMember(slot: number): void {
    const m = this.members.find((x) => x.slot === slot);
    if (!m) return;
    this.dropLink(slot);
    m.online = false;
    m.ready = false;
    m.link = 'ok';
    this.system(`${m.name} left the party.`);
    this.broadcast({ t: 'gone', slot });
    this.dispatch({ t: 'gone', slot }, slot); // The host's own lockstep drops the seat too.
    if (this.phase === 'lobby') this.members = this.members.filter((x) => x.slot !== slot);
    this.broadcastLobby();
  }

  private freeSlot(): number | null {
    for (let s = 1; s < PARTY_MAX; s++) if (!this.members.some((m) => m.slot === s && m.online)) return s;
    return null;
  }

  /**
   * What a joiner gets (it.73): the snapshot when the run can take one, the
   * history when it cannot. False = not now (the caller queues the joiner).
   */
  private sendJoinState(conn: DataConnection): boolean {
    if (this.snapshotProvider) {
      const snap = this.snapshotProvider();
      if (snap === null) return false;
      if (snap) {
        const text = JSON.stringify(snap);
        const n = Math.max(1, Math.ceil(text.length / CHUNK));
        for (let i = 0; i < n; i++) conn.send({ t: 'snap', i, n, s: text.slice(i * CHUNK, (i + 1) * CHUNK) } satisfies NetMsg);
        return true;
      }
    }
    this.sendHistory(conn);
    return true;
  }

  private flushPendingJoins(): void {
    for (let i = this.pendingJoins.length - 1; i >= 0; i--) {
      const pj = this.pendingJoins[i];
      if (!pj.conn.open) {
        this.pendingJoins.splice(i, 1);
        continue;
      }
      if (!this.sendJoinState(pj.conn)) continue;
      this.pendingJoins.splice(i, 1);
      if (pj.join) {
        this.onJoin?.(pj.member);
        this.system(`${pj.member.name} joins the delve.`);
      }
    }
  }

  onSnapshot(fn: (s: SnapshotPayload) => void): () => void {
    this.snapshotHandlers.add(fn);
    return () => this.snapshotHandlers.delete(fn);
  }

  private sendHistory(conn: DataConnection): void {
    if (!this.historyProvider) return;
    const text = JSON.stringify(this.historyProvider());
    const n = Math.max(1, Math.ceil(text.length / CHUNK));
    for (let i = 0; i < n; i++) conn.send({ t: 'hist', i, n, s: text.slice(i * CHUNK, (i + 1) * CHUNK) } satisfies NetMsg);
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

  onlineSlots(): number[] {
    return this.members.filter((m) => m.online).map((m) => m.slot);
  }

  private setLink(slot: number, state: LinkState): void {
    this.broadcast({ t: 'link', slot, state });
    for (const fn of this.linkHandlers) fn(slot, state);
  }

  private setHostLink(state: LinkState): void {
    this.hostLink = state;
    for (const fn of this.linkHandlers) fn(0, state);
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

  /** A seat's link changed (host: any seat; client: slot 0 = the leader). */
  onLink(fn: (slot: number, state: LinkState) => void): () => void {
    this.linkHandlers.add(fn);
    return () => this.linkHandlers.delete(fn);
  }

  /** Client: the leader handed over the history of a run in progress. */
  onHistory(fn: (h: HistoryPayload) => void): () => void {
    this.historyHandlers.add(fn);
    return () => this.historyHandlers.delete(fn);
  }

  /** Client: the host is gone for good (grace window over, or it said so). Fires once. */
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
    const now = performance.now();
    if (!this.isHost) {
      this.hostSeen = now;
      if (this.hostLink !== 'ok' && !this.reconnecting) this.setHostLink('ok');
    }
    switch (msg.t) {
      case 'hb':
        // Ping-pong: answer with the sender's stamp.
        if (this.isHost) this.sendTo(fromSlot, { t: 'hba', at: msg.at });
        else this.send({ t: 'hba', at: msg.at });
        return;
      case 'hba': {
        const rtt = Math.max(0, Math.round(now - msg.at));
        if (this.isHost) {
          const m = this.members.find((x) => x.slot === fromSlot);
          if (m) m.ping = rtt;
        } else this.ping = rtt;
        return;
      }
      default:
        break;
    }
    if (this.isHost) {
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
        case 'rs':
          // A barrier that never resumed on that peer (it.73): hand it the
          // frames and the resumed ticks since where it stands.
          if (this.resyncProvider && Number.isInteger(msg.from)) this.sendTo(fromSlot, { t: 'resync', p: this.resyncProvider(msg.from) });
          return;
        default:
          break;
      }
    } else {
      switch (msg.t) {
        case 'lobby':
          this.members = Array.isArray(msg.members) ? msg.members : [];
          this.phase = msg.phase === 'run' ? 'run' : 'lobby';
          for (const fn of this.rosterHandlers) fn();
          break;
        case 'pings':
          for (const m of this.members) if (msg.p[m.slot] !== undefined) m.ping = msg.p[m.slot];
          for (const fn of this.rosterHandlers) fn();
          return;
        case 'link': {
          const m = this.members.find((x) => x.slot === msg.slot);
          if (m) m.link = msg.state;
          for (const fn of this.linkHandlers) fn(msg.slot, msg.state);
          return;
        }
        case 'hist': {
          this.histParts.set(msg.i, msg.s);
          if (this.histParts.size === msg.n) {
            let text = '';
            for (let i = 0; i < msg.n; i++) text += this.histParts.get(i) ?? '';
            this.histParts.clear();
            try {
              const h = JSON.parse(text) as HistoryPayload;
              for (const fn of this.historyHandlers) fn(h);
            } catch (err) {
              console.error('[net] history unreadable:', err);
            }
          }
          return;
        }
        case 'snap': {
          this.snapParts.set(msg.i, msg.s);
          if (this.snapParts.size === msg.n) {
            let text = '';
            for (let i = 0; i < msg.n; i++) text += this.snapParts.get(i) ?? '';
            this.snapParts.clear();
            try {
              const snap = JSON.parse(text) as SnapshotPayload;
              this.phase = 'run';
              for (const fn of this.snapshotHandlers) fn(snap);
            } catch (err) {
              console.error('[net] snapshot unreadable:', err);
            }
          }
          return;
        }
        case 'start':
          this.phase = 'run'; // From here a dropped channel is re-dialled, not mourned.
          break;
        case 'end':
          this.hostLost(msg.reason);
          return;
        default:
          break;
      }
    }
    this.dispatch(msg, fromSlot);
  }

  /** Client: the frames and resumes heard lately, oldest first. */
  recentFrames(): readonly NetMsg[] {
    return this.recent;
  }

  private dispatch(msg: NetMsg, fromSlot: number): void {
    if (!this.isHost && (msg.t === 'fr' || msg.t === 'res')) {
      this.recent.push(msg);
      if (this.recent.length > 2400) this.recent.splice(0, this.recent.length - 2400);
    }
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

  private lastPulse = 0;

  /**
   * The heartbeat body, callable from the game loop (it.60): a hidden tab's
   * setInterval is throttled to once a minute, the loop's Worker clock is not.
   */
  pulse(): void {
    if (this.destroyed) return;
    const now = performance.now();
    if (now - this.lastPulse < HEARTBEAT_MS) return;
    this.lastPulse = now;
    this.beat(now);
  }

  private startHeartbeat(): void {
    this.heartbeat = window.setInterval(() => this.pulse(), HEARTBEAT_MS);
  }

  private beat(now: number): void {
    {
      if (this.isHost) {
        for (const l of this.links) this.sendTo(l.slot, { t: 'hb', at: now });
        const pings: Record<number, number> = { 0: 0 };
        for (const m of this.members) pings[m.slot] = m.ping ?? 0;
        if (this.phase === 'run') this.broadcast({ t: 'pings', p: pings });
        else this.broadcastLobby();
        this.flushPendingJoins();
        for (const m of [...this.members]) {
          if (m.slot === 0 || !m.online) continue;
          const l = this.links.find((x) => x.slot === m.slot);
          const silent = now - (l ? l.lastSeen : (m.lastSilent ?? now));
          if (l && silent > GRACE_MS && m.link !== 'reconnecting' && this.phase === 'run') {
            m.link = 'reconnecting';
            m.lastSilent = l.lastSeen;
            this.setLink(m.slot, 'reconnecting');
            this.system(`${m.name} is reconnecting…`);
            this.broadcastLobby();
          }
          if (silent > DROP_MS) this.dropMember(m.slot);
        }
      } else {
        this.send({ t: 'hb', at: now });
        const silent = now - this.hostSeen;
        if (silent > GRACE_MS && this.hostLink === 'ok') this.setHostLink('reconnecting');
        if (silent > DROP_MS && !this.reconnecting) this.hostLost('The Party Leader stopped answering.');
      }
    }
  }
}
