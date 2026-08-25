# How-to: validate a source checkout

Audience: contributor · Diátaxis: how-to · Kind: how-to

Use this guide after cloning the repository or changing source code. It validates the
checked-out Deno sources, UI sources, committed fixtures, and generated Workbench bundle.
It does **not** start the provider fleet, run a local microVM, create an engineering
project, or prove a provider-backed engineering result.

## Prerequisites

- Deno and Node.js versions compatible with the pins in this repository.
- npm available for the Vite UI dependencies.
- No requirement for Docker, SysON, provider credentials, or persisted `state/local/`
  project data.

Run every command from the repository root.

## 1. Record the checkout state

```bash
git status --short
deno --version
node --version
npm --version
```

Do not assume a dirty checkout is a source-validation failure. Record the paths that were
already modified and keep them separate from any validation side effect.

## 2. Install the UI dependencies

```bash
npm ci --prefix src/ui
```

This creates the ignored `src/ui/node_modules/` tree. It does not start the Workbench or
any engineering provider.

## 3. Validate formatting, types, and tests

```bash
deno task fmt
deno task lint
deno task check
deno task check:ui
deno task test
```

`deno task fmt` is check-only. Do not use `deno fmt` as part of validation because that
would rewrite source files. Never report a suite run with `--no-check` as passing source
validation.

## 4. Validate committed evidence contracts and the Workbench build

```bash
deno task verify:evidence
deno task verify:fea:contract
deno task verify:thread:presentation
```

These gates validate checked-in fixtures and build the read-only Workbench presentation.
They still do not contact live providers or prove a live engineering execution.

## 5. Check for validation side effects

```bash
git status --short
```

Compare this output with the state recorded in step 1. Ignored dependency and build
outputs are expected. A new tracked-file change, including a lockfile change, is source
or dependency drift to investigate; do not silently include it in an unrelated change.

## What this validation does not prove

- `docker compose up` succeeds or any published provider image is available.
- SysON, Build123d, CalculiX, Modelica, SPICE, DFM, ERP, or another provider is healthy.
- A digest-pinned local microVM image is built, imported, qualified, or executable.
- Desktop packaging, signing, notarization, lifecycle, or Chat Host integration works.
- Any local project, Thread revision, CAS record, WAL transition, L4 evaluation, or human
  L5 decision exists.

Provider-backed and local-microVM checks are separate integration gates. Keep
`unavailable`, `unresolved`, `documentary`, and other literal states unchanged when those
gates have not run.
