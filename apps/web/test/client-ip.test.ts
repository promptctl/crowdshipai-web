import { describe, expect, it } from 'vitest';

import { clientIp } from '../src/server/client-ip';

describe('clientIp', () => {
  it('returns the first hop of X-Forwarded-For, the original client', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' });
    expect(clientIp(headers)).toBe('203.0.113.7');
  });

  it('trims surrounding whitespace from the first hop', () => {
    const headers = new Headers({ 'x-forwarded-for': '  203.0.113.7 , 70.41.3.18' });
    expect(clientIp(headers)).toBe('203.0.113.7');
  });

  it('falls back to X-Real-IP when X-Forwarded-For is absent', () => {
    const headers = new Headers({ 'x-real-ip': '198.51.100.4' });
    expect(clientIp(headers)).toBe('198.51.100.4');
  });

  it('prefers X-Forwarded-For over X-Real-IP when both are present', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.4' });
    expect(clientIp(headers)).toBe('203.0.113.7');
  });

  it('falls back past an empty X-Forwarded-For first hop to X-Real-IP', () => {
    // A leading comma yields a blank first element; that is not an identifiable
    // source, so it must not become the rate-limit key.
    const headers = new Headers({ 'x-forwarded-for': ', 70.41.3.18', 'x-real-ip': '198.51.100.4' });
    expect(clientIp(headers)).toBe('198.51.100.4');
  });

  it("collapses to the shared 'unknown' bucket when no forwarding header identifies a source", () => {
    expect(clientIp(new Headers())).toBe('unknown');
  });

  it("collapses an empty X-Forwarded-For with no other source to 'unknown'", () => {
    // A proxy may emit a present-but-empty header; that names no source.
    expect(clientIp(new Headers({ 'x-forwarded-for': '' }))).toBe('unknown');
  });

  it("treats a whitespace-only X-Real-IP as no source, not a key", () => {
    expect(clientIp(new Headers({ 'x-real-ip': '   ' }))).toBe('unknown');
  });
});
