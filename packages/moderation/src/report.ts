import type { ActorRef, ReportTarget } from './ids.js';

/**
 * A human flag: someone says a thing on the platform breaks the rules. It is the
 * raw INPUT to review, not a verdict — a report asserts nothing is true, only that
 * someone asked a moderator to look. Carrying only the facts a reviewer needs keeps
 * it, like a {@link PolicySubject}, free of any handle to identity or stream; the app
 * resolves the reporter to an {@link ActorRef} and the reported thing to a
 * {@link ReportTarget} at the edge [LAW:effects-at-boundaries].
 *
 * `reason` is the reporter's free-text "why", mirroring `PolicyViolation.reason`: a
 * report a reviewer cannot understand the grounds of is a report that cannot be
 * fairly judged [LAW:no-silent-failure]. The platform owns no closed list of report
 * reasons — what people object to is theirs to say, not ours to enumerate.
 */
export interface Report {
  readonly reporter: ActorRef;
  readonly target: ReportTarget;
  readonly reason: string;
}
