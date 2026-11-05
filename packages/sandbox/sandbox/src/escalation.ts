/**
 * The escalation vocabulary and choreography shared by every sandbox-enforcing
 * tool family (`@deepseek-ai/dsh-tool-bash`, `@deepseek-ai/dsh-tool-fs`): the
 * strictly-wider ladder, the argument-pairing validation, the model-facing
 * denial/hint markers, and {@link approveEscalation} — the ordered fail-closed
 * sequence that resolves a `sandbox_permissions` request through a
 * user-approval channel BEFORE anything executes. One home keeps the two
 * families' approval ordering and verbatim error texts from drifting apart.
 *
 * The channel is a minimal STRUCTURAL function shape ({@link EscalationAsk}),
 * not the approval service type: the tool layer — which owns the agent, the
 * call id, and the tool name — closes over `ctx.approval.request(...)` and
 * hands the closure down, so this package never depends on the approval or
 * agent packages.
 *
 * @module dsh-sandbox/escalation
 */

import { assertNever } from '@deepseek-ai/dsh-util-values'
import { escalationDisplayReason, folderEscalationDisplayReason } from './locales.ts'
import type { SandboxMode } from './index.ts'

/**
 * The strictly-wider table: what a call whose effective mode is the key may
 * escalate TO. Checked at EXECUTION, never baked into a tool schema — the
 * schema's enum is {@link ESCALATION_TARGETS}, because schemas are
 * registry-global while the effective mode is per-call truth.
 */
export const WIDER_MODES: Record<string, readonly SandboxMode[]> = {
  'read-only': ['workspace-write', 'danger-full-access'],
  'workspace-write': ['danger-full-access'],
}

/**
 * The closed escalation-target vocabulary — every mode a call could ever
 * escalate TO (`read-only` is the floor; nothing escalates to it). Advertised
 * whenever the mounted capability confines: cutting the enum down to the modes
 * wider than the composition's DEFAULT would strand a session whose effective
 * mode sits below it (a `danger-full-access` default would advertise nothing
 * while a narrower-switched session stays confined with no lever).
 */
export const ESCALATION_TARGETS: readonly SandboxMode[] = ['workspace-write', 'danger-full-access']

/**
 * Validate the escalation argument pairing a tool schema cannot express:
 * `sandbox_permissions` and `justification` travel together — an approval
 * prompt without a reason, or a reason driving nothing, is a malformed ask —
 * and the justification must be a non-empty sentence.
 * @param sandboxPermissions - the raw `sandbox_permissions` argument, if given.
 * @param justification - the raw `justification` argument, if given.
 */
export function validateEscalationArgs(sandboxPermissions: string | undefined, justification: string | undefined): void {
  if (sandboxPermissions !== undefined && justification === undefined) {
    throw new Error('invalid escalation: sandbox_permissions requires a justification')
  }
  if (justification !== undefined && sandboxPermissions === undefined) {
    throw new Error('invalid escalation: justification is only valid together with sandbox_permissions')
  }
  if (justification !== undefined && justification.trim().length === 0) {
    throw new Error('invalid justification: expected a non-empty sentence')
  }
}

/**
 * The model-facing denial marker — the one vocabulary both enforcing families
 * teach and report, so the model recognizes a policy denial identically
 * whether the kernel refused a bash file effect or the filesystem provider's
 * fence refused a mutation.
 * @param mode - the mode the denied call ran under.
 * @returns the marker line, exactly as the model sees it.
 */
export function sandboxDenialMarker(mode: SandboxMode): string {
  return `[sandbox: file access denied under ${mode} mode]`
}

/**
 * The same-turn escalation hint that rides a denial when the composition
 * advertises the escalation fields — the nudge lives at the decision point so
 * the sanctioned retry does not depend on the model recalling the tool
 * description.
 * @param subject - the family's noun for the denied action (`command` for
 *   bash, `operation` for a filesystem mutation).
 * @returns the hint line, exactly as the model sees it.
 */
export function escalationHintMarker(subject: string): string {
  return `[sandbox: escalation available — retry this exact ${subject} once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]`
}

/**
 * The model-facing `sandbox_permissions` parameter description, which carries
 * the escalation rules for every enforcing family.
 * @param subject - the family's noun for the denied action (`command` for
 *   bash, `operation` for a filesystem mutation).
 * @returns the parameter description, exactly as the model sees it.
 */
export function sandboxPermissionsDescription(subject: string): string {
  return `The narrowest wider sandbox mode for a one-shot retry of the exact ${subject} the sandbox just denied; the retry asks the user for approval.`
}

/**
 * The closed outcome vocabulary of one escalation ask — structurally identical
 * to the approval seam's `ApprovalOutcome` so an `ApprovalService.request`
 * return is assignable without this package importing it.
 */
export type EscalationOutcome = 'allowed-once' | 'allowed-day' | 'rejected' | 'cancelled' | 'unavailable'

/**
 * The longer scopes an escalation ask can offer. `day` lapses 24 hours after
 * the decision; a caller that cannot persist a grant offers one-shot only.
 */
export type EscalationGrantScope = 'day'

/**
 * The longer grant a user chose for a denied operation.
 *
 * Exactly one of {@link mode} or {@link root} is present: a mode grant widens
 * every call in the session; a folder grant adds one writable directory under
 * the standing `workspace-write` mode.
 */
export interface EscalationGrant {
  /** The scope the user chose. */
  readonly scope: EscalationGrantScope
  /** The sandbox mode granted for the day; absent for a folder grant. */
  readonly mode?: SandboxMode
  /** The physical absolute directory granted for the day; absent for a mode grant. */
  readonly root?: string
}

/**
 * The resolution of one escalation ask: the mode the current call runs under,
 * the folder it may additionally write under, and the longer grant to persist.
 */
export interface EscalationDecision {
  /** The mode the current call runs under. */
  readonly mode: SandboxMode
  /** The directory this call may additionally write under, for a folder ask. */
  readonly root?: string
  /** The longer grant the user chose, when they chose one. */
  readonly grant?: EscalationGrant
}

/**
 * The minimal approval-request shape {@link approveEscalation} needs —
 * structurally the approval seam's `ApprovalService`, generic over the agent
 * type `A` and call-id type `C` so this package resolves escalations through
 * `ctx.approval` without importing the approval or agent packages (the tool
 * layer infers `A`/`C` as its own `Agent`/`ToolCallId`).
 */
export interface EscalationApprover<A = object, C = string> {
  /**
   * Ask the human to approve one action, resolving to a closed outcome.
   * @param req - the audit request with optional localized displayReason and presentation lifetime signal.
   * @returns the human's decision as a closed {@link EscalationOutcome}.
   */
  request(req: {
    agent: A
    toolName: string
    callId: C
    reason: string
    displayReason?: { readonly en: string; readonly [locale: string]: string }
    grants?: readonly EscalationGrantScope[]
    signal?: AbortSignal
  }): Promise<EscalationOutcome>
}

/**
 * The approval ingredients an escalating tool hands {@link approveEscalation}:
 * the approval requester (`ctx.approval`, or `undefined` when none is
 * composed), the calling agent (or `undefined` for an agent-less execution),
 * and the call's identity. The tool layer holds all of these; this package
 * only judges them.
 */
export interface EscalationApproval<A = object, C = string> {
  /** The approval requester (`ctx.approval`), or `undefined` when none is composed. */
  approver: EscalationApprover<A, C> | undefined
  /** The calling agent, or `undefined` for an agent-less execution (fails closed). */
  agent: A | undefined
  /** The tool-call id the approval prompt attaches to. */
  callId: C
  /** The tool name recorded on the approval request. */
  toolName: string
  /** The tool-execution abort signal the approval request rides, when present. */
  signal?: AbortSignal
  /**
   * Persist the longer grant the user chooses. Absent means the ask offers
   * one-shot only, because this composition cannot store the grant.
   */
  grant?: (grant: EscalationGrant) => void
}

/** One escalation request, as {@link approveEscalation} judges it. */
export interface EscalationRequest {
  /** The requested target mode (schema-pinned to {@link ESCALATION_TARGETS} when advertised). */
  requestedMode: string
  /** The model's one-sentence reason, shown verbatim to the user inside the audit reason. */
  justification: string
  /** The call's effective mode (session override ?? composition default); repeating it needs no approval. */
  effectiveMode: SandboxMode
  /** The family's noun for the escalated action in user-facing texts (`command` for bash, `operation` for fs). */
  subject: string
  /**
   * The physical absolute directory a folder grant would cover, when the
   * denied operation identifies one. Present only under `workspace-write`;
   * absent asks for the requested mode instead.
   */
  grantRoot?: { readonly path: string; readonly display: string }
}

/**
 * Resolve a sandbox permission request before execution. Repeating the call's
 * effective mode returns it without approval. A strictly wider mode requires
 * approval; a folder ask resolves to the standing mode plus the folder for
 * this call, and a mode ask applies the requested mode to this call only. A
 * chosen day grant is handed to the caller's persistence sink. Narrower or
 * unsupported targets, missing approval services or agents for widening, and
 * non-grant outcomes throw before execution.
 * @param request - the escalation to judge (see {@link EscalationRequest}).
 * @param approval - the approval ingredients the tool holds (see {@link EscalationApproval}).
 * @returns the decision for this call, including the longer grant to persist.
 */
export async function approveEscalation<A, C>(request: EscalationRequest, approval: EscalationApproval<A, C>): Promise<EscalationDecision> {
  const { requestedMode: mode, effectiveMode, justification, subject, grantRoot } = request
  if (mode === effectiveMode) return { mode: effectiveMode }
  // Strict widening is an EXECUTION check against the call's effective mode —
  // deliberately not a schema constraint (the enum is the closed target
  // vocabulary; the effective mode is per-call truth).
  if (!(WIDER_MODES[effectiveMode] ?? []).includes(mode as SandboxMode)) {
    throw new Error(`sandbox escalation to "${mode}" is not strictly wider than this call's current "${effectiveMode}" mode`)
  }
  if (approval.approver === undefined) {
    throw new Error(`sandbox escalation to "${mode}" requires approval, but no approval service is composed`)
  }
  if (approval.agent === undefined) {
    throw new Error(`sandbox escalation to "${mode}" requires approval, but the call has no agent to route it through`)
  }
  // Self-contained for the audit trail: approval/asked stores this reason,
  // and the target mode (or the folder the user is asked about) is part of the
  // grant's identity. Only a caller that can persist a grant offers one.
  const grants: readonly EscalationGrantScope[] | undefined = approval.grant === undefined ? undefined : ['day']
  const outcome = await approval.approver.request({
    agent: approval.agent,
    toolName: approval.toolName,
    callId: approval.callId,
    reason: grantRoot === undefined
      ? `escalate sandbox to ${mode}: ${justification}`
      : `escalate sandbox for ${grantRoot.display} (requested ${mode}): ${justification}`,
    displayReason: grantRoot === undefined
      ? escalationDisplayReason(mode, justification)
      : folderEscalationDisplayReason(grantRoot.display, justification),
    ...grants === undefined ? {} : { grants },
    ...approval.signal ? { signal: approval.signal } : {},
  })
  // A folder ask never needs the wider mode: the standing workspace-write mode
  // plus the granted folder covers the denied operation, and the user approved
  // exactly that folder rather than the requested mode.
  const once: EscalationDecision = grantRoot === undefined
    ? { mode: mode as SandboxMode }
    : { mode: effectiveMode, root: grantRoot.path }
  switch (outcome) {
    // The schema enum already pinned `mode` to the closed target vocabulary;
    // the check above proved it is strictly wider.
    case 'allowed-once': return once
    case 'allowed-day': {
      if (approval.grant === undefined) {
        throw new Error(`sandbox escalation to "${mode}" requires approval, but no approval channel can persist a longer grant`)
      }
      const grant: EscalationGrant = grantRoot === undefined
        ? { scope: 'day', mode: mode as SandboxMode }
        : { scope: 'day', root: grantRoot.path }
      approval.grant(grant)
      return { ...once, grant }
    }
    case 'rejected': throw new Error(grantRoot === undefined
      ? `the user rejected escalating this ${subject} to "${mode}"; it stays denied, so stop and explain instead of working around it`
      : `the user rejected allowing this ${subject} under "${grantRoot.display}"; it stays denied, so stop and explain instead of working around it`)
    case 'cancelled': throw new Error(grantRoot === undefined
      ? `approval for escalating to "${mode}" was cancelled`
      : `approval for allowing "${grantRoot.display}" was cancelled`)
    case 'unavailable': throw new Error(`sandbox escalation to "${mode}" requires approval, but no approval channel is available`)
    default: return assertNever(outcome, 'EscalationOutcome')
  }
}
