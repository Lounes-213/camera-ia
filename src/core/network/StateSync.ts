/**
 * StateSync — the shared-room protocol.
 *
 * Only *state* crosses the wire: never video, never audio. Messages are small,
 * versioned JSON objects. Every inbound message is treated as hostile: it is
 * parsed defensively, schema-checked, size-limited and range-clamped before it
 * can touch the store.
 *
 * Transforms follow last-writer-wins using a `(ts, seq)` pair so two peers
 * rotating at once converge without a server.
 */
import type { MaterialState, ModelMeta, TransformState } from '../../app/state';
import { clamp } from '../../utils/math';

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 8 * 1024;
export const MAX_NAME_LENGTH = 24;
export const MAX_EMOJI_LENGTH = 8;

/** A model referenced by id so peers download it themselves. */
export interface ModelRef {
  provider: string;
  id: string;
  downloadUrl: string;
  title: string;
  author: string;
  license: string;
  sourceUrl: string;
  thumbnail?: string;
  meta?: ModelMeta;
}

export interface SharedSnapshot {
  objectId: string;
  modelRef: ModelRef | null;
  material: MaterialState;
  transform: TransformState;
  ts: number;
  seq: number;
}

export type SyncMessage =
  | { t: 'hello'; v: number; peerId: string; name: string; joinedAt: number }
  | { t: 'welcome'; v: number; hostId: string; snapshot: SharedSnapshot }
  | { t: 'snapshot'; v: number; snapshot: SharedSnapshot; from: string }
  | {
      t: 'object';
      v: number;
      from: string;
      seq: number;
      ts: number;
      objectId: string;
      modelRef: ModelRef | null;
    }
  | {
      t: 'material';
      v: number;
      from: string;
      seq: number;
      ts: number;
      patch: Partial<MaterialState>;
    }
  | {
      t: 'transform';
      v: number;
      from: string;
      seq: number;
      ts: number;
      patch: Partial<TransformState>;
    }
  | { t: 'cursor'; v: number; from: string; name: string; x: number; y: number; active: boolean }
  | { t: 'reaction'; v: number; from: string; name: string; emoji: string }
  | { t: 'control'; v: number; from: string; holder: string | null }
  | {
      t: 'peers';
      v: number;
      from: string;
      peers: { id: string; name: string; isHost: boolean }[];
    }
  | { t: 'ping'; v: number; from: string; ts: number }
  | { t: 'pong'; v: number; from: string; ts: number }
  | { t: 'bye'; v: number; from: string; peerId: string };

export type SyncMessageType = SyncMessage['t'];

const TYPES: readonly SyncMessageType[] = [
  'hello',
  'welcome',
  'snapshot',
  'object',
  'material',
  'transform',
  'cursor',
  'reaction',
  'control',
  'peers',
  'ping',
  'pong',
  'bye',
];

/** Serialises a message, refusing anything oversized. */
export function serialize(message: SyncMessage): string | null {
  const json = JSON.stringify(message);
  if (json.length > MAX_MESSAGE_BYTES) return null;
  return json;
}

/** Parses and validates an inbound payload. Returns null when it is not safe. */
export function deserialize(raw: unknown): SyncMessage | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_MESSAGE_BYTES) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return validateMessage(value);
}

/** Structural validation + range clamping. Never throws. */
export function validateMessage(value: unknown): SyncMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  const type = message.t;
  if (typeof type !== 'string' || !TYPES.includes(type as SyncMessageType)) return null;
  if (message.v !== PROTOCOL_VERSION) return null;
  if (typeof message.from === 'string' && message.from.length > 64) return null;

  switch (type as SyncMessageType) {
    case 'hello':
      return {
        t: 'hello',
        v: PROTOCOL_VERSION,
        peerId: safeString(message.peerId, 64),
        name: safeString(message.name, MAX_NAME_LENGTH) || 'Guest',
        joinedAt: safeNumber(message.joinedAt, Date.now()),
      };
    case 'welcome':
    case 'snapshot': {
      const snapshot = validateSnapshot(message.snapshot);
      if (!snapshot) return null;
      if (type === 'welcome') {
        return { t: 'welcome', v: PROTOCOL_VERSION, hostId: safeString(message.hostId, 64), snapshot };
      }
      return { t: 'snapshot', v: PROTOCOL_VERSION, snapshot, from: safeString(message.from, 64) };
    }
    case 'object': {
      const modelRef = validateModelRef(message.modelRef);
      const objectId = safeString(message.objectId, 64);
      if (!objectId) return null;
      return {
        t: 'object',
        v: PROTOCOL_VERSION,
        from: safeString(message.from, 64),
        seq: safeNumber(message.seq, 0),
        ts: safeNumber(message.ts, Date.now()),
        objectId,
        modelRef,
      };
    }
    case 'material':
      return {
        t: 'material',
        v: PROTOCOL_VERSION,
        from: safeString(message.from, 64),
        seq: safeNumber(message.seq, 0),
        ts: safeNumber(message.ts, Date.now()),
        patch: clampMaterialPatch(message.patch),
      };
    case 'transform':
      return {
        t: 'transform',
        v: PROTOCOL_VERSION,
        from: safeString(message.from, 64),
        seq: safeNumber(message.seq, 0),
        ts: safeNumber(message.ts, Date.now()),
        patch: clampTransformPatch(message.patch),
      };
    case 'cursor':
      return {
        t: 'cursor',
        v: PROTOCOL_VERSION,
        from: safeString(message.from, 64),
        name: safeString(message.name, MAX_NAME_LENGTH) || 'Guest',
        x: clamp(safeNumber(message.x, 0.5), 0, 1),
        y: clamp(safeNumber(message.y, 0.5), 0, 1),
        active: message.active !== false,
      };
    case 'reaction': {
      const emoji = safeString(message.emoji, MAX_EMOJI_LENGTH);
      if (!emoji) return null;
      return {
        t: 'reaction',
        v: PROTOCOL_VERSION,
        from: safeString(message.from, 64),
        name: safeString(message.name, MAX_NAME_LENGTH) || 'Guest',
        emoji,
      };
    }
    case 'control':
      return {
        t: 'control',
        v: PROTOCOL_VERSION,
        from: safeString(message.from, 64),
        holder: message.holder === null ? null : safeString(message.holder, 64) || null,
      };
    case 'peers': {
      const raw = Array.isArray(message.peers) ? message.peers : [];
      const peers = raw.slice(0, 16).map((entry) => {
        const peer = (entry ?? {}) as Record<string, unknown>;
        return {
          id: safeString(peer.id, 64),
          name: safeString(peer.name, MAX_NAME_LENGTH) || 'Guest',
          isHost: peer.isHost === true,
        };
      });
      return { t: 'peers', v: PROTOCOL_VERSION, from: safeString(message.from, 64), peers };
    }
    case 'ping':
      return {
        t: 'ping',
        v: PROTOCOL_VERSION,
        from: safeString(message.from, 64),
        ts: safeNumber(message.ts, Date.now()),
      };
    case 'pong':
      return {
        t: 'pong',
        v: PROTOCOL_VERSION,
        from: safeString(message.from, 64),
        ts: safeNumber(message.ts, Date.now()),
      };
    case 'bye':
      return {
        t: 'bye',
        v: PROTOCOL_VERSION,
        from: safeString(message.from, 64),
        peerId: safeString(message.peerId, 64),
      };
    default:
      return null;
  }
}

function validateSnapshot(value: unknown): SharedSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Record<string, unknown>;
  const objectId = safeString(snapshot.objectId, 64);
  if (!objectId) return null;
  const material = clampMaterialPatch(snapshot.material);
  const transform = clampTransformPatch(snapshot.transform);
  return {
    objectId,
    modelRef: validateModelRef(snapshot.modelRef),
    material: fillMaterial(material),
    transform: fillTransform(transform),
    ts: safeNumber(snapshot.ts, Date.now()),
    seq: safeNumber(snapshot.seq, 0),
  };
}

function validateModelRef(value: unknown): ModelRef | null {
  if (!value || typeof value !== 'object') return null;
  const ref = value as Record<string, unknown>;
  const downloadUrl = safeString(ref.downloadUrl, 2048);
  const id = safeString(ref.id, 128);
  if (!downloadUrl || !id) return null;
  // Only http(s) downloads: blocks javascript:/data: smuggling.
  if (!/^https?:\/\//i.test(downloadUrl) && !/^[\w./-]+$/.test(downloadUrl)) return null;
  return {
    provider: safeString(ref.provider, 48) || 'unknown',
    id,
    downloadUrl,
    title: safeString(ref.title, 120) || 'Model',
    author: safeString(ref.author, 120) || 'Unknown',
    license: safeString(ref.license, 40) || 'unknown',
    sourceUrl: safeString(ref.sourceUrl, 2048),
    thumbnail: safeString(ref.thumbnail ?? '', 2048) || undefined,
  };
}

/** Clamps a material patch to sane ranges (drops unknown keys). */
export function clampMaterialPatch(value: unknown): Partial<MaterialState> {
  if (!value || typeof value !== 'object') return {};
  const patch = value as Record<string, unknown>;
  const out: Partial<MaterialState> = {};
  if (typeof patch.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(patch.color)) {
    out.color = patch.color;
  }
  if (typeof patch.metalness === 'number') out.metalness = clamp(patch.metalness, 0, 1);
  if (typeof patch.roughness === 'number') out.roughness = clamp(patch.roughness, 0, 1);
  if (typeof patch.glow === 'boolean') out.glow = patch.glow;
  if (typeof patch.glowStrength === 'number') out.glowStrength = clamp(patch.glowStrength, 0, 2);
  if (typeof patch.emissiveIntensity === 'number') {
    out.emissiveIntensity = clamp(patch.emissiveIntensity, 0, 2);
  }
  if (typeof patch.lightIntensity === 'number') {
    out.lightIntensity = clamp(patch.lightIntensity, 0, 2);
  }
  if (typeof patch.contactShadow === 'boolean') out.contactShadow = patch.contactShadow;
  if (typeof patch.animation === 'boolean') out.animation = patch.animation;
  if (typeof patch.wireframe === 'boolean') out.wireframe = patch.wireframe;
  return out;
}

/** Clamps a transform patch to sane ranges (drops unknown keys). */
export function clampTransformPatch(value: unknown): Partial<TransformState> {
  if (!value || typeof value !== 'object') return {};
  const patch = value as Record<string, unknown>;
  const out: Partial<TransformState> = {};
  if (typeof patch.autoRotate === 'boolean') out.autoRotate = patch.autoRotate;
  if (typeof patch.spinSpeed === 'number') out.spinSpeed = clamp(patch.spinSpeed, 0, 4);
  if (typeof patch.scale === 'number') out.scale = clamp(patch.scale, 0.15, 3.5);
  if (typeof patch.height === 'number') out.height = clamp(patch.height, -0.4, 2.5);
  const rotation = patch.rotation as Record<string, unknown> | undefined;
  if (rotation && typeof rotation === 'object') {
    const x = safeNumber(rotation.x, 0);
    const y = safeNumber(rotation.y, 0);
    const z = safeNumber(rotation.z, 0);
    out.rotation = {
      x: clamp(x, -Math.PI * 4, Math.PI * 4),
      y: clamp(y, -Math.PI * 4, Math.PI * 4),
      z: clamp(z, -Math.PI * 4, Math.PI * 4),
    };
  }
  return out;
}

function fillMaterial(patch: Partial<MaterialState>): MaterialState {
  return {
    color: patch.color ?? '#FF7A00',
    metalness: patch.metalness ?? 0.45,
    roughness: patch.roughness ?? 0.28,
    glow: patch.glow ?? true,
    glowStrength: patch.glowStrength ?? 1.1,
    emissiveIntensity: patch.emissiveIntensity ?? 0.9,
    lightIntensity: patch.lightIntensity ?? 1,
    contactShadow: patch.contactShadow ?? true,
    animation: patch.animation ?? true,
    wireframe: patch.wireframe ?? false,
  };
}

function fillTransform(patch: Partial<TransformState>): TransformState {
  return {
    autoRotate: patch.autoRotate ?? true,
    spinSpeed: patch.spinSpeed ?? 1,
    scale: patch.scale ?? 1,
    height: patch.height ?? 0.28,
    rotation: patch.rotation ?? { x: 0, y: 0, z: 0 },
  };
}

/**
 * Last-writer-wins decision for a `(ts, seq)` stamped update.
 * Ties are broken by sequence number so identical clocks still converge.
 */
export function isNewer(
  incoming: { ts: number; seq: number },
  current: { ts: number; seq: number },
): boolean {
  if (incoming.ts !== current.ts) return incoming.ts > current.ts;
  return incoming.seq > current.seq;
}

/** Frame-rate independent smoothing factor used to blend remote transforms. */
export function blendAlpha(dt: number, halfLife = 0.09): number {
  if (dt <= 0) return 1;
  return 1 - Math.pow(0.5, dt / halfLife);
}

/** Interpolates a transform towards a remote target. */
export function interpolateTransform(
  current: TransformState,
  target: Partial<TransformState>,
  alpha: number,
): TransformState {
  const lerp = (a: number, b: number): number => a + (b - a) * alpha;
  const rotation = current.rotation;
  const targetRotation = target.rotation;
  return {
    autoRotate: target.autoRotate ?? current.autoRotate,
    spinSpeed: target.spinSpeed ?? current.spinSpeed,
    scale: target.scale !== undefined ? lerp(current.scale, target.scale) : current.scale,
    height: target.height !== undefined ? lerp(current.height, target.height) : current.height,
    rotation: targetRotation
      ? {
          x: lerp(rotation.x, targetRotation.x),
          y: lerp(rotation.y, targetRotation.y),
          z: lerp(rotation.z, targetRotation.z),
        }
      : rotation,
  };
}

/** Generates a random, human-friendly 5-character room code (no vowels). */
export function generateRoomCode(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    code += alphabet[Math.floor(random() * alphabet.length)] ?? 'A';
  }
  return code;
}

/** Validates a user-entered room code. */
export function normalizeRoomCode(input: string): string | null {
  const code = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{5}$/.test(code) ? code : null;
}

function safeString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // Deliberately matches control characters: they are stripped so a hostile peer
  // cannot inject terminal escapes or log-breaking sequences into our UI.
  // eslint-disable-next-line no-control-regex
  const controlChars = /[\u0000-\u001f\u007f]/g;
  return value.replace(controlChars, '').slice(0, max);
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
