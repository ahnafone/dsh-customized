# Agent Note: Day-scoped sandbox grants for folder-crossing work

Status: implemented

English | [中文](2026-11-05-sandbox-day-grants.zh.md)
## Problem

The sandbox escalation prompt offered one grant button, `Allow once`. A user working across several directories therefore answered the same containment denial on every call, because an escalation grant died with the call that asked. The [approval-seam Agent Note](2026-07-06-approval-seam.md) deferred a longer option until grant storage, scope identity, and revocation were designed; this note records that design.

## Decision

A sandbox escalation can offer one longer scope, `day` (24 hours), in addition to `allowed-once`. The approval seam transports the choice; the sandbox layer persists it in the session log; `ctx.sandboxPolicy.resolve()` widens later calls while the grant is unexpired.

### The approval decision

`ApprovalOutcome` grows `'allowed-day'`, and `ApprovalRequestEvent` grows an optional `grants` list naming the scopes the asker can honor. `ApprovalService.request()` accepts a scoped outcome only when the ask advertised that scope, and normalizes an unoffered scoped outcome to `'unavailable'`, so an answerer cannot manufacture a longer grant. The audit pair records the normalized decision. The seam stores nothing between requests; the asking consumer owns persistence, as with `allowed-once`.

### The grant and its scope

`approveEscalation` returns an `EscalationDecision`. Under `workspace-write`, a filesystem write or edit that can identify a directory offers a **folder grant**: both `Allow once` and the day action run that call with the standing mode plus the folder as an extra writable root, and the day action records the folder. The folder is the most specific registered workspace root containing the target when `ctx.workspaceRegistry` is composed, else the target's nearest existing parent directory; a filesystem root never qualifies. Bash, pwsh, PTC, plugin-manager, `apply_patch`, and any write/edit whose folder cannot be established offer a **mode grant** of the requested mode instead.

The longer grant is one log-only `sandbox/grant` event (a mode or a physical root, plus an absolute expiry), and `/permission revoke` writes `sandbox/grant-revoke`. A `sandboxGrants` projection folds both; `resolve()` widens the standing mode with the widest unexpired mode grant and appends unexpired folder grants to `additionalWritableRoots`, so the same policy reaches both the filesystem fence and the shell runner. The runtime-context snapshot names each active grant and its expiry so the model knows the access is temporary.

### Revocation

Any `sandbox/mode` event — a permission-preset switch or a mode change, including delegation seeding — clears every active grant in the fold, because a later standing-mode decision must not be silently overridden. `/permission revoke` clears the grants without changing the standing mode. Expiry is evaluated when `resolve()` reads the projection; no read path writes an event, and an expired grant simply stops widening. Grants are per-session, replay with the log, and are not inherited by subagent sessions, which receive only the mode seed at delegation.

### Channels and scope limits

The web client is the only grant UI. The ACP bridge and the SDK keep their one-shot vocabulary: they ignore the `grants` offer and cannot record a longer grant. There is no `allow_always` profile-wide store; a new session starts with no grants. The day duration is fixed protocol vocabulary, not deployment configuration, and the button says "1 day".

## Alternatives considered

- **Profile-wide persistent grants (`allow_always`)** — rejected for now: it needs a durable profile store, a revocation surface, and an identity rule across workspaces; the requested day scope is satisfied by a session grant that lapses, and the session log already provides replay and audit without new storage.
- **Only the session's sandbox mode as the grant** — rejected: switching a session to `danger-full-access` for a day would grant every directory, while the user asked for one folder. Folder grants keep the escalation least-privileged; mode grants remain the fallback where no folder is identifiable.
- **Reusing `sandbox/mode` with an `expiresAt` field** — rejected: older readers would interpret the event as a permanent mode override, silently widening access past the intended day. A new required event makes an older reader refuse the session instead.
- **Configuring `additionalWritableRoots` instead of a grant** — rejected: that is deployment configuration shared by every session, not a user decision recorded against one session; it cannot expire or be revoked per user action.
- **Riding `ctx.userQuestions` for a multi-option prompt** — rejected: the approval seam owns permission prompts, the fail-closed absence rule, and the audit pair; an elicitation form would duplicate that policy and lose the closed outcome vocabulary.
- **Keeping one-shot folder asks on the requested mode** — rejected: the two buttons would differ in scope as well as duration, so "allow for a day" could be narrower than "allow once"; both now resolve to the same folder scope.

## Consequences

- The new `sandbox/grant` and `sandbox/grant-revoke` event types are required events: a reader that predates this change refuses a session containing a grant rather than silently dropping or reinterpreting the permission. `SESSION_FORMAT_VERSION` is unchanged because refusal is the safe outcome.
- A folder grant is a real extra writable root; if the directory disappears while the grant is active, enforcement raises `SANDBOX_INVALID_ROOT` until the grant expires or is revoked.
- Folder inference is best-effort. A registered-workspace lookup needs `ctx.workspaceRegistry`; remote execution worlds whose paths do not match host workspaces fall back to the parent directory, and an operation with no existing parent offers a mode grant.
- One-shot filesystem escalations are now folder-scoped when a folder is identifiable, which is narrower than the model's requested `danger-full-access` and is the least-privilege resolution of the same denial.
- A permission-preset switch clears active grants; users who want to keep the standing mode while dropping grants use `/permission revoke`.

## Testing

Unit suites cover the offer validation and audit outcome, the escalation decision and folder/mode split, grant fold/expiry/clearing and context rendering, folder inference and post-grant execution, the grant sinks in every enforcing family, the client day button, and `/permission revoke`. The web approval scenario refreshes its keyless UI golden for the extra button, and a replay-only browser case clicks the day action and asserts the recorded grant event.
