/**
 * ModelNormalizer tests — the pure fitting maths plus the in-place
 * normalisation applied to a real Three.js object.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  baseOffsetFor,
  countTriangles,
  fitScaleFor,
  normalizeModel,
} from '../src/core/search/ModelNormalizer';

describe('fitScaleFor', () => {
  it('scales the longest edge to the target size', () => {
    expect(fitScaleFor(2, 1, 1, 1)).toBeCloseTo(0.5, 6);
    expect(fitScaleFor(10, 20, 5, 1)).toBeCloseTo(0.05, 6);
  });

  it('is safe for degenerate sizes', () => {
    expect(fitScaleFor(0, 0, 0, 1)).toBe(1);
    expect(fitScaleFor(Number.NaN, 1, 1, 1)).toBe(1);
  });

  it('respects a custom target size', () => {
    expect(fitScaleFor(4, 1, 1, 2)).toBeCloseTo(0.5, 6);
  });
});

describe('baseOffsetFor', () => {
  it('centres on X/Z and puts the base on y = 0', () => {
    const offset = baseOffsetFor({ x: -1, y: -2, z: -3 }, { x: 1, y: 4, z: 5 }, 0.5);
    expect(offset.x).toBeCloseTo(0, 6);
    expect(offset.z).toBeCloseTo(-1 * 0.5, 6);
    expect(offset.y).toBeCloseTo(1, 6);
  });

  it('handles an already centred model', () => {
    const offset = baseOffsetFor({ x: -1, y: 0, z: -1 }, { x: 1, y: 2, z: 1 }, 1);
    expect(offset.x).toBeCloseTo(0, 6);
    expect(offset.y).toBeCloseTo(0, 6);
    expect(offset.z).toBeCloseTo(0, 6);
  });
});

describe('countTriangles', () => {
  it('counts indexed geometry triangles', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    expect(countTriangles(mesh)).toBe(12);
  });

  it('sums a whole subtree', () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    group.add(new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6)));
    expect(countTriangles(group)).toBeGreaterThan(12);
  });
});

describe('normalizeModel', () => {
  it('scales, centres and grounds the model inside a 1-unit box', () => {
    const model = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 2));
    const report = normalizeModel(model);

    expect(report.pivot).toBeDefined();
    const box = new THREE.Box3().setFromObject(report.pivot);
    const size = box.getSize(new THREE.Vector3());

    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(1, 4);
    expect(box.min.y).toBeCloseTo(0, 4);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 4);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 4);
  });

  it('honours a custom target size', () => {
    const model = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 2));
    const report = normalizeModel(model, { targetSize: 2 });
    const size = new THREE.Box3().setFromObject(report.pivot).getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(2, 4);
  });

  it('rejects models above the triangle budget', () => {
    const dense = new THREE.Mesh(new THREE.SphereGeometry(1, 200, 200));
    expect(() => normalizeModel(dense, { maxTriangles: 1000 })).toThrow(/model-too-large/);
  });

  it('flags an aggressive downscale', () => {
    const huge = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100));
    const report = normalizeModel(huge);
    expect(report.downscaled).toBe(true);
    expect(report.scale).toBeLessThan(0.5);
  });

  it('disables shadow casting for AR performance', () => {
    const model = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    model.castShadow = true;
    normalizeModel(model);
    expect(model.castShadow).toBe(false);
  });
});
