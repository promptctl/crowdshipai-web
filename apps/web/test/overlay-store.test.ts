import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { channelId, type ChannelId } from '@crowdship/identity';
import { openIdentityDb } from '@crowdship/identity-node';
import { afterEach, describe, expect, it } from 'vitest';

import type { OverlayStyle } from '../src/data/overlay-style';
import { InMemoryOverlayStore, type OverlayStore } from '../src/server/overlay-store';
import { SqliteOverlayStore } from '../src/server/sqlite-overlay-store';

const chan = (raw: string): ChannelId => {
  const id = channelId(raw);
  if (!id.ok) throw new Error(`bad test channel id: ${raw}`);
  return id.value;
};

const SAMPLE: OverlayStyle = { placement: 'top-right', accentHue: 280, durationSeconds: 12 };

// The two stores behind ONE seam must behave identically — the in-memory reference and
// the durable SQLite store run through the same parity suite [LAW:single-enforcer].
const stores: readonly (readonly [string, () => OverlayStore])[] = [
  ['InMemoryOverlayStore', () => new InMemoryOverlayStore()],
  ['SqliteOverlayStore', () => new SqliteOverlayStore(openIdentityDb(':memory:'))],
];

describe.each(stores)('OverlayStore parity: %s', (_name, make) => {
  it('reads back exactly the style that was authored and stored', async () => {
    const store = make();
    const ch = chan('chan-mara');
    await store.setStyle(ch, SAMPLE);
    expect(await store.styleOf(ch)).toEqual(SAMPLE);
  });

  it('has no style for a channel that never authored one — an honest undefined', async () => {
    expect(await make().styleOf(chan('chan-nobody'))).toBeUndefined();
  });

  it('restyling replaces the whole style, never a second row', async () => {
    const store = make();
    const ch = chan('chan-dex');
    await store.setStyle(ch, SAMPLE);
    const replacement: OverlayStyle = { placement: 'bottom-left', accentHue: 30, durationSeconds: 3 };
    await store.setStyle(ch, replacement);
    expect(await store.styleOf(ch)).toEqual(replacement);
  });

  it("keeps each channel's style separate", async () => {
    const store = make();
    await store.setStyle(chan('chan-a'), SAMPLE);
    expect(await store.styleOf(chan('chan-b'))).toBeUndefined();
  });
});

describe('SqliteOverlayStore: a style survives a process restart', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('an authored style read back after the database is closed and reopened', async () => {
    dir = mkdtempSync(join(tmpdir(), 'crowdship-overlay-'));
    const file = join(dir, 'identity.db');

    const opened = openIdentityDb(file);
    await new SqliteOverlayStore(opened).setStyle(chan('chan-mara'), SAMPLE);
    opened.close();

    const reopened = openIdentityDb(file);
    expect(await new SqliteOverlayStore(reopened).styleOf(chan('chan-mara'))).toEqual(SAMPLE);
    reopened.close();
  });
});

describe('SqliteOverlayStore: a malformed durable style is surfaced loudly, never coerced', () => {
  it('halts the read rather than returning a look the builder never chose', async () => {
    const db = openIdentityDb(':memory:');
    const store = new SqliteOverlayStore(db);
    // Hand-write an out-of-bounds row the validator could never have admitted.
    db.prepare('INSERT INTO overlays (channel_id, style) VALUES (?, ?)').run(
      'chan-corrupt',
      JSON.stringify({ placement: 'center-stage', accentHue: 999, durationSeconds: 0 }),
    );
    await expect((async () => store.styleOf(chan('chan-corrupt')))()).rejects.toThrow(/overlays\.style/);
  });
});
