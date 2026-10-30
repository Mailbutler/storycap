import { describe, expect, it } from '@jest/globals';
import { areLastBuffersEqual } from './stable-screenshot';

describe(areLastBuffersEqual, () => {
  const a = Buffer.from('a');
  const b = Buffer.from('b');

  it('needs at least as many buffers as matches', () => {
    expect(areLastBuffersEqual([a, Buffer.from('a')], 3)).toBe(false);
    expect(areLastBuffersEqual([a, Buffer.from('a'), Buffer.from('a')], 3)).toBe(true);
  });

  it('compares only the last buffers', () => {
    expect(areLastBuffersEqual([b, a, Buffer.from('a'), Buffer.from('a')], 3)).toBe(true);
    expect(areLastBuffersEqual([a, a, b, a], 3)).toBe(false);
  });

  it('never treats a single buffer as stable', () => {
    expect(areLastBuffersEqual([a], 1)).toBe(false);
  });
});
