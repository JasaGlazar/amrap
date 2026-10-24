import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorMessages, fromError, t } from '.';
import { sl } from './sl';

function leaves(value: unknown, path = 'sl'): [string, unknown][] {
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, `${path}.${key}`));
  }
  return [[path, value]];
}

describe('sl strings', () => {
  it('has no empty strings', () => {
    const empty = leaves(sl).filter(([, v]) => typeof v !== 'string' || v.trim() === '');
    expect(empty.map(([path]) => path)).toEqual([]);
  });

  it('gives every plural all four Slovenian forms, each with {count}', () => {
    const forms = ['one', 'two', 'few', 'other'];
    const plurals = leaves(sl)
      .filter(([path]) => /\.(one|two|few|other)$/.test(path))
      .map(([path]) => path.replace(/\.[a-z]+$/, ''));
    const parents = [...new Set(plurals)];
    expect(parents.length).toBeGreaterThan(0);
    for (const parent of parents) {
      const entries = leaves(sl).filter(([path]) => path.startsWith(`${parent}.`));
      expect(entries.map(([path]) => path.slice(parent.length + 1)).sort()).toEqual(
        [...forms].sort(),
      );
      expect(entries.filter(([, v]) => !String(v).includes('{count}'))).toEqual([]);
    }
  });

  it('is exported as t', () => {
    expect(t).toBe(sl);
  });
});

describe('errorMessages', () => {
  it('has copy for every AMRAP_ token in docs/rpcs.md', () => {
    const doc = readFileSync(join(__dirname, '../../../docs/rpcs.md'), 'utf8');
    const rows = doc.match(/^\| `AMRAP_[A-Z_]+` \|/gm) ?? [];
    const tokens = rows.map((row) => row.replace(/[| `]/g, ''));
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.filter((token) => !(token in errorMessages))).toEqual([]);
  });

  it('has no token that docs/rpcs.md does not define', () => {
    const doc = readFileSync(join(__dirname, '../../../docs/rpcs.md'), 'utf8');
    const unknown = Object.keys(errorMessages).filter((token) => !doc.includes(`\`${token}\``));
    expect(unknown).toEqual([]);
  });
});

describe('fromError', () => {
  it('maps the token at the start of a Postgres error message', () => {
    const error = { message: 'AMRAP_CAPACITY_FULL: slot is full', code: 'P0001' };
    expect(fromError(error)).toBe(errorMessages.AMRAP_CAPACITY_FULL);
  });

  it('maps a known Supabase Auth error code', () => {
    const error = { message: 'Invalid login credentials', code: 'invalid_credentials' };
    expect(fromError(error)).toBe(t.authErrors.invalid_credentials);
  });

  it.each([
    ['an unknown token', { message: 'AMRAP_SOMETHING_NEW: x' }],
    ['a plain Error', new Error('network down')],
    ['a string without a token', 'boom'],
    ['null', null],
  ])('falls back to the generic message for %s', (_name, error) => {
    expect(fromError(error)).toBe(t.genericError);
  });
});

describe('hardcoded Slovenian', () => {
  it('does not appear outside src/i18n', () => {
    const src = join(__dirname, '..');
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.(ts|tsx|css)$/.test(file))
      .filter((file) => !file.startsWith('i18n') && !file.startsWith('lib/database.types'))
      .filter((file) => !/\.test\.tsx?$/.test(file));
    const offenders = files.filter((file) =>
      /[čšžČŠŽ]/.test(readFileSync(join(src, file), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
