/**
 * The sandbox-escalation API shared by the `write` and `edit` tools: the
 * per-call policy resolution, the advertised escalation fields, and the denial-marker
 * mapping — all delegating the vocabulary and the fail-closed approval
 * sequence to `@deepseek-ai/dsh-sandbox` (the same pieces `@deepseek-ai/dsh-tool-bash`
 * uses), so bash and fs escalate identically. Built ONCE per plugin from
 * `ctx.fs.sandboxMode` (the capability fact — is a confining backend mounted?)
 * and shared by both mutating tools.
 *
 * @module @deepseek-ai/dsh-tool-fs/sandbox
 */

import { dirname, isAbsolute, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { ESCALATION_TARGETS, approveEscalation, escalationHintMarker, sandboxDenialMarker, sandboxPermissionsDescription, validateEscalationArgs } from '@deepseek-ai/dsh-sandbox'
import { grantSandboxAccess } from '@deepseek-ai/dsh-sandbox-policy'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
// Type-only: merges the optional `ctx.workspaceRegistry` service this controller
// consults to map a denied target onto a registered workspace folder.
import type {} from '@deepseek-ai/dsh-workspace'

/** The two escalation arguments a mutating tool may carry (advertised only under a confining backend). */
export interface FsEscalationArgs {
  sandbox_permissions?: string
  justification?: string
}

/** The schema fields for the escalation arguments, spread into a tool's `parameters` when a confining backend is mounted. */
export interface EscalationSchemaFields {
  sandbox_permissions: { type: 'string'; enum: string[]; description: string }
  justification: { type: 'string'; description: string }
}

/**
 * The filesystem escalation API: advertisement gating, per-call policy
 * resolution, the one-approved wider retry, and denial-marker mapping. A pure
 * product of `ctx` at plugin apply time.
 */
export class FsSandboxController {
  /** The escalation targets this composition advertises (`[]` when no confining backend is mounted). */
  readonly escalationModes: readonly SandboxMode[]
  /** Shared per-session policy resolver, required by a confining backend. */
  private readonly policy: SandboxPolicyService | undefined

  constructor(private readonly ctx: Context) {
    const defaultMode = ctx.fs.sandboxMode
    this.escalationModes = defaultMode === undefined ? [] : ESCALATION_TARGETS
    this.policy = defaultMode === undefined ? undefined : ctx.get('sandboxPolicy')
    if (defaultMode !== undefined && this.policy === undefined) {
      throw new Error('tool-fs: the mounted filesystem confines but ctx.sandboxPolicy is missing')
    }
  }

  /**
   * The escalation schema fields for a mutating tool's `parameters`. Call it
   * only under a confining backend (guard on {@link escalationModes}); the
   * enum pins the closed target vocabulary, the strict-wider check happens per
   * call at execution.
   * @returns the two escalation parameter specs.
   */
  schemaFields(): EscalationSchemaFields {
    return {
      sandbox_permissions: {
        type: 'string',
        enum: [...this.escalationModes],
        description: sandboxPermissionsDescription('operation'),
      },
      justification: {
        type: 'string',
        description: 'Required with sandbox_permissions: one sentence for the user explaining '
          + 'why this exact file operation needs the wider access. Use the language of the user’s current request.',
      },
    }
  }

  /**
   * The policy to stamp onto this mutation: an approved escalation grant (a
   * strictly wider retry resolved through `ctx.approval` before anything
   * executes), else the Session's standing mode. An omitted or repeated mode
   * permits an omitted or blank justification; repeating the mode needs no
   * approval. A different mode requires a non-empty justification, and a
   * non-empty justification without a mode is rejected. Under
   * `workspace-write`, a target that identifies a folder offers a folder grant;
   * otherwise the requested mode is offered. The workspace root is the original
   * Session directory, or the deployment fallback when absent.
   * @param toolName - the mutating tool's name, for the approval audit trail.
   * @param args - the call's escalation arguments.
   * @param exec - the tool-execution context (agent, callId, signal).
   * @param target - the resolved mutation target, when the tool has one.
   * @returns the policy to pass to the mutation, or undefined for an
   *   unsandboxed backend.
   */
  async resolvePolicy(
    toolName: string,
    args: FsEscalationArgs,
    exec: ToolExecution,
    target?: FsTarget,
  ): Promise<SandboxExecutionPolicy | undefined> {
    const standingPolicy = this.policy?.resolve({ ...exec.agent ? { session: exec.agent.session } : {} })
    if (args.sandbox_permissions !== undefined && args.sandbox_permissions === standingPolicy?.mode) return standingPolicy
    const justification = args.sandbox_permissions === undefined && args.justification?.trim() === ''
      ? undefined
      : args.justification
    validateEscalationArgs(args.sandbox_permissions, justification)
    if (args.sandbox_permissions === undefined || args.justification === undefined) {
      return standingPolicy
    }
    if (this.escalationModes.length === 0) {
      throw new Error('sandbox_permissions is not available in this composition (no sandboxing filesystem to escalate)')
    }
    const policy = standingPolicy as SandboxExecutionPolicy
    const session = exec.agent?.session
    // A folder ask is meaningful only under workspace-write; under read-only a
    // root grant would change nothing, so the requested mode is offered instead.
    const grantRoot = target === undefined || policy.mode !== 'workspace-write'
      ? undefined
      : await this.grantRootFor(target, policy.workspaceRoot)
    const decision = await approveEscalation(
      {
        requestedMode: args.sandbox_permissions,
        justification: args.justification,
        effectiveMode: policy.mode,
        subject: 'operation',
        ...grantRoot === undefined ? {} : { grantRoot },
      },
      {
        approver: this.ctx.get('approval'),
        agent: exec.agent,
        callId: exec.callId,
        toolName,
        signal: exec.signal,
        ...session === undefined ? {} : { grant: (grant) => { grantSandboxAccess(session, grant) } },
      },
    )
    const roots = decision.root === undefined
      ? policy.additionalWritableRoots
      : Object.freeze([...new Set([...policy.additionalWritableRoots ?? [], decision.root])])
    return {
      ...policy,
      mode: decision.mode,
      ...roots === undefined ? {} : { additionalWritableRoots: roots },
    }
  }

  /**
   * The folder a day grant would cover: a registered workspace root containing
   * the target when the registry is composed, else the target's nearest
   * existing parent directory. Only a physical existing directory qualifies;
   * a filesystem root never does.
   * @param target - the resolved mutation target.
   * @param workspaceRoot - the session's standing workspace boundary.
   * @returns the grant folder, or undefined when none can be established.
   */
  private async grantRootFor(target: FsTarget, workspaceRoot: string): Promise<{ path: string; display: string } | undefined> {
    const targetPath = this.ctx.fs.processPath(target)
    const registered = await this.registeredWorkspaceRoot(targetPath)
    if (registered !== undefined) return registered
    let candidate = dirname(targetPath)
    while (true) {
      if (dirname(candidate) === candidate) return undefined
      const resolved = await this.ctx.fs.resolve(candidate)
      const info = await this.ctx.fs.stat(resolved)
      if (info?.type === 'directory') {
        const path = this.ctx.fs.processPath(resolved)
        return path === workspaceRoot ? undefined : { path, display: path }
      }
      if (info !== undefined) return undefined
      candidate = dirname(candidate)
    }
  }

  /**
   * Find the most specific registered workspace containing the target path.
   * Best-effort: an absent registry, a missing workspace directory, or a
   * remote execution world that does not share host paths falls back to the
   * target's parent directory.
   * @param targetPath - the target's execution-world path.
   * @returns the registered workspace folder, or undefined without a match.
   */
  private async registeredWorkspaceRoot(targetPath: string): Promise<{ path: string; display: string } | undefined> {
    const registry = this.ctx.get('workspaceRegistry')
    if (registry === undefined) return undefined
    const comparable = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path
    const targetKey = comparable(targetPath)
    let best: string | undefined
    for (const workspace of registry.list()) {
      if (!isAbsolute(workspace.path)) continue
      const key = comparable(workspace.path)
      const prefix = key.endsWith(sep) ? key : `${key}${sep}`
      if (targetKey !== key && !targetKey.startsWith(prefix)) continue
      if (best === undefined || workspace.path.length > best.length) best = workspace.path
    }
    if (best === undefined) return undefined
    const resolved = await this.ctx.fs.resolve(best)
    const info = await this.ctx.fs.stat(resolved)
    if (info?.type !== 'directory') return undefined
    const path = this.ctx.fs.processPath(resolved)
    return { path, display: path }
  }

  /**
   * Map a thrown provider error for the model: a `FS_SANDBOX_DENIED` becomes a
   * `FsError` whose text is the shared `[sandbox: …]` denial marker plus the
   * same-turn escalation hint, so a policy denial reads identically to bash's
   * WHILE keeping the structured `FS_SANDBOX_DENIED` code — `ToolRuntime`
   * populates `result.error` only for `HarnessError` instances, so a plain
   * `Error` would strip the code retry/observers key off. Any other error
   * passes through unchanged. A `FS_SANDBOX_DENIED` only arises under a
   * confining backend, which always advertises the escalation fields, so the
   * hint always applies here.
   * @param error - the error thrown by the mutation.
   * @param policy - the policy stamped onto the call (names the mode in the marker).
   * @returns the error to throw — the marker `FsError` for a sandbox denial, else the original.
   */
  mapError(error: FsError, policy: SandboxExecutionPolicy | undefined): FsError
  /**
   * Map a caught value, preserving failures other than sandbox denials.
   * @param error - value thrown by a mutation.
   * @param policy - policy stamped onto the call, when applicable.
   * @returns the denial marker error, or the unchanged caught value.
   */
  mapError(error: unknown, policy: SandboxExecutionPolicy | undefined): unknown
  mapError(error: unknown, policy: SandboxExecutionPolicy | undefined): unknown {
    if (!(error instanceof FsError) || error.code !== 'FS_SANDBOX_DENIED') return error
    // A FS_SANDBOX_DENIED only arises under a confining backend, whose tool
    // path always resolves a policy before mutation.
    const mode = (policy as SandboxExecutionPolicy).mode
    return new FsError(`${sandboxDenialMarker(mode)}\n${escalationHintMarker('operation')}`, 'FS_SANDBOX_DENIED', { cause: error })
  }
}
