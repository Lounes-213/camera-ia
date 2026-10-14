/**
 * RoomManager — orchestrates a shared room on top of PeerTransport.
 *
 * Responsibilities:
 *  - create / join / leave, with a 5-character code and a share link;
 *  - the star topology: the host relays guest messages to the other guests;
 *  - a late joiner receives a full snapshot immediately;
 *  - transform/material updates are throttled to ~18 Hz and sent as deltas;
 *  - a "control lock" keeps two people from fighting over the same object;
 *  - ping/pong latency, heartbeat, auto-reconnect and host migration;
 *  - remote cursors and emoji reactions.
 *
 * It never touches the DOM or the 3D scene: the app passes callbacks in, which
 * the actions layer wires to the store.
 */
import type {
  MaterialState,
  PeerInfo,
  PeerStatus,
  RoomState,
  TransformState,
} from '../../app/state';
import type { TranslationKey } from '../../ui/i18n';
import { CONFIG } from '../../app/config';
import type { ModelRef, SharedSnapshot, SyncMessage } from './StateSync';
import {
  PROTOCOL_VERSION,
  deserialize,
  generateRoomCode,
  isNewer,
  normalizeRoomCode,
  serialize,
} from './StateSync';
import { PeerTransport } from './PeerTransport';
import { RemoteCursorLayer } from './RemoteCursor';

export interface RoomCallbacks {
  onStateChanged: (state: RoomState) => void;
  onSnapshot: (snapshot: SharedSnapshot) => void;
  onRemoteObject: (objectId: string, modelRef: ModelRef | null) => void;
  onRemoteMaterial: (patch: Partial<MaterialState>) => void;
  onRemoteTransform: (patch: Partial<TransformState>) => void;
  onReaction: (emoji: string, name: string) => void;
  onNotice: (key: TranslationKey, vars?: Record<string, string | number>) => void;
  getLocalSnapshot: () => SharedSnapshot;
}

interface RemotePeerRecord {
  id: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
  latency: number;
  lastPong: number;
  lastSeen: number;
}

const HEARTBEAT_MS = 2000;
const PEER_TIMEOUT_MS = 8000;
const CONTROL_IDLE_MS = 3000;

export class RoomManager {
  private transport: PeerTransport | null = null;
  private cursors: RemoteCursorLayer | null = null;
  private status: PeerStatus = 'idle';
  private code: string | null = null;
  private isHost = false;
  private error: string | null = null;
  private readonly peers = new Map<string, RemotePeerRecord>();
  private localName = 'Guest';
  private controlHolder: string | null = null;
  private controlRequested = false;
  private lastControlActivity = 0;
  private heartbeatTimer: number | null = null;
  private outbound: {
    transform: Partial<TransformState> | null;
    material: Partial<MaterialState> | null;
    lastFlush: number;
  } = { transform: null, material: null, lastFlush: 0 };
  private lastAccepted = { ts: 0, seq: 0 };
  private disposed = false;

  constructor(private readonly callbacks: RoomCallbacks) {}

  // ---- lifecycle -----------------------------------------------------------

  /** Creates a room as host and returns its code. */
  async create(name: string): Promise<string | null> {
    this.localName = name || 'Host';
    const code = generateRoomCode();
    await this.open(code, true);
    return this.code;
  }

  /** Joins an existing room by code. */
  async join(codeInput: string, name: string): Promise<boolean> {
    const code = normalizeRoomCode(codeInput);
    if (!code) return false;
    this.localName = name || 'Guest';
    await this.open(code, false);
    return this.status === 'connected';
  }

  /** Leaves the room and releases every resource. */
  leave(): void {
    this.broadcast({ t: 'bye', v: PROTOCOL_VERSION, from: this.localId, peerId: this.localId });
    this.stopTimers();
    this.transport?.destroy();
    this.transport = null;
    this.cursors?.dispose();
    this.cursors = null;
    this.peers.clear();
    this.status = 'idle';
    this.code = null;
    this.isHost = false;
    this.error = null;
    this.controlHolder = null;
    this.controlRequested = false;
    this.emitState();
  }

  dispose(): void {
    this.disposed = true;
    this.leave();
  }

  private async open(code: string, isHost: boolean): Promise<void> {
    this.leave();
    this.disposed = false;
    this.code = code;
    this.isHost = isHost;
    this.status = isHost ? 'creating' : 'joining';
    this.error = null;
    this.emitState();

    this.cursors = new RemoteCursorLayer();
    this.transport = new PeerTransport({
      roomCode: code,
      isHost,
      onOpen: () => {
        this.status = 'connected';
        this.emitState();
        if (this.isHost) {
          this.peers.set(this.localId, {
            id: this.localId,
            name: this.localName,
            isHost: true,
            joinedAt: Date.now(),
            latency: 0,
            lastPong: Date.now(),
            lastSeen: Date.now(),
          });
        }
      },
      onData: (from, data) => this.handleData(from, data),
      onConnectionOpen: (peerId) => {
        this.status = 'connected';
        this.peers.set(peerId, {
          id: peerId,
          name: 'Guest',
          isHost: false,
          joinedAt: Date.now(),
          latency: 0,
          lastPong: Date.now(),
          lastSeen: Date.now(),
        });
        if (this.isHost) this.sendWelcome(peerId);
        this.emitState();
      },
      onConnectionClose: (peerId) => this.handlePeerGone(peerId),
      onError: (message) => {
        this.error = message;
        this.status = 'failed';
        this.emitState();
      },
      onReconnecting: () => {
        this.status = 'reconnecting';
        this.emitState();
      },
      onRestored: () => {
        this.status = 'connected';
        this.emitState();
      },
    });

    try {
      await this.transport.connect();
    } catch (err) {
      const message = (err as Error)?.message ?? 'connect-failed';
      if (message === 'room-id-taken' && isHost) {
        // Extremely unlikely, but pick another code instead of failing.
        return this.open(generateRoomCode(), true);
      }
      this.status = 'failed';
      this.error = message;
      this.emitState();
      return;
    }

    if (!isHost) {
      // Introduce ourselves; the host answers with a `welcome` + snapshot.
      this.send({ t: 'hello', v: PROTOCOL_VERSION, peerId: this.localId, name: this.localName, joinedAt: Date.now() });
    }

    this.startTimers();
    this.emitState();
  }

  private get localId(): string {
    return this.transport?.id ?? '';
  }

  /** The share link for this room, if any. */
  shareLink(): string | null {
    if (!this.code) return null;
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.code);
    url.hash = '';
    return url.toString();
  }

  getState(): RoomState {
    return {
      status: this.status,
      code: this.code,
      isHost: this.isHost,
      peers: this.peerList(),
      error: this.error,
      controlHolder: this.controlHolder,
      controlRequested: this.controlRequested,
    };
  }

  get remoteCursorCount(): number {
    return this.cursors?.size ?? 0;
  }

  // ---- sending -------------------------------------------------------------

  /** Sends a local object change to everyone. */
  sendObject(objectId: string, modelRef: ModelRef | null): void {
    this.send({
      t: 'object',
      v: PROTOCOL_VERSION,
      from: this.localId,
      seq: this.nextSeq(),
      ts: Date.now(),
      objectId,
      modelRef,
    });
  }

  /** Queues a material delta (flushed at syncHz). */
  sendMaterial(patch: Partial<MaterialState>): void {
    this.outbound.material = { ...(this.outbound.material ?? {}), ...patch };
  }

  /** Queues a transform delta (flushed at syncHz). */
  sendTransform(patch: Partial<TransformState>): void {
    this.outbound.transform = { ...(this.outbound.transform ?? {}), ...patch };
    this.lastControlActivity = performance.now();
  }

  /** Sends a remote cursor position. */
  sendCursor(x: number, y: number, active: boolean): void {
    this.send({
      t: 'cursor',
      v: PROTOCOL_VERSION,
      from: this.localId,
      name: this.localName,
      x,
      y,
      active,
    });
  }

  /** Sends an emoji reaction. */
  sendReaction(emoji: string): void {
    this.send({
      t: 'reaction',
      v: PROTOCOL_VERSION,
      from: this.localId,
      name: this.localName,
      emoji,
    });
  }

  /** Asks for the control lock (granted when free). */
  requestControl(): void {
    this.controlRequested = true;
    if (this.isHost && this.controlHolder === null) {
      this.setControlHolder(this.localId);
      return;
    }
    this.send({ t: 'control', v: PROTOCOL_VERSION, from: this.localId, holder: this.localId });
    this.emitState();
  }

  /** Releases the control lock if we hold it. */
  releaseControl(): void {
    if (this.controlHolder !== this.localId) return;
    this.controlRequested = false;
    this.setControlHolder(null);
  }

  /** True when this peer may transform the shared object. */
  canControl(): boolean {
    if (!this.code) return true;
    if (this.controlHolder === null) return true;
    return this.controlHolder === this.localId;
  }

  /** Pushes a full snapshot (used when the app state is replaced wholesale). */
  pushSnapshot(): void {
    this.send({
      t: 'snapshot',
      v: PROTOCOL_VERSION,
      from: this.localId,
      snapshot: this.callbacks.getLocalSnapshot(),
    });
  }

  /** Per-frame work: throttled flush, heartbeat, cursor interpolation. */
  tick(dt: number, nowMs: number): void {
    if (this.disposed) return;
    this.cursors?.tick(dt, nowMs);

    const interval = 1000 / CONFIG.room.syncHz;
    if (nowMs - this.outbound.lastFlush >= interval) {
      this.outbound.lastFlush = nowMs;
      this.flush();
    }

    // Auto-release the control lock after a short idle period.
    if (
      this.controlHolder === this.localId &&
      this.lastControlActivity > 0 &&
      nowMs - this.lastControlActivity > CONTROL_IDLE_MS
    ) {
      this.lastControlActivity = 0;
      this.releaseControl();
    }

    // Drop peers that stopped answering the heartbeat.
    const localId = this.localId;
    for (const [id, peer] of this.peers) {
      if (id === localId) continue;
      if (nowMs - peer.lastSeen > PEER_TIMEOUT_MS) this.handlePeerGone(id);
    }
  }

  // ---- internals -----------------------------------------------------------

  private flush(): void {
    if (this.outbound.transform) {
      this.send({
        t: 'transform',
        v: PROTOCOL_VERSION,
        from: this.localId,
        seq: this.nextSeq(),
        ts: Date.now(),
        patch: this.outbound.transform,
      });
      this.outbound.transform = null;
    }
    if (this.outbound.material) {
      this.send({
        t: 'material',
        v: PROTOCOL_VERSION,
        from: this.localId,
        seq: this.nextSeq(),
        ts: Date.now(),
        patch: this.outbound.material,
      });
      this.outbound.material = null;
    }
  }

  private seq = 0;
  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  /** Sends to the host when we are a guest, or broadcasts when we are host. */
  private send(message: SyncMessage): void {
    const payload = serialize(message);
    if (!payload) return;
    const transport = this.transport;
    if (!transport) return;

    if (this.isHost) {
      transport.broadcast(payload);
    } else {
      transport.send(this.hostId ?? '*', payload);
    }
  }

  private broadcast(message: SyncMessage): void {
    const payload = serialize(message);
    if (!payload || !this.transport) return;
    this.transport.broadcast(payload);
  }

  private hostId: string | null = null;

  private sendWelcome(peerId: string): void {
    this.transport?.send(
      peerId,
      serialize({
        t: 'welcome',
        v: PROTOCOL_VERSION,
        hostId: this.localId,
        snapshot: this.callbacks.getLocalSnapshot(),
      }) ?? '',
    );
    this.transport?.send(
      peerId,
      serialize({
        t: 'peers',
        v: PROTOCOL_VERSION,
        from: this.localId,
        peers: this.peerList().map((peer) => ({
          id: peer.id,
          name: peer.name,
          isHost: peer.isHost,
        })),
      }) ?? '',
    );
  }

  private handleData(from: string, data: unknown): void {
    const message = deserialize(data);
    if (!message) return;

    // Any traffic counts as a sign of life.
    const record = this.peers.get(from);
    if (record) {
      record.lastSeen = performance.now();
      record.lastPong = performance.now();
    }

    switch (message.t) {
      case 'hello': {
        this.peers.set(from, {
          id: from,
          name: message.name,
          isHost: false,
          joinedAt: message.joinedAt,
          latency: 0,
          lastPong: performance.now(),
          lastSeen: performance.now(),
        });
        if (this.isHost) {
          this.sendWelcome(from);
          this.callbacks.onNotice('room.joined', { name: message.name });
        }
        this.broadcastPeers();
        this.emitState();
        break;
      }
      case 'welcome': {
        this.hostId = message.hostId;
        this.peers.set(message.hostId, {
          id: message.hostId,
          name: 'Host',
          isHost: true,
          joinedAt: 0,
          latency: 0,
          lastPong: performance.now(),
          lastSeen: performance.now(),
        });
        this.callbacks.onSnapshot(message.snapshot);
        this.emitState();
        break;
      }
      case 'snapshot':
        this.callbacks.onSnapshot(message.snapshot);
        this.relay(from, message);
        break;
      case 'object':
        if (isNewer(message, this.lastAccepted)) {
          this.lastAccepted = { ts: message.ts, seq: message.seq };
          this.callbacks.onRemoteObject(message.objectId, message.modelRef);
        }
        this.relay(from, message);
        break;
      case 'material':
        if (isNewer(message, this.lastAccepted)) {
          this.lastAccepted = { ts: message.ts, seq: message.seq };
          this.callbacks.onRemoteMaterial(message.patch);
        }
        this.relay(from, message);
        break;
      case 'transform':
        if (isNewer(message, this.lastAccepted)) {
          this.lastAccepted = { ts: message.ts, seq: message.seq };
          this.callbacks.onRemoteTransform(message.patch);
        }
        this.relay(from, message);
        break;
      case 'cursor':
        this.cursors?.update(
          message.from,
          message.name,
          message.x,
          message.y,
          message.active,
          performance.now(),
        );
        this.relay(from, message);
        break;
      case 'reaction':
        this.callbacks.onReaction(message.emoji, message.name);
        this.relay(from, message);
        break;
      case 'control':
        if (this.isHost) {
          if (message.holder === null || this.controlHolder === null || this.controlHolder === message.from) {
            this.setControlHolder(message.holder);
          } else {
            // Deny: tell the requester who holds the lock.
            this.transport?.send(
              message.from,
              serialize({
                t: 'control',
                v: PROTOCOL_VERSION,
                from: this.localId,
                holder: this.controlHolder,
              }) ?? '',
            );
          }
        } else {
          this.controlHolder = message.holder;
          this.controlRequested = message.holder !== this.localId && this.controlRequested;
          this.emitState();
        }
        this.relay(from, message);
        break;
      case 'peers':
        for (const peer of message.peers) {
          if (peer.id === this.localId) continue;
          const existing = this.peers.get(peer.id);
          this.peers.set(peer.id, {
            id: peer.id,
            name: peer.name,
            isHost: peer.isHost,
            joinedAt: existing?.joinedAt ?? 0,
            latency: existing?.latency ?? 0,
            lastPong: performance.now(),
            lastSeen: performance.now(),
          });
        }
        this.emitState();
        break;
      case 'ping':
        this.transport?.send(
          from,
          serialize({ t: 'pong', v: PROTOCOL_VERSION, from: this.localId, ts: message.ts }) ?? '',
        );
        break;
      case 'pong': {
        const latency = Math.max(0, Date.now() - message.ts);
        const peer = this.peers.get(from);
        if (peer) {
          peer.latency = Math.round(peer.latency * 0.7 + latency * 0.3);
          peer.lastPong = performance.now();
        }
        this.emitState();
        break;
      }
      case 'bye':
        this.handlePeerGone(message.peerId);
        break;
      default:
        break;
    }
  }

  /** Host relays guest traffic so everyone converges (star topology). */
  private relay(from: string, message: SyncMessage): void {
    if (!this.isHost || !this.transport) return;
    const payload = serialize(message);
    if (!payload) return;
    for (const peerId of this.transport.connectedPeers()) {
      if (peerId === from) continue;
      this.transport.send(peerId, payload);
    }
  }

  private broadcastPeers(): void {
    if (!this.isHost) return;
    this.broadcast({
      t: 'peers',
      v: PROTOCOL_VERSION,
      from: this.localId,
      peers: this.peerList().map((peer) => ({
        id: peer.id,
        name: peer.name,
        isHost: peer.isHost,
      })),
    });
  }

  private handlePeerGone(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    this.cursors?.remove(peerId);
    if (!this.isHost && peer.isHost) this.migrateHost();
    if (this.controlHolder === peerId) this.setControlHolder(null);
    if (peer.name !== 'Guest') this.callbacks.onNotice('room.left', { name: peer.name });
    if (this.isHost) this.broadcastPeers();
    this.emitState();
  }

  /**
   * Host migration: the oldest remaining peer takes over the deterministic host
   * id so everyone else can reconnect to it.
   */
  private migrateHost(): void {
    const candidates = [...this.peers.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    const successor = candidates[0];
    if (!successor || successor.id !== this.localId) return;

    this.callbacks.onNotice('room.hostLeft');
    const code = this.code;
    if (!code) return;
    this.isHost = true;
    this.peers.clear();
    void this.open(code, true);
  }

  private setControlHolder(holder: string | null): void {
    this.controlHolder = holder;
    if (holder === this.localId) {
      this.controlRequested = false;
      this.lastControlActivity = performance.now();
    }
    if (this.isHost) {
      this.broadcast({ t: 'control', v: PROTOCOL_VERSION, from: this.localId, holder });
    }
    this.emitState();
  }

  private heartbeat(): void {
    if (this.disposed || !this.transport?.isOpen) return;
    const target = this.isHost ? '*' : (this.hostId ?? '*');
    const payload = serialize({
      t: 'ping',
      v: PROTOCOL_VERSION,
      from: this.localId,
      ts: Date.now(),
    });
    if (payload) this.transport.send(target, payload);

    if (this.isHost) {
      this.broadcastPeers();
    }
    this.emitState();
  }

  private startTimers(): void {
    this.stopTimers();
    this.heartbeatTimer = window.setInterval(() => this.heartbeat(), HEARTBEAT_MS);
  }

  private stopTimers(): void {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private peerList(): PeerInfo[] {
    return [...this.peers.values()]
      .map((peer) => ({
        id: peer.id,
        name: peer.id === this.localId ? `${peer.name} (you)` : peer.name,
        latency: peer.latency,
        isHost: peer.isHost,
      }))
      .sort((a, b) => Number(b.isHost) - Number(a.isHost));
  }

  private emitState(): void {
    this.callbacks.onStateChanged(this.getState());
  }
}
