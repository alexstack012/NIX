# Progress

## Current milestone

Live-model validation preparation (complete)

- [x] Add a disposable, zero-dependency static-site fixture generator
- [x] Add automated coverage for fixture creation, baseline tests, Git cleanliness, and overwrite refusal
- [x] Document staged manual testing, copy-paste prompts, expected outcomes, and troubleshooting
- [x] Refresh local llama.cpp setup guidance from current official documentation
- [x] Run the full project verification suite and inspect the Git state

## Last known state

Milestones 0–12 are complete. The requested implementation roadmap is represented end to end: local provider, safe coding loop, repository map, registry, structured memory, task proposals, consultation, and explicitly scoped coordinated modification.

## Work about to begin

Implementation is ready for live local-model validation. A generated test app now provides a
reproducible read-only trial and controlled edit trial without risking a real repository. The next
action requires the user to select/start a local model and follow `docs/MANUAL_TESTING.md`.

## Verification log

- 2026-09-20 Milestone 0: `npm install` succeeded.
- 2026-09-20 Milestone 0: `npm test` passed (3 tests).
- 2026-09-20 Milestone 0: `npm run typecheck`, `npm run build`, `npm run lint`, and `npm run format:check` passed.
- 2026-09-20 Milestone 0: `npm run dev -- --help` launched successfully.
- 2026-09-20 Milestone 0: production dependency audit reported 0 vulnerabilities. npm reported 2 moderate advisories in development tooling; no breaking automatic audit fix was applied.
- 2026-09-20 Milestone 0: `git status` showed only the expected new project files; `git diff --check` passed.
- 2026-09-20 Milestone 1: `npm test` passed (7 tests); typecheck, build, and lint passed.
- 2026-09-20 Milestone 1: mocked HTTP tests covered health, chat/tool-call normalization, malformed tool arguments, and server unavailability.
- 2026-09-20 Milestone 1: live `model health` correctly reported the absent server at `127.0.0.1:8080` and exited nonzero without fallback.
- 2026-09-20 Milestone 1: setup instructions recorded in `docs/LOCAL_MODEL.md`; no model weights were downloaded.
- 2026-09-20 Milestone 2: `npm test` passed (16 tests); typecheck, build, and lint passed.
- 2026-09-20 Milestone 2: traversal, absolute paths, `.git`, `node_modules`, validation, duplicate registration, file range, search, and ignored-directory behavior are tested.
- 2026-09-20 Milestone 2: the built registry successfully inspected this repository using `list_directory`, `search_text`, and `git_status`.
- 2026-09-20 Milestone 3: `npm test` passed (19 tests); typecheck, build, formatting, and agent-loop behavior passed.
- 2026-09-20 Milestone 3: tests prove tool-result round trips, recoverable tool errors, and exact maximum-iteration stopping.
- 2026-09-20 Milestone 3: `run` uses the configured local provider, selected workspace, read-only registry, and local JSONL logger; no telemetry or cloud fallback exists.
- 2026-09-20 Milestone 4: `npm test` passed (21 tests); typecheck and build passed.
- 2026-09-20 Milestone 4: create, overwrite refusal, write, unique exact patch, ambiguous patch refusal, traversal denial, and modified-file tracking are tested.
- 2026-09-20 Milestone 5: `npm test` passed (30 tests); typecheck, build, and lint passed.
- 2026-09-20 Milestone 5: command classification covers safe verification, approval-required dependency mutations, destructive Git/package/system denial, and unknown commands.
- 2026-09-20 Milestone 5: an allowlisted command executed with captured stdout, exit code, timing, and timeout state; denied commands were not spawned.
- 2026-09-20 Milestone 6 (first major success): the controlled loop inspected `math.mjs`, patched its defect, ran its real passing `npm test`, read a real Git diff, tracked `math.mjs`, and reported completion in 5 iterations / 4 tool calls / 0 errors.
- 2026-09-20 Milestone 6: Windows npm execution was corrected to invoke `npm-cli.js` through Node while retaining `shell: false`.
- 2026-09-20 Milestone 6: `npm test` passed (31 tests across 7 files).
- 2026-09-20 Milestone 7: `npm test` passed (32 tests across 8 files); typecheck, lint, build, and formatting passed.
- 2026-09-20 Milestone 7: self-map benchmark scanned 42 relevant non-ignored files, mapped 29 source files, and returned 1 file for the `AgentRunner` query without truncation.
- 2026-09-20 Milestone 7: Git status contains only expected new project files. This repository has no baseline commit, so a conventional project-wide `git diff` is not yet available; the controlled Milestone 6 fixture verifies real diff review.
- 2026-09-20 Milestone 8: `npm test` passed (36 tests across 9 files); typecheck, lint, build, formatting, and CLI help passed.
- 2026-09-20 Milestone 8: registry tests cover persistence, canonical paths, stable IDs, case-insensitive lookup/removal, sorted listing, duplicate names/paths, invalid names, and malformed storage.
- 2026-09-20 Milestone 8: a CLI subprocess launched outside the registered repository successfully completed add → list → inspect → remove.
- 2026-09-20 Milestone 8: default registry/log storage is local under `%USERPROFILE%\.nix-agent`; `NIX_DATA_DIRECTORY` provides an explicit override.
- 2026-09-20 Milestone 9: `npm test` passed (40 tests across 10 files); typecheck, lint, build, formatting, and CLI help passed.
- 2026-09-20 Milestone 9: SQLite tests cover persistence, workspace isolation, source/commit/confidence/status metadata, kind/status filters, literal wildcard search, invalid facts, and scoped removal.
- 2026-09-20 Milestone 9: the CLI integration test completes registered workspace add → memory add → memory search → memory remove across separate processes.
- 2026-09-20 Milestone 9: agent tools expose bounded list/search retrieval with an advisory warning; the system prompt ranks current source, tests, and configuration above workspace memory.
- 2026-09-20 Milestone 9: memory schema version 1 uses Node 24's built-in SQLite implementation. Normal non-memory CLI commands lazy-load SQLite and do not emit its experimental warning.
- 2026-09-21 Milestone 10: `npm test` passed (44 tests across 11 files); typecheck and build passed.
- 2026-09-21 Milestone 10: bounded notes/tool summaries, malformed proposal rejection, proposal return, and durable non-promotion are tested.
- 2026-09-21 Milestone 10: completed CLI runs print proposed workspace memory as explicitly “not saved”; acceptance remains the explicit `memory add` operation.
- 2026-09-21 Milestone 11: `npm test` passed (46 tests across 12 files); typecheck, lint, and build passed.
- 2026-09-21 Milestone 11: relationship and CLI tests cover directional grant/list/revoke, duplicate idempotence, denied access, and reverse-direction denial.
- 2026-09-21 Milestone 11: consultation returns bounded repository-map, text, and memory matches with target identity, inspection time, and exact Git commit; the target file remains unchanged.
- 2026-09-21 Milestone 12: `npm test` passed (48 tests across 13 files); typecheck, lint, build, and formatting passed.
- 2026-09-21 Milestone 12: persistent modify grants are distinct from consult grants, and `--modify-workspace` supplies additional explicit per-task scope.
- 2026-09-21 Milestone 12: a controlled external repository patch could not complete early; the loop required a passing `npm test` and Git diff review, then returned tracked target files and verification state.
- 2026-09-21 Milestone 12: out-of-scope targets, consult-only modification, and unapproved verification commands are denied.
- 2026-09-21 hardening: failed provider runs now emit `task_failed` with error count, tool count, and duration before rethrowing.
- 2026-09-21 hardening: configured context characters bound each serialized tool result; oversized results become valid truncation envelopes and emit a truncation log event.
- 2026-09-21 hardening: full reads reject files over 500 KB, ranged reads stream at most 2,000 lines, and text search skips files over 2 MB.
- 2026-09-21 final verification: `npm test` passed (51 tests across 13 files); typecheck, build, lint, formatting, CLI help, resolved configuration, and `git diff --check` passed. Production dependency audit reports 0 vulnerabilities.
- 2026-09-21 live-validation preparation: added `npm run fixture:create`, a zero-dependency static
  profile app, an isolated Git baseline, copy-paste read/edit prompts, expected outcomes, and failure
  capture instructions.
- 2026-09-21 fixture verification: the real generator created `.nix/manual-test-app`; its 2 Node
  tests passed and its nested Git repository was clean. Automated coverage also proves creation,
  baseline tests, cleanliness, and overwrite refusal.
- 2026-09-21 validation-prep issue resolved: the first full Vitest run discovered Node's fixture
  tests as Vitest suites. Root test scripts are now explicitly scoped to `tests`, preserving fixture
  tests for their own `node --test` runner.
- 2026-09-21 validation-prep final verification: `npm test` passed (52 tests across 14 files);
  typecheck, build, lint, and formatting passed. Root Git status contains only expected project files;
  generated `.nix/` test state remains ignored.

## Important commands

```text
npm install
npm test
npm run typecheck
npm run build
npm run lint
npm run dev -- --help
npm run fixture:create
```
