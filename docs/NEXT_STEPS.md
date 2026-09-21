# Next steps

## Immediate

1. Follow `docs/MANUAL_TESTING.md`: start the selected local model, check health/basic prompting,
   generate the disposable static app, and run the read-only trial.
2. Run the controlled fax-field edit against the fixture and record tool-call compatibility, context
   limits, speed, and failure modes. Adjust prompts/provider parsing only from evidence.
3. Improve command approval UX (`allow once` / configured `always allow`) before permitting write-category commands.
4. Add optional llama.cpp start/stop/idle lifecycle management after executable and model paths are chosen.
5. Add organization/project dependency metadata on top of the relationship registry if real workflows need richer graph queries.

The implementation roadmap through Milestone 12 is complete. Items above are validation and optional product hardening, not missing core milestones.

## Known limitations

- No local llama.cpp server/model is currently configured, so live model quality and tool-call
  formatting have not been validated. The fixture and exact staged instructions are now available.
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
