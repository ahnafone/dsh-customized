---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-05-sandbox-day-grants

English | [中文](2026-11-05-sandbox-day-grants.zh.md)

## Summary

Adds a session-scoped day grant to sandbox approvals: ApprovalOutcome gains allowed-day, and the new required events sandbox/grant and sandbox/grant-revoke record or clear a widened mode or folder.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-05-sandbox-day-grants
baseline: false
changes:
  - root: "event:approval/decided"
    previous: "2026-09-11-initial"
    after: "79850842541a526c88b38bd397bf999125e2b8fbf337f1f83f2cca8983a7381e"
    decision: same-version
  - root: "event:sandbox/grant"
    previous: null
    after: "31220a4ed485774927435a044b57c3c504c158e0c3e5a5666034e4cb6c4b5921"
    decision: same-version
  - root: "event:sandbox/grant-revoke"
    previous: null
    after: "fa78d5c355ea3c9e95d1c2ac5170d7940d959e5dc71bb6d9a7158c28fbdfada0"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

New readers understand the added outcome and both events. An older reader meeting the required sandbox/grant or sandbox/grant-revoke event refuses the session rather than silently dropping or reinterpreting the permission; an older reader cannot encounter allowed-day without one of those new required events in the same log. Existing records keep their meaning and no existing field changed type. SESSION_FORMAT_VERSION remains 4 because refusing the unknown required event is the safe outcome.

<a id="verification"></a>
## Verification

pnpm exec vitest run over every changed package (interaction/user-approval, sandbox/sandbox, sandbox/sandbox-policy, fs/tool-fs, client/ui-approval, experimental/cua, interaction/permission-presets, core/tools, core/tool-executor-ptc, shell/tool-bash, shell/tool-pwsh, boot/plugin-manager, core/session, experimental/client-ui-stats) passes, and pnpm run typecheck passes.

<a id="dev-note"></a>
## Dev Note

None.
