/**
 * Math utility tests, focused on the One-Euro filter (the anti-jitter core of
 * both hand tracking and the found/lost fade).
 */
import { describe, expect, it } from 'vitest';
import {
  OneEuroFilter,
  OneEuroVec3,
  average,
  clamp,
  damp,
  distance2,
  inverseLerp,
  lerp,
  lerpAngle,
  normalizeAngle,
  smoothstep,
} from '../src/utils/math';

describe('scalar helpers', () => {
  it('clamps, lerps and inverts ranges', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(inverseLerp(0, 10, 5)).toBe(0.5);
    expect(inverseLerp(0, 0, 5)).toBe(0);
  });

  it('smoothsteps between 0 and 1', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 6);
  });

  it('averages and measures distances', () => {
    expect(average([1, 2, 3])).toBe(2);
    expect(average([])).toBe(0);
    expect(distance2(0, 0, 3, 4)).toBe(5);
  });

  it('normalises angles into (-pi, pi]', () => {
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    expect(lerpAngle(0.1, Math.PI * 2 + 0.2, 1)).toBeCloseTo(0.2, 6);
  });
});

describe('damp', () => {
  it('is frame-rate independent', () => {
    const sixty = damp(0, 1, 10, 1 / 60);
    const thirty = damp(0, 1, 10, 1 / 30);
    // Two 1/60 steps should land near one 1/30 step.
    expect(damp(0, 1, 10, 2 / 60)).toBeCloseTo(thirty, 6);
    expect(thirty).toBeGreaterThan(sixty);
  });

  it('converges to the target', () => {
    let value = 0;
    for (let i = 0; i < 200; i += 1) value = damp(value, 5, 12, 1 / 60);
    expect(value).toBeCloseTo(5, 3);
  });
});

describe('OneEuroFilter', () => {
  it('passes the first sample through unchanged', () => {
    const filter = new OneEuroFilter();
    expect(filter.filter(10, 0)).toBe(10);
  });

  it('smooths a noisy constant signal', () => {
    const filter = new OneEuroFilter(1, 0);
    let value = 0;
    for (let i = 0; i < 120; i += 1) {
      const noisy = 1 + (i % 2 === 0 ? 0.4 : -0.4);
      value = filter.filter(noisy, i * 16);
    }
    // The jitter must be largely gone while staying near the true value.
    expect(Math.abs(value - 1)).toBeLessThan(0.4);
  });

  it('tracks a moving target with bounded lag', () => {
    const filter = new OneEuroFilter(2, 0.05);
    let value = 0;
    for (let i = 0; i < 200; i += 1) {
      value = filter.filter(i * 0.1, i * 16);
    }
    expect(value).toBeGreaterThan(15);
    expect(value).toBeLessThan(20);
  });

  it('ignores non-positive time steps instead of exploding', () => {
    const filter = new OneEuroFilter();
    filter.filter(1, 100);
    expect(filter.filter(5, 100)).toBeCloseTo(1, 6);
    expect(filter.filter(5, 50)).toBeCloseTo(1, 6);
  });

  it('reset() forgets its history', () => {
    const filter = new OneEuroFilter();
    filter.filter(100, 0);
    filter.reset();
    expect(filter.filter(3, 1000)).toBe(3);
  });
});

describe('OneEuroVec3', () => {
  it('filters each axis independently', () => {
    const filter = new OneEuroVec3(1, 0);
    expect(filter.filter(1, 2, 3, 0)).toEqual([1, 2, 3]);
    const [x, y, z] = filter.filter(2, 3, 4, 16);
    expect(x).toBeGreaterThan(1);
    expect(y).toBeGreaterThan(2);
    expect(z).toBeGreaterThan(3);
  });

  it('reset() clears every axis', () => {
    const filter = new OneEuroVec3();
    filter.filter(9, 9, 9, 0);
    filter.reset();
    expect(filter.filter(1, 1, 1, 100)).toEqual([1, 1, 1]);
  });
});
