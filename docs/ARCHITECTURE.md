# Nix architecture

## Goals and constraints

Nix is a local-first coding agent for Windows, Node.js, and TypeScript. Inference travels over local HTTP to a replaceable model backend. The first provider targets an already-running llama.cpp server. There is no cloud fallback, hosted database, or telemetry in normal operation.

The implementation favors explicit, testable components and progressive repository inspection over orchestration frameworks or whole-repository prompting.

## Planned component boundaries

- `src/model`: backend-neutral model request/response types and providers.
- `src/agent`: iterative agent loop, response parsing, task state, and context management.
- `src/tools`: structured tool definitions, validation, registry, and execution.
- `src/workspace`: workspace identity, path containment, repository inspection, and later registry support.
- `src/security`: filesystem and command permission decisions.
- `src/memory`: future global, workspace, and task memory. Source and tests outrank memory.
- `src/cli`: user-facing commands and configuration wiring.
- `src/shared`: small cross-cutting types, errors, logging, and utilities.

## Core flow

```text
User task
  -> workspace context
  -> AgentRunner
  -> ModelProvider (local HTTP implementation first)
  -> parsed assistant response or structured tool request
  -> ToolRegistry / PermissionManager / ToolExecutor
  -> structured tool result returned to the model
  -> repeat up to a configurable maximum
  -> final response and local task log
```

## Early decisions

1. The initial CLI is non-interactive and scriptable; an interactive session can be layered on later.
2. Tool schemas use a small internal JSON-schema subset and runtime validators. This keeps tool execution understandable without a large agent framework.
3. Configuration merges defaults, an optional local JSON file, environment variables, and CLI overrides in that order.
4. Workspace paths are resolved and checked before use. Symlink-aware containment checks will be part of workspace safety.
5. Commands execute without an interpolating shell by default and are classified from parsed executable/arguments.
6. Local task logs use JSON Lines and redact configured sensitive fields; no telemetry leaves the machine.
7. Advanced memory, repository indexing, and cross-workspace coordination remain deferred until the full single-workspace coding loop is reliable.
8. The llama.cpp provider uses its OpenAI-compatible `/v1/chat/completions` endpoint, but only the provider knows that wire format. Agent code consumes normalized messages and tool calls.
9. Tool failures are values returned to the model, not uncaught agent-loop failures. This lets the model correct malformed requests while preserving an auditable error count.
10. Repository search uses bounded progressive reads and conservative binary-extension filtering. It does not pre-load repository contents.
11. The initial patch tool performs a unique exact-text replacement rather than accepting an opaque shell patch command. Missing or repeated match blocks make no change.
12. Commands use an executable plus argument array with `shell: false`. The initial policy allows only known verification/read commands; write commands return an approval-required result and destructive commands are denied.
13. On Windows, allowed npm commands invoke the local `npm-cli.js` using the current Node executable. This avoids unsafe shell interpolation and the platform limitation on spawning `.cmd` files directly.
14. The first repository map is deliberately lexical: it scans bounded TypeScript/JavaScript-family files, extracts declarations and method-like symbols, honors workspace ignores, and reports retrieval counts. It adds no parser, embedding, or database dependency.
15. The workspace registry is a versioned JSON document stored outside registered repositories by default at `%USERPROFILE%\.nix-agent\workspaces.json`. Writes use a same-directory temporary file and atomic rename. Names are case-insensitive, paths are canonicalized, and removal only removes metadata.
16. A registered workspace can be selected by stable UUID or name using `--workspace`; the shared model/provider instance is still created per CLI task, not per repository identity.
17. Workspace memory uses schema-versioned SQLite through Node 24's built-in `node:sqlite`; no database package or hosted service is required. The database lives at `<data-directory>/memory.sqlite` and uses WAL mode.
18. Durable entries contain a workspace ID, constrained fact kind, concise content, source, timestamps, optional commit hash/confidence, and lifecycle status. Normal retrieval defaults to active facts and remains workspace-scoped.
19. Memory is pull-based through bounded tools and carries an advisory warning. The agent evidence order is current source → current tests → current configuration → workspace memory → historical task information. No conversation transcript is stored and no task fact is silently promoted.
20. Task memory is an in-process bounded collection of concise notes, tool names/outcomes, and structured promotion proposals. Tool output/file contents are not duplicated into task memory. Proposals are returned as unsaved values and never write SQLite automatically.
21. Cross-workspace consultation requires a persisted directional grant. The consultation tool returns only bounded query matches plus target/revision provenance and exposes no target write primitive.
22. Cross-workspace modification requires two independent approvals: a persisted directional `modify` relationship and an explicit `--modify-workspace` task scope. Normal workspace tools remain bound to the primary root; external writes use separate scoped tools.
23. Each modified external workspace is tracked independently. Any new patch invalidates its prior verification/diff-review state, and `AgentRunner` rejects final completion until an approved npm verification succeeds and the target Git diff is reviewed.
24. Tool feedback is serialized through a configured character bound before entering model context. Oversized results become valid structured truncation envelopes and are logged. Full reads and searches also enforce file/line limits so context management starts before model invocation.
25. Provider/agent failures emit a terminal local `task_failed` event with counts and duration, then preserve the original failure for the CLI. Logs remain local and omit tool output bodies.
26. Live validation uses a generated, disposable static-site repository with its own clean Git
    baseline and zero runtime dependencies. The source template stays versioned, while generated
    copies live under ignored `.nix/` state. Creation refuses overwrites so prior agent evidence is
    never silently destroyed.

## Future-compatible boundaries

`ModelProvider` is backend-neutral. Workspace IDs and access modes will later support narrow read/consult relationships separately from explicit modify scope. Durable facts will include provenance and freshness metadata, and will never override current source, tests, or configuration.
