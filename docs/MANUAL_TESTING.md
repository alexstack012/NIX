# Manual testing Nix

This guide starts with checks that do not need a model, then uses a disposable static site for the
first live agent run. The fixture is intentionally separate from the Nix source repository, starts
with a clean Git commit, has no dependencies to install, and is safe to abandon.

## What is already automated

The normal Nix test suite covers workspace containment, traversal attempts, tool validation, safe
editing, command policy, model-response parsing, loop limits, provider failures, Git tools, memory,
and cross-workspace scope. The fixture generator is also tested automatically.

Manual testing is still needed for three things that mocks cannot establish:

1. Whether the chosen local model reliably emits llama.cpp tool calls.
2. Whether performance and context size are acceptable on this workstation.
3. Whether the complete experience produces a sensible change when driven by a real model.

## Stage 0: verify Nix without a model

From the Nix repository in PowerShell:

```powershell
npm test
npm run typecheck
npm run build
npm run dev -- --help
```

All four commands should succeed. This stage is automated during development, so the user normally
does not need to repeat it unless diagnosing a local environment issue.

## Stage 1: start and check the local model

Follow [LOCAL_MODEL.md](LOCAL_MODEL.md). Keep the llama.cpp server in its own PowerShell window. Once
the server reports that it is listening, open another PowerShell window in the Nix repository and
run:

```powershell
npm run dev -- model health
npm run dev -- prompt "Reply with exactly: local model ready"
```

Expected results:

- Health prints that the local server is available.
- The prompt returns a response without contacting a hosted provider.
- `nvidia-smi` shows local GPU memory use while the server is loaded.

If health fails, do not continue to the agent exercise. Record the llama.cpp startup output and the
Nix error first.

## Stage 2: create the disposable app

From the Nix repository:

```powershell
npm run fixture:create
$env:NIX_DATA_DIRECTORY = (Resolve-Path '.\.nix').Path + '\manual-data'
npm run dev -- workspace add .\.nix\manual-test-app --name NixManualTest
npm run dev -- workspace inspect NixManualTest
```

The generator creates `.nix\manual-test-app`, initializes a nested Git repository, commits the
baseline with fixture-only identity settings, and never changes global Git configuration. It refuses
to overwrite a prior fixture. To run the exercise again, choose a new path and workspace name:

```powershell
npm run fixture:create -- .\.nix\manual-test-app-2
npm run dev -- workspace add .\.nix\manual-test-app-2 --name NixManualTest2
```

Confirm the baseline directly:

```powershell
Push-Location .\.nix\manual-test-app
npm test
git status --short
Pop-Location
```

The two tests should pass and Git status should print nothing.

## Stage 3: read-only agent trial

This isolates repository discovery and tool calling from editing. Run from the Nix repository:

```powershell
$task = @'
Inspect this workspace and explain how the profile card is structured. Identify the files you would
change to add a fax field. Do not modify any files. Base the answer on evidence gathered with tools.
'@
npm run dev -- --workspace NixManualTest run $task
```

A good result mentions `index.html`, `src/app.js`, `src/profile.js`, `styles.css`, and the profile
test, while leaving Git clean:

```powershell
git -C .\.nix\manual-test-app status --short
```

Stop here if the model loops, invents file contents, emits malformed tool calls, or changes files.
Capture the task summary and log before trying a different model or prompt.

## Stage 4: controlled edit trial

Use this prompt as written for the first editing run:

```powershell
$task = @'
Add a fax field to the profile card using the existing phone field as the pattern. Use the display
value (312) 555-0199 and a fax link value of fax:+13125550199. Keep the implementation accessible and
consistent with the existing styles. Update or add tests, run npm test, inspect the Git diff, and
report exactly what changed. Do not add dependencies or change unrelated files.
'@
npm run dev -- --workspace NixManualTest run $task
```

A successful run should:

- inspect before editing;
- change the profile data and its test, with no unrelated changes;
- run `npm test` successfully;
- inspect `git diff` before completing;
- report the files changed and verification performed.

Verify independently:

```powershell
Push-Location .\.nix\manual-test-app
npm test
git diff --check
git status --short
git diff
npm run serve
```

Visit `http://127.0.0.1:4173`, confirm the fax row is visible and the layout still looks correct,
then press Ctrl+C and run `Pop-Location`.

## How to write future prompts

Use four parts: outcome, relevant constraints, verification, and report. Describe the behavior you
want rather than prescribing every file edit. For example:

```text
Add a high-contrast theme toggle that remembers the user's choice. Keep the current visual style,
use browser APIs only, and do not add dependencies. Add tests for the state logic, run npm test,
review the Git diff for regressions, and report the changed files and test result.
```

For the first few trials, keep tasks small and explicit. Always request tests and diff review. Avoid
real repositories until Nix has completed both fixture trials reliably.

## What to send back when something fails

Share these items; do not include secrets or unrelated source code:

- model repository/name and quantization;
- llama.cpp version and complete startup command with local paths shortened if desired;
- whether `model health` and the one-line prompt worked;
- Nix task ID, iteration/tool/error counts, and terminal error;
- the corresponding JSONL log from `.nix\manual-data\logs`;
- `git status --short` and the relevant `git diff` from the fixture;
- approximate response speed and GPU/RAM use if performance is the issue.

The test result is still useful if Nix fails. A malformed call, premature completion, loop-limit
stop, or bad edit gives concrete evidence for the next provider/parser/prompt adjustment.
