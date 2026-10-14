/**
 * PeerTransport — a thin, forgiving wrapper around PeerJS.
 *
 * Topology is a star: the host owns the deterministic peer id
 * `webar-<CODE>` and relays messages between guests. Signalling uses the free
 * PeerJS public cloud by default, but `CONFIG.room.peerHost` lets you point at a
 * self-hosted PeerServer without touching this file.
 *
 * Nothing here knows about the app: it just moves opaque, already-validated
 * payloads between peers.
 */
import Peer, { type DataConnection } from 'peerjs';
import { CONFIG } from '../../app/config';

export interface PeerTransportOptions {
  roomCode: string;
  isHost: boolean;
  onData: (from: string, data: unknown) => void;
  onOpen: () => void;
  onConnectionOpen: (peerId: string) => void;
  onConnectionClose: (peerId: string) => void;
  onError: (message: string) => void;
  onReconnecting: () => void;
  onRestored: () => void;
}

/** Deterministic id for a room's host peer. */
export function hostPeerId(code: string): string {
  return `webar-room-${code.toUpperCase()}`;
}

const MAX_RECONNECT_DELAY = 8000;

export class PeerTransport {
  private peer: Peer | null = null;
  private readonly connections = new Map<string, DataConnection>();
  private destroyed = false;
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private hostId: string;
  private localId = '';

  constructor(private readonly options: PeerTransportOptions) {
    this.hostId = hostPeerId(options.roomCode);
  }

  /** This peer's own id (empty until the signalling socket opens). */
  get id(): string {
    return this.localId;
  }

  /** True while the signalling socket is open. */
  get isOpen(): boolean {
    return this.peer?.open ?? false;
  }

  /** Connected peer ids. */
  connectedPeers(): string[] {
    return [...this.connections.keys()];
  }

  /** Opens the connection to the signalling server and, for guests, the host. */
  connect(): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('destroyed'));
    return new Promise((resolve, reject) => {
      const iceServers = this.iceServers();
      const peerOptions = CONFIG.room.peerHost
        ? {
            host: CONFIG.room.peerHost,
            port: CONFIG.room.peerPort,
            path: CONFIG.room.peerPath,
            secure: CONFIG.room.peerSecure,
            key: CONFIG.room.peerKey,
            config: { iceServers },
          }
        : { config: { iceServers } };

      const peer = this.options.isHost
        ? new Peer(this.hostId, peerOptions)
        : new Peer(peerOptions);

      this.peer = peer;

      peer.on('open', (id) => {
        this.localId = id;
        this.attempt = 0;
        this.options.onOpen();
        if (!this.options.isHost) this.openHostConnection(resolve);
        else resolve();
      });

      peer.on('connection', (connection) => this.bindConnection(connection));

      peer.on('disconnected', () => {
        if (this.destroyed) return;
        // Signalling dropped but media/data may still flow: try to come back.
        this.options.onReconnecting();
        this.scheduleReconnect();
      });

      peer.on('close', () => {
        if (this.destroyed) return;
        this.options.onReconnecting();
        this.scheduleReconnect();
      });

      peer.on('error', (error) => {
        const type = (error as unknown as { type?: string }).type ?? 'unknown';
        if (type === 'peer-unavailable') {
          // The host is not there (yet) — retry rather than failing hard.
          this.options.onReconnecting();
          this.scheduleReconnect();
          return;
        }
        if (type === 'unavailable-id') {
          // Our chosen room id is taken: someone still holds it.
          reject(new Error('room-id-taken'));
          return;
        }
        if (type === 'network' || type === 'server-error' || type === 'socket-error') {
          this.options.onReconnecting();
          this.scheduleReconnect();
          return;
        }
        this.options.onError(type);
        if (this.attempt === 0) reject(error instanceof Error ? error : new Error(type));
      });
    });
  }

  /** Sends to one peer, or broadcasts to everyone when `to` is '*'. */
  send(to: string, data: unknown): boolean {
    if (to === '*') return this.broadcast(data);
    const connection = this.connections.get(to);
    if (!connection?.open) return false;
    try {
      connection.send(data);
      return true;
    } catch {
      return false;
    }
  }

  /** Sends to every connected peer. */
  broadcast(data: unknown): boolean {
    let sent = false;
    for (const connection of this.connections.values()) {
      if (!connection.open) continue;
      try {
        connection.send(data);
        sent = true;
      } catch {
        /* skip this peer */
      }
    }
    return sent;
  }

  /** Closes all data connections but keeps the signalling socket. */
  closeConnections(): void {
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
  }

  /** Full teardown. */
  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.closeConnections();
    try {
      this.peer?.destroy();
    } catch {
      /* already gone */
    }
    this.peer = null;
  }

  private openHostConnection(resolve: () => void): void {
    const hostId = this.hostId;
    this.connectToHost(hostId, resolve);
  }

  private connectToHost(hostId: string, resolve?: () => void): void {
    const peer = this.peer;
    if (!peer) return;
    const connection = peer.connect(hostId, { reliable: true, serialization: 'json' });
    connection.on('open', () => {
      resolve?.();
    });
    this.bindConnection(connection);
  }

  private bindConnection(connection: DataConnection): void {
    connection.on('open', () => {
      this.connections.set(connection.peer, connection);
      this.options.onConnectionOpen(connection.peer);
    });
    connection.on('data', (data) => {
      this.options.onData(connection.peer, data);
    });
    connection.on('close', () => {
      this.connections.delete(connection.peer);
      this.options.onConnectionClose(connection.peer);
    });
    connection.on('error', () => {
      this.connections.delete(connection.peer);
      this.options.onConnectionClose(connection.peer);
    });
  }

  /** Exponential backoff with jitter, capped at 8 s. */
  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer !== null) return;
    const delay = Math.min(MAX_RECONNECT_DELAY, 600 * 2 ** this.attempt) + Math.random() * 400;
    this.attempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnect();
    }, delay);
  }

  private reconnect(): void {
    if (this.destroyed) return;
    const peer = this.peer;
    if (!peer) return;

    if (peer.disconnected && !peer.destroyed) {
      try {
        peer.reconnect();
        this.options.onRestored();
        return;
      } catch {
        /* fall through to rebuild */
      }
    }
    if (peer.destroyed) {
      // Rebuild the socket from scratch, then re-attach to the host.
      this.peer = null;
      this.connect().catch(() => this.scheduleReconnect());
    }
  }

  private iceServers(): RTCIceServer[] {
    const servers: RTCIceServer[] = [...CONFIG.room.iceServers];
    if (CONFIG.room.turnUrl) {
      servers.push({
        urls: CONFIG.room.turnUrl,
        username: CONFIG.room.turnUser || undefined,
        credential: CONFIG.room.turnCredential || undefined,
      });
    }
    return servers;
  }
}
