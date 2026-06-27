import { describe, expect, it } from 'vitest';
import { enumParam, flagParam, yearParam } from './viewQuery';

describe('enumParam', () => {
  const codec = enumParam(['book', 'movie', 'show', 'game'] as const, 'book');

  it('parses allowed values and rejects others', () => {
    expect(codec.parse('movie')).toBe('movie');
    expect(codec.parse('bogus')).toBeUndefined();
  });

  it('omits the default but serializes non-defaults', () => {
    expect(codec.serialize('book')).toBeNull();
    expect(codec.serialize('game')).toBe('game');
  });
});

describe('flagParam', () => {
  const codec = flagParam(false);

  it('parses 1/0 and rejects anything else', () => {
    expect(codec.parse('1')).toBe(true);
    expect(codec.parse('0')).toBe(false);
    expect(codec.parse('yes')).toBeUndefined();
  });

  it('omits the default (false) and serializes true as 1', () => {
    expect(codec.serialize(false)).toBeNull();
    expect(codec.serialize(true)).toBe('1');
  });
});

describe('yearParam', () => {
  const codec = yearParam();

  it('parses positive integers and rejects junk', () => {
    expect(codec.parse('2025')).toBe(2025);
    expect(codec.parse('abc')).toBeUndefined();
    expect(codec.parse('20.5')).toBeUndefined();
    expect(codec.parse('-3')).toBeUndefined();
  });

  it('serializes a year and omits null', () => {
    expect(codec.serialize(2024)).toBe('2024');
    expect(codec.serialize(null)).toBeNull();
  });
});

describe('round-trips', () => {
  it('parse(serialize(x)) recovers non-default values', () => {
    const codec = enumParam(['all', 'yes', 'no'] as const, 'all');
    const s = codec.serialize('yes');
    expect(s).not.toBeNull();
    expect(codec.parse(s as string)).toBe('yes');
  });
});
