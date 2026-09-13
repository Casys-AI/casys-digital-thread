# Contributing

Casys Digital Thread is an active alpha project. Contributions are welcome, but
the repository's authority and evidence boundaries are part of the product contract.
Small, reviewable changes are preferred.

## Start with the authority model

Before changing code or documentation, read:

1. [AGENTS.md](AGENTS.md) for the non-negotiable division of responsibility between the
   human, agent, server, and Workbench.
2. [The agent workspace reference](docs/reference/agent/agent-workspace.md) for repository
   ownership, registered operations, and evidence stores.
3. [The analysis authority pipeline](docs/reference/pipeline/analysis-authority-pipeline.md)
   when a change affects capture, analysis, MRTR, dispatch, or recovery.

In particular:

- agents may propose and execute registered operations, but do not choose providers,
  tools, arguments, lowering, or runtimes;
- consequential engineering decisions remain human decisions;
- the server owns sequencing, profiles, parsing, lowering, and recovery;
- the Workbench remains a read-only `GET` and SSE projection;
- states such as `unavailable`, `unresolved`, `provisional`, `unverified`, `TRACE GAP`,
  and `UNLINKED` must remain literal.

Engineering provider servers live in separate repositories and run from published
images. Change a provider in its own repository. A change belongs here only when it
affects this workspace's contracts, registered integration, control plane, persistence,
Workbench, Desktop shell, or local worker definitions.

## First contribution path

Follow this sequence for a first change. Agents start with [AGENTS.md](AGENTS.md). The
[documentation index](docs/README.md) routes how-to and reference pages by goal. The
[task catalog](docs/reference/runtime/task-catalog.md) lists every registered
`deno.json` task and when to use it.

### 1. Clone and install

```bash
git clone https://github.com/Casys-AI/casys-digital-thread.git
cd casys-digital-thread
npm --prefix src/ui ci
```

Use Deno and Node.js versions compatible with repository CI (currently Deno 2.9.2 and
Node.js 24). Docker is not required for the contributor gates below.

### 2. Validate the checkout

```bash
deno task verify
```

This is the contributor entry command. It runs `fmt`, `lint`, `check`, `check:ui`,
`test`, then `verify:docs`. `fmt` is check-only; do not use `deno fmt` as validation,
because that rewrites files. This entry command is intentionally narrower than full
source validation and CI: it does not run `verify:evidence`,
`verify:thread:presentation`, or `verify:task-catalog`. See
[Validate a source checkout](docs/how-to/setup/validate-a-source-checkout.md) for
those source gates.

### 3. Make one focused change

Keep the pull request to one behavioral or documentation concern. Add or update the
smallest test that proves the changed behavior. Update living documentation when a
public contract, command, or workflow changes. Do not combine formatting, generated
output, broad renames, and behavioral changes in one pull request.

### 4. Re-run the contributor gates

```bash
deno task verify
```

Documentation-only changes may stop at `deno task verify:docs`. A `deno.json` task
change also needs `deno task verify:task-catalog`. Changes to committed fixtures or
the Workbench presentation also need `deno task verify:evidence` and
`deno task verify:thread:presentation` from the source-checkout how-to. Provider
and microVM checks are not part of this path; if a relevant one cannot run, state
that fact and the exact reason.

### 5. Open a pull request

Use the checklist below. Confirm the authority model is preserved, tests cover the
material risk, documentation links pass, and the diff contains no secrets, local state,
generated output, or unrelated edits.

## Propose a focused change

- Keep each pull request limited to one behavioral or documentation concern.
- Explain the user-visible or contract-level outcome, not only the implementation.
- Add or update the smallest test that proves the changed behavior.
- Update living documentation when a public contract, command, or workflow changes.
- Do not combine formatting, generated output, broad renames, and behavioral changes in
  one pull request.
- Treat unexported internal planning history as non-authoritative over current code and
  reference documentation.

For a substantial new capability or a change to an authority boundary, open a focused
issue first. Maintainers may ask that the design be narrowed or documented before code is
reviewed.

## Keep private and generated material out of Git

Never commit:

- `.env` files, API keys, MRTR signing keys, tokens, certificates, or credentials;
- anything under `state/local/`, including real projects, CAS objects, WAL records,
  receipts, captures, or execution evidence;
- customer, partner, or otherwise confidential engineering data;
- local CAD exports, solver outputs, provider volumes, `node_modules/`, or build output;
- private provider configuration or registry credentials.

Examples must be synthetic or explicitly cleared for public redistribution. Remove
identifiers and sensitive values before attaching logs to an issue or pull request.

## Validate the change

Run checks proportionate to the change. For a typical code change, the contributor
entry command is:

```bash
deno task verify
```

It chains the repository gates in this order:

```bash
deno task fmt
deno task lint
deno task check
deno task check:ui
deno task test
deno task verify:docs
```

This entry command stays intentionally narrower than the source-checkout how-to and
CI: it does not run `verify:evidence`, `verify:thread:presentation`, or
`verify:task-catalog`. Those source gates run in
[Validate a source checkout](docs/how-to/setup/validate-a-source-checkout.md) and
the Quality workflow.

Documentation-only changes must at least run:

```bash
deno task verify:docs
```

Adding, removing, or renaming a `deno.json` task also requires
`deno task verify:task-catalog` and an update to the
[task catalog](docs/reference/runtime/task-catalog.md).

Some provider and microVM checks require local images or live services and are not part
of every pull request. If a relevant check cannot run, state that fact and the exact
reason; do not report it as passing.

## Pull request checklist

Before requesting review, confirm that:

- the change preserves the documented authority model;
- no caller can select an unregistered provider, tool, argument set, or runtime;
- evidence and execution claims match what was actually persisted and reread;
- unavailable or unresolved states have not been hidden;
- tests cover the material risk of the change;
- documentation links pass the documentation gate;
- the diff contains no secrets, local state, generated output, or unrelated edits.

## License

The repository is licensed under the
[GNU Affero General Public License v3.0 only (AGPL-3.0-only)](LICENSE). By submitting a
contribution, you confirm that you have the right to submit it and agree that it may be
distributed under that licence.
