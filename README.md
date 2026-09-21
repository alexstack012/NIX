# Nix

Nix is a local-first AI coding agent designed to run against a local inference server and locally stored model weights. Its core operation has no hosted AI API or telemetry dependency.

The project is under active incremental development. See [docs/PROGRESS.md](docs/PROGRESS.md) for the exact working state and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions.

## Development

Requires Node.js 24 or newer. Workspace memory uses Node's built-in `node:sqlite` module; current Node releases may print an experimental-feature warning when memory is opened.

```text
npm install
npm test
npm run build
npm run dev -- --help
```

Local configuration may be stored in an ignored `nix.config.json` or supplied through the `NIX_*` environment variables shown by `nix-agent --help`.

## Registered workspaces

Workspace metadata is stored locally in `%USERPROFILE%\.nix-agent\workspaces.json` on Windows by default. Override the location with `NIX_DATA_DIRECTORY`.

```text
npm run dev -- workspace add C:\repos\StackApply --name StackApply
npm run dev -- workspace list
npm run dev -- workspace inspect StackApply
npm run dev -- --workspace StackApply run "Inspect the repository and explain its CLI."
npm run dev -- workspace remove StackApply
```

Names are case-insensitive. Registered paths are canonicalized, must exist, and must be unique. Removing a registry entry never deletes the repository.

## Workspace memory

Memory consists of concise, sourced facts scoped to a registered workspace. Current source, tests, and configuration always outrank stored memory.

```text
npm run dev -- --workspace StackApply memory add "Profile storage is independent of scanner classification." --kind architecture --source docs/ARCHITECTURE.md --confidence 0.9
npm run dev -- --workspace StackApply memory search "scanner classification"
npm run dev -- --workspace StackApply memory list --kind architecture
```

Supported kinds are `architecture`, `convention`, `decision`, `known_issue`, and `dependency`. Facts may be marked `active`, `deprecated`, or `superseded`. Nix does not store conversation transcripts or silently promote task context.

## Cross-workspace work

Consultation and modification are directional and denied by default:

```text
npm run dev -- workspace allow-consult StackApply PaymentAPI
npm run dev -- workspace allow-modify StackApply PaymentAPI

npm run dev -- --workspace StackApply run "Consult PaymentAPI for its subscription contract."
npm run dev -- --workspace StackApply --modify-workspace PaymentAPI run "Update both sides of the subscription contract and verify them."
```

`--modify-workspace` is explicit per-task scope and also requires a persisted modify grant. External changes use dedicated scoped tools. Once an external workspace is modified, Nix refuses to complete until that workspace has a successful approved verification command and a reviewed Git diff.
