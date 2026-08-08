# scripts/ — entry-point index

Each row names one entry-point script, the `deno task` that invokes it, and whether
running the task writes local state. Scripts that write always write under
`state/local/` (content-addressed; immutable once written).

`scripts/lib/cli.ts` is a shared module, not an entry point — it has no task.

## runners/ — write immutable local state

| Script                                                             | Task                                                                                      | Risk  |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----- |
| `runners/attach-coffee-machine-build-run.ts`                       | `thread:attach-coffee-machine-build`                                                      | write |
| `runners/attach-coffee-machine-mechanical-run.ts`                  | `thread:attach-coffee-machine-mechanical`                                                 | write |
| `runners/attach-observed-modelica-run.ts`                          | `thread:attach-modelica`                                                                  | write |
| `runners/close-coffee-machine-cm01-v3-r11.ts`                      | `thread:close-coffee-machine-cm01-v3-r11`                                                 | write |
| `runners/finalize-coffee-machine-cm01-v3-local.ts`                 | `thread:finalize-coffee-machine-cm01-v3-local`                                            | write |
| `runners/materialize-coffee-machine-thread.ts`                     | `thread:assemble`                                                                         | write |
| `runners/recover-coffee-machine-cm01-v3-mechanical-r3-identity.ts` | `thread:recover-coffee-machine-cm01-v3-mechanical-r3-identity`                            | write |
| `runners/run-coffee-machine-build.ts`                              | `thread:run-coffee-machine-build`                                                         | write |
| `runners/run-coffee-machine-cm01-v3-correction.ts`                 | `thread:run-coffee-machine-cm01-v3-correction`                                            | write |
| `runners/run-coffee-machine-cm01-v3-local.ts`                      | `thread:run-coffee-machine-cm01-v3-local` / `thread:run-coffee-machine-cm01-v3-canonical` | write |
| `runners/run-coffee-machine-cm01-v3-mechanical-r3-retry.ts`        | `thread:retry-coffee-machine-cm01-v3-mechanical-r3`                                       | write |
| `runners/run-coffee-machine-mechanical.ts`                         | `thread:run-coffee-machine-mechanical`                                                    | write |

## gates/ — read-only verification; no provider calls, no local writes

| Script                                                    | Task                             | Risk |
| --------------------------------------------------------- | -------------------------------- | ---- |
| `gates/verify-coffee-machine-cm01-v3-correction-loop.ts`  | `verify:cm01-v3-correction-loop` | read |
| `gates/verify-coffee-machine-cm01-v3-golden-reference.ts` | `verify:cm01-v3-golden`          | read |
| `gates/verify-console-evidence.ts`                        | `verify:evidence`                | read |
| `gates/verify-native-workbench-presentation.ts`           | `verify:thread:presentation`     | read |

## probes/ — read-only diagnostic; `thread:capture-syson-inventory` writes a capture

| Script                                    | Task                             | Risk  |
| ----------------------------------------- | -------------------------------- | ----- |
| `probes/capture-syson-model-inventory.ts` | `thread:capture-syson-inventory` | write |
| `probes/probe-constraint-solver.ts`       | `probe:constraint-solver`        | read  |
| `probes/probe-coupled-correction.ts`      | `probe:coupled-correction`       | read  |
| `probes/probe-archive-cascade.ts`         | `probe:archive-cascade`          | read  |

## serve/ — serve local preview; preview:thread and preview:cockpit seed project on first run

| Script                             | Task                                 | Risk |
| ---------------------------------- | ------------------------------------ | ---- |
| `serve/console-browser-harness.ts` | `preview:browser`                    | read |
| `serve/serve-native-workbench.ts`  | `preview:thread` / `preview:cockpit` | read |
