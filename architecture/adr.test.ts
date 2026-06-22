import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ADR_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'adr');

/**
 * The lifecycle is the decision's type: an ADR's Status is exactly one of these, and no
 * other state a decision can be in is representable [LAW:types-are-the-program]. A record
 * carrying anything else is malformed, not a new kind of decision.
 */
const STATUSES = ['Proposed', 'Accepted', 'Superseded', 'Deprecated'] as const;
type Status = (typeof STATUSES)[number];

/**
 * Superseded-by is three distinct states, and collapsing any two of them is a lie the
 * lifecycle cannot afford [LAW:types-are-the-program]: an OMITTED field is malformed, an
 * em dash is the deliberate "no successor", and a value names the successor. Modelling it
 * as `string | undefined` would alias `absent` to `none` and let a record that simply
 * forgot the field pass as a well-formed live decision — the silent pass [LAW:no-silent-failure]
 * the earlier shape allowed.
 */
type SupersededBy =
  | { readonly kind: 'absent' }
  | { readonly kind: 'none' }
  | { readonly kind: 'successor'; readonly ref: string };

/** One ADR reduced to the metadata this enforcer governs — the rest is prose the test does not police. */
interface AdrRecord {
  readonly file: string;
  /** The number from the FILENAME (`NNNN-slug.md`); the title must agree with it. */
  readonly fileNumber: string;
  readonly titleNumber: string | undefined;
  readonly status: string | undefined;
  readonly date: string | undefined;
  readonly supersededBy: SupersededBy;
}

const FILENAME = /^(\d{4})-[a-z0-9-]+\.md$/;
const LINK = /\(\.\/(\d{4}-[a-z0-9-]+\.md)\)/g;

const field = (body: string, name: string): string | undefined =>
  body.match(new RegExp(`^- ${name}:\\s*(.+?)\\s*$`, 'm'))?.[1];

const supersededBy = (body: string): SupersededBy => {
  const raw = field(body, 'Superseded-by');
  if (raw === undefined) return { kind: 'absent' };
  if (raw === '—') return { kind: 'none' };
  return { kind: 'successor', ref: raw };
};

/** The calendar day a `YYYY-MM-DD` string denotes, or a sentinel that can equal no real date.
 *  A rolled-forward (`2026-02-31`→Mar) or unparseable instant fails to round-trip, so an
 *  impossible date is rejected loudly rather than coerced to a plausible neighbour. */
const isoDay = (date: string | undefined): string => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? `not-a-date:${date}` : parsed.toISOString().slice(0, 10);
};

const adrFiles = (): readonly string[] =>
  readdirSync(ADR_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort();

const parse = (file: string): AdrRecord => {
  const body = readFileSync(join(ADR_DIR, file), 'utf8');
  return {
    file,
    fileNumber: file.slice(0, 4),
    titleNumber: body.match(/^# ADR-(\d{4}):/m)?.[1],
    status: field(body, 'Status'),
    date: field(body, 'Date'),
    supersededBy: supersededBy(body),
  };
};

describe('architecture decision records are well-formed', () => {
  const files = adrFiles();

  it('there is at least one decision record to enforce', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('every file name is the canonical NNNN-slug.md shape', () => {
    expect(files.filter((f) => !FILENAME.test(f))).toEqual([]);
  });

  it('ADR numbers are unique — no two decisions share an index', () => {
    const numbers = files.map((f) => f.slice(0, 4));
    expect(numbers).toEqual([...new Set(numbers)]);
  });

  describe.each(files)('%s', (file) => {
    const adr = parse(file);

    it('the title number matches the file number', () => {
      expect(adr.titleNumber).toBe(adr.fileNumber);
    });

    it('carries a Status that is a real lifecycle value', () => {
      expect(STATUSES).toContain(adr.status as Status);
    });

    it('carries a Date that is a real calendar date', () => {
      expect(adr.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(isoDay(adr.date)).toBe(adr.date);
    });

    it('declares Superseded-by — an omitted field is malformed, never assumed "none"', () => {
      expect(adr.supersededBy.kind).not.toBe('absent');
    });

    it('names a successor iff it is Superseded — the history stays legible', () => {
      // A superseded decision points to what replaced it; a live one carries the em-dash
      // "none". Either well-formed state maps to exactly one status, so a record that lies
      // about whether it is still in force fails here [LAW:no-silent-failure].
      expect(adr.supersededBy.kind).toBe(adr.status === 'Superseded' ? 'successor' : 'none');
    });
  });

  it('the README index and the directory list exactly the same records', () => {
    // The directory is the source of truth for which ADRs exist; the README is a derived
    // view and must neither drop a real record nor link a ghost — set equality both ways
    // [LAW:one-source-of-truth].
    const readme = readFileSync(join(ADR_DIR, 'README.md'), 'utf8');
    const linked = [...readme.matchAll(LINK)].map((m) => m[1] as string).sort();
    expect(linked).toEqual([...files]);
  });
});
