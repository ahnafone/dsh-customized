/**
 * The sandbox POLICY home (`ctx.sandboxPolicy`): the single owner of the
 * deployment's sandbox fallbacks plus per-session resolution: the file-effect
 * {@link SandboxMode}, the `workspace-write` root, the explicit extra writable
 * directories, and the override kit (the `sandbox/mode` event, its fold, and
 * its write path; the fold is the `sandboxMode` session-projection unit
 * registered here, while the event and write path come from
 * `./session-mode.ts`).
 * Before each agent request, the owner also contributes the resolved policy to
 * the cache-safe runtime-context snapshot. The agent loop logs that snapshot as
 * model history, so replay reconstructs the same mode and root the enforcing
 * consumers resolve without rewriting the stable system prompt.
 *
 * Enforcing filesystem, one-shot bash, and terminal backends read the SAME
 * resolved policy here. The context describes that policy without inventorying
 * capabilities, while each backend retains its own enforcement dialect and each
 * tool owns its operation-specific denial and escalation guidance. The service
 * reads session state once at each operation boundary; executors and providers
 * remain session-free.
 *
 * @module @deepseek-ai/dsh-sandbox-policy
 */

import { isAbsolute } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-system-prompt'

export {
  DAY_GRANT_MS,
  SANDBOX_MODES,
  grantSandboxAccess,
  revokeSandboxGrants,
  setSandboxMode,
} from './session-mode.ts'
export type { SandboxAccessGrant, SandboxAccessGrantInput } from './session-mode.ts'
import type { SandboxAccessGrant } from './session-mode.ts'

/** Preserve execution-world spelling; enforcing providers resolve filesystem identity on their host. */
function resolveWorkspaceRoot(path: string): string {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('sandbox-policy: workspace root must be an absolute execution-world path without NUL bytes')
  return path
}

/**
 * Validate and detach the configured extra writable directories. They stay in
 * their execution-world spelling here: a local host must not canonicalize a
 * remote path. The enforcing host validates each physical directory before granting.
 * @param roots - the configured extra roots, or the empty schema default.
 * @returns a frozen copy, or `undefined` when no extra grant exists.
 */
function resolveAdditionalWritableRoots(roots: readonly string[] | undefined): readonly string[] | undefined {
  if (roots === undefined || roots.length === 0) return undefined
  for (const root of roots) {
    if (!isAbsolute(root) || root.includes('\0')) {
      throw new Error('sandbox-policy: additionalWritableRoots entries must be absolute execution-world paths')
    }
  }
  return Object.freeze([...new Set(roots)])
}

/** One active grant as the model reads it: what it widens and when it lapses. */
function renderGrant(grant: SandboxAccessGrant): string {
  const until = new Date(grant.expiresAt).toISOString()
  return grant.mode === undefined
    ? `directory ${JSON.stringify(grant.root)} until ${until}`
    : `mode ${JSON.stringify(grant.mode)} until ${until}`
}

/** Mode widening order; a grant can only ever widen, never narrow. */
const MODE_RANK: Readonly<Record<SandboxMode, number>> = {
  'read-only': 0,
  'workspace-write': 1,
  'danger-full-access': 2,
}

/**
 * Pick the widest of a non-empty mode list.
 * @param modes - the standing mode and every active granted mode.
 * @returns the widest mode.
 */
function widestMode(modes: readonly SandboxMode[]): SandboxMode {
  return modes.reduce((widest, mode) => MODE_RANK[mode] > MODE_RANK[widest] ? mode : widest)
}

/** Render the policy without claiming which capabilities are mounted. */
function renderPolicyContext(policy: SandboxExecutionPolicy, grants: readonly SandboxAccessGrant[]): string {
  const temporary = grants.length === 0
    ? ''
    : ` Temporary user grants: ${grants.map(renderGrant).join('; ')}.`
  switch (policy.mode) {
    case 'read-only':
      return `Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.${temporary}`
    case 'workspace-write': {
      const additional = policy.additionalWritableRoots
      const extra = additional === undefined
        ? ''
        : ` Additional writable directories: ${JSON.stringify(additional)}.`
      return `Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: ${JSON.stringify(policy.workspaceRoot)}.${extra} Some platform temporary areas may also be writable.${temporary}`
    }
    case 'danger-full-access':
      return `Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.${temporary}`
    /* v8 ignore next 4 -- SandboxMode is a typed same-process closed union; this branch is only the static exhaustiveness guard. */
    default: {
      const mode: never = policy.mode
      throw new Error(`unreachable sandbox mode: ${String(mode)}`)
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sandboxPolicy: SandboxPolicyService
  }
}

/**
 * Plugin config: the deployment's sandbox default. All optional — `Config`
 * supplies the defaults (`mode: 'read-only'` is the fail-safe default; a
 * deployment that wants a workspace-writable agent opts in explicitly). The
 * runner choice is NOT here (it is the `ctx.sandbox` provider's config), nor
 * is any per-family knob: this is the one shared policy home.
 */
export interface Config {
  /** File-sandbox mode a session starts from (default: `read-only`). */
  mode?: SandboxMode
  /**
   * Absolute fallback root for agentless calls and sessions without a cwd (default:
   * `process.cwd()`). Normal agent calls use their session cwd instead.
   */
  workspaceRoot?: string
  /**
   * Extra physical absolute directories that `workspace-write` may also write under
   * (default: none). The supervisor names them explicitly; there is no
   * automatic repository or gitfile discovery. Entries are execution-world
   * paths: this service validates absoluteness and detaches the list, while
   * the enforcing host rejects missing, non-directory, or symlinked paths. They grant nothing under
   * `read-only`.
   */
  additionalWritableRoots?: string[]
}

/** Inputs that select the sandbox policy for one capability call. */
export interface SandboxPolicyRequest {
  /** Calling session; its immutable cwd becomes the workspace boundary. */
  session?: Session
  /** Explicit approved mode override, which outranks session policy. */
  mode?: SandboxMode
}

/** The sandbox-mode projection's state schema (state equals the public shape). */
const sandboxModeStateSchema = zod.union([
  zod.literal('read-only'),
  zod.literal('workspace-write'),
  zod.literal('danger-full-access'),
]).nullable()

/** The active-grant projection's schema; its state is the schema's inferred shape. */
const sandboxGrantsStateSchema = zod.object({
  grants: zod.array(zod.object({
    scope: zod.literal('day'),
    expiresAt: zod.number().int().nonnegative(),
    mode: zod.union([
      zod.literal('read-only'),
      zod.literal('workspace-write'),
      zod.literal('danger-full-access'),
    ]).optional(),
    root: zod.string().optional(),
  }).strict()),
}).strict()

type SandboxGrantsState = zod.infer<typeof sandboxGrantsStateSchema>

/**
 * The sandbox-policy service (`ctx.sandboxPolicy`). Owns the deployment
 * default mode, fallback workspace root, and current request-time policy
 * section. Tool layers call {@link resolve} for each execution so a session's
 * mode log and immutable cwd travel together to every enforcing capability.
 */
export class SandboxPolicyService extends Service {
  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    mode: z.union(['read-only', 'workspace-write', 'danger-full-access'] as const).default('read-only'),
    // No schema default: process.cwd() is resolved in the constructor so the
    // stored root is always absolute regardless of how it was supplied.
    workspaceRoot: z.string(),
    additionalWritableRoots: z.array(z.string()).default([]),
  })

  static inject = ['sessionProjections']

  /** The deployment default mode — the fallback beneath a session override. */
  readonly defaultMode: SandboxMode
  /** The absolute `workspace-write` fallback root for calls without a session cwd. */
  readonly workspaceRoot: string
  /** The frozen extra writable directories shared by every resolved policy, or `undefined` for none. */
  readonly additionalWritableRoots: readonly string[] | undefined
  private sandboxModeProjectionHandle!: ProjectionHandle<SandboxMode | null>
  private sandboxGrantsProjectionHandle!: ProjectionHandle<SandboxGrantsState>

  constructor(ctx: Context, config: Config) {
    super(ctx, 'sandboxPolicy')
    // schemastery (static Config) already filled `mode`; the cast records that
    // runtime fact. `workspaceRoot` has NO schema default, so its fallback to
    // the process cwd is real branching, resolved absolute either way.
    this.defaultMode = config.mode as SandboxMode
    this.workspaceRoot = resolveWorkspaceRoot(config.workspaceRoot ?? process.cwd())
    this.additionalWritableRoots = resolveAdditionalWritableRoots(config.additionalWritableRoots)
  }

  protected async [Service.init](): Promise<void> {
    const ctx = this.ctx
    this.sandboxModeProjectionHandle = await ctx.sessionProjections.register({
      key: 'sandboxMode',
      stateVersion: 1,
      stateSchema: sandboxModeStateSchema,
      init: () => null,
      apply: (state, event) => (event.type === 'sandbox/mode' ? event.data.mode : state),
    })
    this.sandboxGrantsProjectionHandle = await ctx.sessionProjections.register({
      key: 'sandboxGrants',
      stateVersion: 1,
      stateSchema: sandboxGrantsStateSchema,
      init: () => ({ grants: [] }),
      apply: (state, event) => {
        switch (event.type) {
          case 'sandbox/grant':
            return { grants: [...state.grants, event.data] }
          // A mode switch is the user's explicit standing policy; it revokes
          // every longer grant so a later narrowing cannot be overridden.
          case 'sandbox/mode':
          case 'sandbox/grant-revoke':
            return state.grants.length === 0 ? state : { grants: [] }
          default:
            return state
        }
      },
    })

    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'sandbox:policy',
        order: scope.systemPrompt.getContextOrder('SANDBOX_POLICY'),
        text: (context) => {
          const session = context.agent?.session
          return session === undefined
            ? ''
            : renderPolicyContext(this.resolve({ session }), this.activeGrants(session))
        },
      })
    })
  }

  /**
   * Resolve the complete policy for one capability call. An approved explicit
   * mode outranks the session's last `sandbox/mode` event, which outranks the
   * deployment default; an unexpired longer grant widens either of those. A
   * session cwd is its workspace-write boundary; the configured root is the
   * fallback for agentless calls and sessions without a cwd. Granted folders
   * join the configured extra roots for `workspace-write`.
   * @param request - optional session and approved mode override.
   * @returns the fully resolved per-call mode and absolute workspace root.
   */
  resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy {
    const { session } = request
    const grants = session === undefined ? [] : this.activeGrants(session)
    const standing = session === undefined
      ? this.defaultMode
      : this.overrideOf(session) ?? this.defaultMode
    const grantedModes = grants.flatMap(grant => grant.mode === undefined ? [] : [grant.mode])
    const mode = request.mode ?? (grantedModes.length === 0 ? standing : widestMode([standing, ...grantedModes]))
    const roots = [
      ...this.additionalWritableRoots ?? [],
      ...grants.flatMap(grant => grant.root === undefined ? [] : [grant.root]),
    ]
    const additional = roots.length === 0 ? undefined : Object.freeze([...new Set(roots)])
    return {
      mode,
      workspaceRoot: resolveWorkspaceRoot(session?.header.cwd ?? this.workspaceRoot),
      ...additional === undefined ? {} : { additionalWritableRoots: additional },
      ...session === undefined ? {} : { sessionId: session.id },
    }
  }

  /**
   * Read the session override without applying the deployment default.
   * @param session - session whose log supplies the override.
   * @returns the last logged mode, or `undefined` without one.
   */
  overrideOf(session: Session): SandboxMode | undefined {
    return this.sandboxModeProjectionHandle.stateOf(session) ?? undefined
  }

  /**
   * The session's unexpired longer grants, in log order.
   * @param session - session whose log supplies the grants.
   * @returns the grants that still widen this session's policy.
   */
  private activeGrants(session: Session): readonly SandboxAccessGrant[] {
    const now = Date.now()
    return this.sandboxGrantsProjectionHandle.stateOf(session).grants.filter(grant => grant.expiresAt > now)
  }
}

export default SandboxPolicyService
