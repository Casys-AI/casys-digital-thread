# scripts/ — entry-point index

Each row names one entry-point script, the `deno task` that invokes it, and whether
running the task writes local state. Scripts that write always write under
`state/local/` (content-addressed; immutable once written).

`scripts/lib/cli.ts` is a shared module, not an entry point — it has no task.

## runners/ — write immutable local state

| Script                                                             | Task                                                                                      | Risk  |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----- |
| `runners/close-coffee-machine-cm01-v3-r11.ts`                      | `thread:close-coffee-machine-cm01-v3-r11`                                                 | write |
| `runners/finalize-coffee-machine-cm01-v3-local.ts`                 | `thread:finalize-coffee-machine-cm01-v3-local`                                            | write |
| `runners/recover-coffee-machine-cm01-v3-mechanical-r3-identity.ts` | `thread:recover-coffee-machine-cm01-v3-mechanical-r3-identity`                            | write |
| `runners/run-coffee-machine-cm01-v3-correction.ts`                 | `thread:run-coffee-machine-cm01-v3-correction`                                            | write |
| `runners/run-coffee-machine-cm01-v3-local.ts`                      | `thread:run-coffee-machine-cm01-v3-local` / `thread:run-coffee-machine-cm01-v3-canonical` | write |
| `runners/run-coffee-machine-cm01-v3-mechanical-r3-retry.ts`        | `thread:retry-coffee-machine-cm01-v3-mechanical-r3`                                       | write |

## gates/ — read-only verification; no provider calls, no local writes

| Script                                                    | Task                             | Risk  |
| --------------------------------------------------------- | -------------------------------- | ----- |
| `gates/verify-coffee-machine-cm01-v3-correction-loop.ts`  | `verify:cm01-v3-correction-loop` | read  |
| `gates/verify-coffee-machine-cm01-v3-golden-reference.ts` | `verify:cm01-v3-golden`          | read  |
| `gates/verify-console-evidence.ts`                        | `verify:evidence`                | read  |
| `gates/verify-native-workbench-presentation.ts`           | `verify:thread:presentation`     | read  |
| `gates/verify-fea-provider-contract.ts`                   | `verify:fea:contract`            | read  |
| `gates/capture-fea-contract-golden.ts`                    | `capture:fea:contract-golden`    | write |
| `gates/verify-fea-live-smoke.ts`                          | `verify:fea:live`                | write |

## probes/ — read-only diagnostic; `thread:capture-syson-inventory` writes a capture

| Script                                    | Task                             | Risk  |
| ----------------------------------------- | -------------------------------- | ----- |
| `probes/capture-syson-model-inventory.ts` | `thread:capture-syson-inventory` | write |
| `probes/probe-constraint-solver.ts`       | `probe:constraint-solver`        | read  |
| `probes/probe-coupled-correction.ts`      | `probe:coupled-correction`       | read  |
| `probes/probe-archive-cascade.ts`         | `probe:archive-cascade`          | read  |
| `probes/probe-requirement-units.ts`       | `probe:requirement-units`        | write |

## serve/ — serve local preview; preview:thread and preview:cockpit seed project on first run

| Script                             | Task                                 | Risk  |
| ---------------------------------- | ------------------------------------ | ----- |
| `serve/console-browser-harness.ts` | `preview:browser`                    | read  |
| `serve/serve-native-workbench.ts`  | `preview:thread` / `preview:cockpit` | read  |
| `serve/supervise-agent-stack.ts`   | `start:agent`                        | write |
