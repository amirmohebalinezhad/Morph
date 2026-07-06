import { describe, expect, it } from 'vitest';
import { genId } from '../../src/shared/ids';

describe('genId', () => {
  it('respects the prefix', () => {
    expect(genId('rev')).toMatch(/^rev_/);
  });

  it('never collides across many calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(genId('x'));
    expect(seen.size).toBe(10_000);
  });
});
