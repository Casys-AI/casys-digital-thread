# scripts/ — entry-point index

Each row names one entry-point script, the `deno task` that invokes or statically checks
it, and its observable effect. `Direct invocation` means that no runnable task is
registered for that script. Durable application captures are written under
`state/local/`; worker build and preflight scripts may instead create temporary files or
local container images as stated below.

`scripts/lib/cli.ts` is a shared module, not an entry point — it has no task.

## runners/ — write immutable local state

There are currently no runnable local-state writers. Provider-backed engineering writes
are admitted through registered MCP operations; their immutable records remain under
`state/local/`.

## gates/ — verification and qualification entry points

The `*-worker.ts` gates qualify a worker in isolation. Build123d does so directly in a
microVM; the Modelica and CalculiX worker gates are Docker preflights. None proves the
brokered composition-to-CAS vertical. Only the corresponding `*-vertical.ts` gates
exercise that complete local microVM path end to end.

| Script                                            | Task or registration                                                         | Effect     | Scope                                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| `gates/verify-console-evidence.ts`                | `verify:evidence`                                                            | read       | Verify persisted console evidence.                                                                   |
| `gates/verify-native-workbench-presentation.ts`   | `verify:thread:presentation`                                                 | read       | Verify the built native-workbench presentation.                                                      |
| `gates/fea-provider-smoke-inputs.ts`              | `capture:fea:contract-golden` / `verify:fea:live`                            | read       | Prepare bounded provider smoke inputs.                                                               |
| `gates/fea-build123d-cleanup.ts`                  | `capture:fea:contract-golden` / `verify:fea:live`                            | read       | Check Build123d cleanup for the provider smoke.                                                      |
| `gates/fea-contract-capture-lifecycle.ts`         | `capture:fea:contract-golden`                                                | write      | Manage the local golden-capture lifecycle.                                                           |
| `gates/verify-fea-provider-contract.ts`           | `verify:fea:contract`                                                        | read       | Verify the captured FEA provider contract.                                                           |
| `gates/capture-fea-contract-golden.ts`            | `capture:fea:contract-golden`                                                | write      | Capture the golden FEA provider contract.                                                            |
| `gates/verify-fea-live-smoke.ts`                  | `verify:fea:live`                                                            | write      | Run the live provider smoke and capture its evidence.                                                |
| `gates/verify-build123d-microsandbox-worker.ts`   | `check` (static check); direct invocation to run                             | temp/image | Direct Build123d worker microVM qualification; not the broker/composition/CAS vertical.              |
| `gates/verify-build123d-microsandbox-vertical.ts` | `verify:build123d:microsandbox:vertical`                                     | temp       | Run the digest-pinned local microVM, broker, CAS, STEP validation, and cleanup vertical.             |
| `gates/verify-modelica-microsandbox-worker.ts`    | `check:modelica-isolated-execution` (static check); direct invocation to run | temp/image | Docker deny-all OMC worker preflight; not a microVM vertical.                                        |
| `gates/verify-modelica-microsandbox-vertical.ts`  | `verify:modelica:microsandbox:vertical`                                      | write      | Run the digest-pinned local microVM vertical and publish its durable qualification capture.          |
| `gates/build-calculix-worker-candidate.ts`        | `check:calculix-isolated-execution` (static check); direct invocation to run | image      | Build the local CalculiX worker candidate with the reviewed wrapper digest.                          |
| `gates/verify-calculix-microsandbox-worker.ts`    | `check:calculix-isolated-execution` (static check); direct invocation to run | temp/image | Docker-isolated native CalculiX worker preflight; not a microVM vertical.                            |
| `gates/verify-calculix-microsandbox-vertical.ts`  | `verify:calculix:microsandbox:vertical`                                      | temp       | Run the digest-pinned local microVM, broker, CAS, external validation, replay, and cleanup vertical. |

## probes/ — read-only diagnostic; `thread:capture-syson-inventory` writes a capture

| Script                                      | Task                             | Risk  |
| ------------------------------------------- | -------------------------------- | ----- |
| `probes/capture-build123d-api-inventory.ts` | (direct `deno run`)              | write |
| `probes/capture-syson-model-inventory.ts`   | `thread:capture-syson-inventory` | write |
| `probes/mcp-call.ts`                        | `mcp:call`                       | write |
| `probes/probe-constraint-solver.ts`         | `probe:constraint-solver`        | read  |
| `probes/probe-archive-cascade.ts`           | `probe:archive-cascade`          | read  |
| `probes/probe-requirement-units.ts`         | `probe:requirement-units`        | write |

## serve/ — serve local preview; preview:thread and preview:cockpit start focus-first

| Script                             | Task                                 | Risk  |
| ---------------------------------- | ------------------------------------ | ----- |
| `serve/console-browser-harness.ts` | `preview:browser` (retired; refuses) | read  |
| `serve/serve-native-workbench.ts`  | `preview:thread` / `preview:cockpit` | read  |
| `serve/supervise-agent-stack.ts`   | `start:agent`                        | write |
