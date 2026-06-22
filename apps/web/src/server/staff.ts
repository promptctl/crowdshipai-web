import { accountId, EMPTY_ROSTER, staffRoster, type AccountId, type StaffRoster } from '@crowdship/identity';

/**
 * The single place the web app resolves who holds platform-operator authority
 * [LAW:single-enforcer] — the authority twin of `getSanctions()` and
 * `getPolicyBoundary()`. Every staff-gated decision (`maySetVerification`,
 * `maySanction`) reads its subject's authority from the one roster this returns, so
 * authority cannot drift between surfaces.
 *
 * Staff is designated from CONFIGURATION, never a self-service table: a deployment
 * lists the account ids it trusts to act as the platform in `CROWDSHIP_PLATFORM_STAFF`
 * (whitespace/comma separated), and the roster is the parse of that, resolved once
 * here at the composition boundary [LAW:effects-at-boundaries]. This is what keeps
 * platform authority a separate axis from participant roles: it is conferred only by
 * editing the deployment's config and restarting — auditable, durable across
 * restarts, and unreachable by anything a user can do, exactly the
 * privilege-escalation guard `isPlatformStaff` was split out to hold. When the
 * variable is unset or empty the roster designates no one, so a deployment that
 * forgot to configure staff fails CLOSED rather than guessing [LAW:no-silent-failure].
 *
 * A malformed entry (a blank token) is a loud throw at startup, not a silently
 * dropped id: silently discarding a staff id an operator meant to trust would leave
 * the platform quietly without an operator they believe they have.
 */
const STAFF_ENV = 'CROWDSHIP_PLATFORM_STAFF';

const parseRoster = (raw: string | undefined): StaffRoster => {
  if (raw === undefined) return EMPTY_ROSTER;
  const ids: AccountId[] = raw
    .split(/[\s,]+/)
    .filter((token) => token.length > 0)
    .map((token) => {
      const parsed = accountId(token);
      if (!parsed.ok) {
        throw new Error(`${STAFF_ENV}: not a valid account id: ${JSON.stringify(token)}`);
      }
      return parsed.value;
    });
  return ids.length === 0 ? EMPTY_ROSTER : staffRoster(ids);
};

// Parsed once at module load — the roster is a pure value with no resource handle,
// so it is plain to recompute and safe to hold as a constant.
const roster: StaffRoster = parseRoster(process.env[STAFF_ENV]);

export const getStaffRoster = (): StaffRoster => roster;
