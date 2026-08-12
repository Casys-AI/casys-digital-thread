# scripts/ — entry-point index

Each row names one entry-point script, the `deno task` that invokes it, and whether
running the task writes local state. Scripts that write always write under
`state/local/` (content-addressed; immutable once written).

`scripts/lib/cli.ts` is a shared module, not an entry point — it has no task.

## runners/ — write immutable local state

There are currently no runnable local-state writers. Provider-backed engineering writes
are admitted through registered MCP operations; their immutable records remain under
`state/local/`.

## gates/ — read-only verification; no provider calls, no local writes

| Script                                          | Task                                              | Risk  |
| ----------------------------------------------- | ------------------------------------------------- | ----- |
| `gates/verify-console-evidence.ts`              | `verify:evidence`                                 | read  |
| `gates/verify-native-workbench-presentation.ts` | `verify:thread:presentation`                      | read  |
| `gates/fea-provider-smoke-inputs.ts`            | `capture:fea:contract-golden` / `verify:fea:live` | read  |
| `gates/fea-build123d-cleanup.ts`                | `capture:fea:contract-golden` / `verify:fea:live` | read  |
| `gates/fea-contract-capture-lifecycle.ts`       | `capture:fea:contract-golden`                     | write |
| `gates/verify-fea-provider-contract.ts`         | `verify:fea:contract`                             | read  |
| `gates/capture-fea-contract-golden.ts`          | `capture:fea:contract-golden`                     | write |
| `gates/verify-fea-live-smoke.ts`                | `verify:fea:live`                                 | write |

## probes/ — read-only diagnostic; `thread:capture-syson-inventory` writes a capture

| Script                                    | Task                             | Risk  |
| ----------------------------------------- | -------------------------------- | ----- |
| `probes/capture-syson-model-inventory.ts` | `thread:capture-syson-inventory` | write |
| `probes/probe-constraint-solver.ts`       | `probe:constraint-solver`        | read  |
| `probes/probe-archive-cascade.ts`         | `probe:archive-cascade`          | read  |
| `probes/probe-requirement-units.ts`       | `probe:requirement-units`        | write |

## serve/ — serve local preview; preview:thread and preview:cockpit start focus-first

| Script                             | Task                                 | Risk  |
| ---------------------------------- | ------------------------------------ | ----- |
| `serve/console-browser-harness.ts` | `preview:browser`                    | read  |
| `serve/serve-native-workbench.ts`  | `preview:thread` / `preview:cockpit` | read  |
| `serve/supervise-agent-stack.ts`   | `start:agent`                        | write |
