# Next steps

## Immediate

1. Follow `docs/MANUAL_TESTING.md`: start the selected local model, check health/basic prompting,
   generate the disposable static app, and run the read-only trial.
2. Run the controlled fax-field edit against the fixture and record tool-call compatibility, context
   usage, speed, malformed-call recoveries, verification gating, and failure modes. Compare
   Qwen3-Coder-30B-A3B-Instruct with Devstral Small 2 using the same prompts.
3. Tune prompts, parsing, and context limits only from captured live traces. Consider deterministic
   old read-result compaction only if total context is a demonstrated constraint.
4. Improve command approval UX (`allow once` / configured `always allow`) before permitting
   write-category commands.

The implementation roadmap through Milestone 12 is complete. Items above are validation and optional product hardening, not missing core milestones.

## Known limitations

- No local llama.cpp server/model is currently configured, so live model quality and tool-call
  formatting have not been validated. The fixture and exact staged instructions are now available.
- Primary verification discovery currently recognizes safe npm scripts in root `package.json`.
  Other ecosystems will require explicit safe-command support before they can be mechanically
  verified.
- Total context uses a conservative character estimate and stops at the configured limit; it does
  not yet compact old history or use model-specific tokenization.
- The repository map is lexical and may miss complex or language-specific declarations.
- The CLI has no interactive approval flow; write-category and unknown commands return `COMMAND_APPROVAL_REQUIRED`.
- Node 24 currently labels its built-in SQLite module experimental and prints a warning when a memory-enabled command opens the database.
- Model-server lifecycle control and one-command proposal acceptance are not yet implemented.
- External coordinated writes currently support unique exact-text patches; creating new files in target workspaces is intentionally not exposed yet.

## Resume checklist

1. Read `AGENTS.md` and all files in `docs/`.
2. Run `git status --short --branch` if Git has been initialized.
3. Run `npm test`, `npm run typecheck`, and `npm run build`.
4. Continue from the first unchecked item in `docs/PROGRESS.md`.

## Known blockers

- No local llama.cpp server or model path has been provided, so live inference validation requires the user to select/download a model and start llama.cpp.
