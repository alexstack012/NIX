# Nix contributor guide

Nix is a local-first coding agent. Its basic operation must never require a hosted AI API, hosted database, or telemetry service.

## Working priorities

1. Preserve a working, tested coding loop before adding memory or multi-workspace features.
2. Keep model access behind `ModelProvider`; never couple agent logic to llama.cpp.
3. Restrict every filesystem operation to the selected workspace.
4. Route commands through permission classification and deny dangerous commands by default.
5. Prefer Node.js APIs over shell-specific behavior, especially for Windows compatibility.
6. Keep dependencies small and the agent loop understandable.

## Required continuity practice

- Read `docs/ARCHITECTURE.md`, `docs/PROGRESS.md`, and `docs/NEXT_STEPS.md` before starting work.
- Update `docs/PROGRESS.md` before a large phase and after each meaningful milestone.
- Record architectural decisions in `docs/ARCHITECTURE.md`.
- Keep `docs/NEXT_STEPS.md` actionable whenever work remains.
- Run tests, typecheck/build, and inspect the Git diff at each completed milestone.

## Safety constraints

- Do not push, force-push, rewrite history, run `git reset --hard`, or auto-commit.
- Do not access `.git` internals, dependency directories, or paths outside the active workspace through agent tools.
- Do not add cloud fallbacks. A failed local provider must fail clearly and locally.
- Do not log secrets or send telemetry.

## Common development commands

```text
npm install
npm test
npm run typecheck
npm run build
npm run lint
npm run dev -- --help
```
