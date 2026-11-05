/**
 * Per-session sandbox-mode override: the session log as the store. A runtime
 * switch (a UI policy control or test scenario) is recorded as one
 * `sandbox/mode` event on the session it applies to;
 * `effective = projection state ?? the deployment default`, so an override
 * survives restart by replay, two sessions can never see each other's state,
 * and there is no external config store. The event is log-only (the
 * `approval/*` precedent): the policy owner projects the fold into each model
 * request, while enforcing tools report operation-specific boundary markers.
 * EXECUTION honors the same fold through `ctx.sandboxPolicy.resolve()` — it
 * stamps the mode together with the calling session's workspace root onto each
 * capability call, weakest-precedence beneath an escalation grant.
 *
 * The override is policy state shared by every enforcing family (bash and
 * filesystem alike), so it lives here in the policy package rather than in any
 * one capability's seam.
 *
 * @module dsh-sandbox-policy/session-mode
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'

/**
 * One user-approved longer grant for a session: either a widened mode or an
 * extra writable directory, lapses at {@link expiresAt}, and never narrows a
 * mode. The event is log-only and replayable; a mode switch clears every active
 * grant, and `/permission revoke` clears them directly.
 */
export interface SandboxAccessGrant {
  /** The scope the user chose; `day` is 24 hours from the decision. */
  readonly scope: 'day'
  /** Unix epoch milliseconds after which the grant no longer applies. */
  readonly expiresAt: number
  /** The sandbox mode granted for the day; absent for a folder grant. */
  readonly mode?: SandboxMode | undefined
  /** The physical absolute directory granted for the day; absent for a mode grant. */
  readonly root?: string | undefined
}

/** The caller-supplied grant before the policy stamps its expiry. */
export type SandboxAccessGrantInput = Omit<SandboxAccessGrant, 'expiresAt'>

/** The fixed duration of one `day` grant (24 hours). */
export const DAY_GRANT_MS = 86_400_000

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The session's sandbox mode was switched — log-only (like `approval/*`;
     * NOT a surface event, carries no `surfaceOp`): durable and replayable,
     * never in the model transcript. The LAST such event is the session's
     * override (folded by the sandboxMode projection unit). `source: 'delegation'` marks
     * an override seeded into a child; an absent source is a runtime switch.
     */
    'sandbox/mode': {
      mode: SandboxMode
      /** Marks an override seeded into a child at delegation. */
      source?: 'delegation'
    }
    /**
     * A user-approved longer grant recorded after an approval decision —
     * log-only and replayable. The `sandboxGrants` projection folds it; an
     * expired grant no longer widens the resolved policy, and any later
     * `sandbox/mode` event clears the active set.
     */
    'sandbox/grant': SandboxAccessGrant
    /**
     * Clear every active longer grant without changing the session's standing
     * mode — the `/permission revoke` write path.
     */
    'sandbox/grant-revoke': Record<string, never>
  }
}

/** Every {@link SandboxMode}, for option advertisement and runtime validation of untrusted mode strings. */
export const SANDBOX_MODES: readonly SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access']

/**
 * THE write path for a session's sandbox-mode override: appends exactly one
 * `sandbox/mode` event — the switch IS its event; nothing mutates mode state
 * out of band. Takes effect on the session's next confined call (bash or fs)
 * — consumers read the shared projection state.
 * @param session - the session the override belongs to.
 * @param mode - the mode every subsequent confined call in this session runs
 *   under (until the next switch).
 */
export function setSandboxMode(session: Session, mode: SandboxMode): void {
  session.append('sandbox/mode', { mode })
}

/**
 * THE write path for a user-approved longer grant: appends exactly one
 * `sandbox/grant` event with the policy's fixed day expiry. The grant widens
 * only, never narrows; a later `sandbox/mode` event clears the active set.
 * @param session - the session the grant belongs to.
 * @param grant - the mode or folder the user approved, without an expiry.
 */
export function grantSandboxAccess(session: Session, grant: SandboxAccessGrantInput): void {
  session.append('sandbox/grant', { ...grant, expiresAt: Date.now() + DAY_GRANT_MS })
}

/**
 * Clear every active longer grant without touching the session's standing
 * mode — the `/permission revoke` write path.
 * @param session - the session whose grants are revoked.
 */
export function revokeSandboxGrants(session: Session): void {
  session.append('sandbox/grant-revoke', {})
}
