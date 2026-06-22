import type { Result } from '@crowdship/std';
import { accountId, DEFAULT_ROLES, type Principal } from '@crowdship/identity';
import { contentDescriptor, GENERAL_AUDIENCE, maturityRating, type ContentDescriptor } from '@crowdship/moderation';
import { describe, expect, it } from 'vitest';

import { viewerAccessDecision } from '../src/server/access';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const descriptor = (raw: string): ContentDescriptor => must(contentDescriptor(raw));
const mature = maturityRating('mature', [descriptor('violence')]);

const aViewer: Principal = { id: must(accountId('viewer-1')), roles: DEFAULT_ROLES };

describe('viewer-access through the one policy boundary', () => {
  it('allows general-audience content for an anonymous viewer', () => {
    expect(viewerAccessDecision(null, GENERAL_AUDIENCE)).toEqual({ outcome: 'allowed' });
  });

  it('allows general-audience content for a logged-in viewer', () => {
    expect(viewerAccessDecision(aViewer, GENERAL_AUDIENCE)).toEqual({ outcome: 'allowed' });
  });

  it('gates mature content for an anonymous viewer, naming the required standing', () => {
    const decision = viewerAccessDecision(null, mature);
    expect(decision.outcome).toBe('gated');
    if (decision.outcome === 'gated') {
      expect(decision.gates.map((g) => g.required)).toEqual(['mature']);
    }
  });

  it('gates mature content for a logged-in viewer too — no age fact clears anyone yet', () => {
    // The honest floor: with no age/verification recorded, every viewer resolves to
    // 'general' clearance, so even a logged-in account is gated from mature content.
    const decision = viewerAccessDecision(aViewer, mature);
    expect(decision.outcome).toBe('gated');
  });
});
