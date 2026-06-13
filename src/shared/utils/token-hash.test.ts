import { describe, it, expect } from 'vitest';
import { hashToken } from './token-hash.js';

describe('hashToken', () => {
  it('é determinístico (mesmo input → mesmo hash)', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('produz um digest SHA-256 hex (64 chars)', () => {
    const hash = hashToken('qualquer-token');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('nunca retorna o token em texto puro', () => {
    const token = 'super-secret-refresh-token';
    expect(hashToken(token)).not.toContain(token);
  });

  it('inputs diferentes geram hashes diferentes', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});
