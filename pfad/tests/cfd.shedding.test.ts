import { describe, expect, it } from 'vitest';
import { analyseShedding } from '../src/cfd/Shedding';

const series = (n: number, dt: number, f: (t: number) => number) => Array.from({ length: n }, (_, i) => f(i * dt));

describe('vortex shedding from the lift', () => {
  it('finds the period of a regular oscillation, and the Strouhal numbers from it', () => {
    // lift = 0.8 + 0.4 sin(2π t / 5): period 5 flow-throughs, Strouhal number 0.2
    const s = analyseShedding(series(1000, 0.025, (t) => 0.8 + 0.4 * Math.sin((2 * Math.PI * t) / 5)), 0.025, 0.4);
    expect(s.strouhal!).toBeCloseTo(0.2, 2);
    expect(s.period!).toBeCloseTo(5, 1);
    expect(s.strouhalHeight!).toBeCloseTo(0.08, 2);
    expect(s.amplitude).toBeCloseTo(0.4, 2);
    expect(s.meanLift).toBeCloseTo(0.8, 2);
    expect(s.cycles).toBeGreaterThanOrEqual(3);
    expect(s.irregularity!).toBeLessThan(0.02);
  });
  it('is not fooled by a little noise', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    const s = analyseShedding(series(1200, 0.02, (t) => 0.3 * Math.sin((2 * Math.PI * t) / 4) + 0.05 * rnd()), 0.02, 0.5);
    expect(s.strouhal!).toBeCloseTo(0.25, 1);
  });
  it('a steady lift has no shedding', () => {
    const s = analyseShedding(series(500, 0.05, () => 1.2), 0.05, 0.4);
    expect(s.strouhal).toBeNull();
    expect(s.note).toMatch(/steady/);
    const noisy = analyseShedding(series(500, 0.05, (t) => 1.2 + 1e-4 * Math.sin(40 * t)), 0.05, 0.4);
    expect(noisy.strouhal).toBeNull();
  });
  it('fewer than two cycles in the window gives no frequency', () => {
    const s = analyseShedding(series(400, 0.05, (t) => 0.5 * Math.sin((2 * Math.PI * t) / 15)), 0.05, 0.4);
    expect(s.strouhal).toBeNull();
    expect(s.note).toMatch(/fewer than 2 complete cycles/);
  });
  it('an irregular oscillation has no single frequency', () => {
    // two frequencies of similar size beating against each other
    const s = analyseShedding(series(1500, 0.02, (t) => 0.3 * Math.sin(2 * Math.PI * t * 0.2) + 0.28 * Math.sin(2 * Math.PI * t * 0.37)), 0.02, 0.4);
    expect(s.strouhal).toBeNull();
    expect(s.irregularity!).toBeGreaterThan(0.35);
  });
  it('an oscillation far faster than a vortex street is sound waves, not shedding', () => {
    // a period of 0.38 flow-throughs on a body 0.45 plate lengths high: f h / U = 1.2
    const s = analyseShedding(series(800, 0.02, (t) => 0.5 * Math.sin((2 * Math.PI * t) / 0.38)), 0.02, 0.45);
    expect(s.strouhal).toBeNull();
    expect(s.note).toMatch(/sound waves/);
  });
  it('too few samples are refused', () => {
    expect(analyseShedding([1, 2, 3], 0.1, 0.4).note).toMatch(/too few/);
  });
});
