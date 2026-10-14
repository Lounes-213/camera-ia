/**
 * StateSync tests — hostile-input validation, clamping, last-writer-wins merge
 * and remote transform interpolation.
 */
import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  deserialize,
  generateRoomCode,
  interpolateTransform,
  isNewer,
  normalizeRoomCode,
  serialize,
  validateMessage,
} from '../src/core/network/StateSync';
import type { MaterialState, TransformState } from '../src/app/state';

const transform = (overrides: Partial<TransformState> = {}): TransformState => ({
  autoRotate: true,
  spinSpeed: 1,
  scale: 1,
  height: 0.28,
  rotation: { x: 0, y: 0, z: 0 },
  ...overrides,
});

describe('message validation', () => {
  it('accepts a well-formed transform message', () => {
    const message = validateMessage({
      t: 'transform',
      v: PROTOCOL_VERSION,
      from: 'peer-a',
      seq: 3,
      ts: 1700000000000,
      patch: { scale: 1.4 },
    });
    expect(message).not.toBeNull();
    expect(message && message.t === 'transform' && message.patch.scale).toBe(1.4);
  });

  it('rejects an unknown message type', () => {
    expect(validateMessage({ t: 'eval', v: PROTOCOL_VERSION })).toBeNull();
  });

  it('rejects a wrong protocol version', () => {
    expect(validateMessage({ t: 'ping', v: 999, from: 'a', ts: 1 })).toBeNull();
  });

  it('rejects non-objects, null and strings', () => {
    expect(validateMessage(null)).toBeNull();
    expect(validateMessage('{"t":"ping"}')).toBeNull();
    expect(validateMessage(42)).toBeNull();
  });

  it('clamps out-of-range transform values', () => {
    const message = validateMessage({
      t: 'transform',
      v: PROTOCOL_VERSION,
      from: 'a',
      seq: 1,
      ts: 1,
      patch: { scale: 900, height: -50, spinSpeed: 99, rotation: { x: 1e9, y: 0, z: 0 } },
    });
    if (message?.t !== 'transform') throw new Error('expected a transform message');
    expect(message.patch.scale).toBe(3.5);
    expect(message.patch.height).toBe(-0.4);
    expect(message.patch.spinSpeed).toBe(4);
    expect(message.patch.rotation?.x).toBeLessThanOrEqual(Math.PI * 4);
  });

  it('drops unknown material keys and invalid colours', () => {
    const message = validateMessage({
      t: 'material',
      v: PROTOCOL_VERSION,
      from: 'a',
      seq: 1,
      ts: 1,
      patch: { color: 'javascript:alert(1)', metalness: 5, __proto__: 'polluted' },
    });
    if (message?.t !== 'material') throw new Error('expected a material message');
    expect(message.patch.color).toBeUndefined();
    expect(message.patch.metalness).toBe(1);
    expect(Object.keys(message.patch)).not.toContain('__proto__');
  });

  it('refuses model references with unsafe download URLs', () => {
    const message = validateMessage({
      t: 'object',
      v: PROTOCOL_VERSION,
      from: 'a',
      seq: 1,
      ts: 1,
      objectId: 'x',
      modelRef: {
        provider: 'evil',
        id: 'x',
        downloadUrl: 'javascript:alert(1)',
        title: 'x',
        author: 'x',
        license: 'CC0',
        sourceUrl: '',
      },
    });
    if (message?.t !== 'object') throw new Error('expected an object message');
    expect(message.modelRef).toBeNull();
  });

  it('truncates over-long names and strips control characters', () => {
    const message = validateMessage({
      t: 'cursor',
      v: PROTOCOL_VERSION,
      from: 'a',
      name: `evil\u0000name${'x'.repeat(200)}`,
      x: 5,
      y: -3,
      active: true,
    });
    if (message?.t !== 'cursor') throw new Error('expected a cursor message');
    expect(message.name.length).toBeLessThanOrEqual(24);
    expect(message.name).not.toContain('\u0000');
    expect(message.x).toBe(1);
    expect(message.y).toBe(0);
  });

  it('round-trips through serialize/deserialize', () => {
    const raw = serialize({ t: 'ping', v: PROTOCOL_VERSION, from: 'a', ts: 42 });
    expect(raw).not.toBeNull();
    expect(deserialize(raw)).toEqual({ t: 'ping', v: PROTOCOL_VERSION, from: 'a', ts: 42 });
  });

  it('refuses oversized payloads', () => {
    const huge = serialize({
      t: 'reaction',
      v: PROTOCOL_VERSION,
      from: 'a',
      name: 'a',
      emoji: 'x'.repeat(9000),
    });
    expect(huge).toBeNull();
  });
});

describe('last-writer-wins', () => {
  it('prefers the newer timestamp', () => {
    expect(isNewer({ ts: 200, seq: 1 }, { ts: 100, seq: 5 })).toBe(true);
    expect(isNewer({ ts: 100, seq: 5 }, { ts: 200, seq: 1 })).toBe(false);
  });

  it('breaks ties with the sequence number', () => {
    expect(isNewer({ ts: 100, seq: 6 }, { ts: 100, seq: 5 })).toBe(true);
    expect(isNewer({ ts: 100, seq: 5 }, { ts: 100, seq: 6 })).toBe(false);
  });

  it('is not fooled by an equal message', () => {
    expect(isNewer({ ts: 100, seq: 5 }, { ts: 100, seq: 5 })).toBe(false);
  });
});

describe('interpolateTransform', () => {
  it('moves the current transform towards the target', () => {
    const current = transform({ scale: 1, height: 0 });
    const blended = interpolateTransform(current, { scale: 2, height: 1 }, 0.5);
    expect(blended.scale).toBeCloseTo(1.5, 5);
    expect(blended.height).toBeCloseTo(0.5, 5);
  });

  it('keeps untouched fields', () => {
    const current = transform({ spinSpeed: 2 });
    const blended = interpolateTransform(current, { scale: 1.5 }, 0.4);
    expect(blended.spinSpeed).toBe(2);
    expect(blended.autoRotate).toBe(true);
  });

  it('snaps at alpha 1', () => {
    const blended = interpolateTransform(transform(), { rotation: { x: 1, y: 2, z: 3 } }, 1);
    expect(blended.rotation).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe('room codes', () => {
  it('generates 5-character codes from an unambiguous alphabet', () => {
    const code = generateRoomCode(() => 0.42);
    expect(code).toHaveLength(5);
    expect(code).toMatch(/^[A-Z0-9]{5}$/);
    expect(code).not.toMatch(/[IO01]/);
  });

  it('normalises user input', () => {
    expect(normalizeRoomCode(' ab-12c ')).toBe('AB12C');
    expect(normalizeRoomCode('ab12')).toBeNull();
    expect(normalizeRoomCode('')).toBeNull();
  });
});

describe('material snapshot typing', () => {
  it('fills defaults for a partial snapshot', () => {
    const message = validateMessage({
      t: 'welcome',
      v: PROTOCOL_VERSION,
      hostId: 'host',
      snapshot: {
        objectId: 'torusKnot',
        modelRef: null,
        material: { color: '#FF7A00' } as Partial<MaterialState>,
        transform: { scale: 2 } as Partial<TransformState>,
        ts: 1,
        seq: 1,
      },
    });
    if (message?.t !== 'welcome') throw new Error('expected a welcome message');
    expect(message.snapshot.material.metalness).toBeCloseTo(0.45, 5);
    expect(message.snapshot.transform.scale).toBe(2);
    expect(message.snapshot.transform.rotation).toEqual({ x: 0, y: 0, z: 0 });
  });
});
