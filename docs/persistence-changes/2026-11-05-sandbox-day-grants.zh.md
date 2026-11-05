---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-05-sandbox-day-grants

[English](2026-11-05-sandbox-day-grants.md) | 中文

## 概述

为沙箱审批增加会话级日授权：ApprovalOutcome 增加 allowed-day，并新增必需的 sandbox/grant 与 sandbox/grant-revoke 事件，用于记录或清除放宽后的模式或目录。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

新读取器理解新增结果和两个事件。旧读取器遇到必需的 sandbox/grant 或 sandbox/grant-revoke 事件时会拒绝该会话，而不是静默丢弃或错误解释权限；同一日志中若没有这些新增必需事件，旧读取器不会遇到 allowed-day。已有记录的含义保持不变，现有字段没有改型。SESSION_FORMAT_VERSION 仍为 4，因为拒绝未知必需事件就是安全结果。

<a id="verification"></a>
## 验证

对全部改动包（interaction/user-approval、sandbox/sandbox、sandbox/sandbox-policy、fs/tool-fs、client/ui-approval、experimental/cua、interaction/permission-presets、core/tools、core/tool-executor-ptc、shell/tool-bash、shell/tool-pwsh、boot/plugin-manager、core/session、experimental/client-ui-stats）执行 pnpm exec vitest run 均通过，且 pnpm run typecheck 通过。

<a id="dev-note"></a>
## 开发备注

无。
