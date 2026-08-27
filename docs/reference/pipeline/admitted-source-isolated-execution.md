# Reference: admitted source → isolated microVM

Audience: agent · Diátaxis: reference · Kind: contract

This is the recurrent hexagonal pattern for executing **agent-authored closed-subset
source** that has already been sealed by `compile.seal-admission@3`. It is not a
provider MCP path and not a kit.

Lookalikes: [lookalike traps](../agent/lookalike-traps.md). File locations:
[compile source map](../codebase/compile.md). Capture → admission:
[analysis authority pipeline](analysis-authority-pipeline.md). Isolation narrative:
[compilation and isolation](compilation-and-isolation.md). Product walks:
[run admitted Modelica](../../how-to/run/run-admitted-modelica.md),
[run admitted SPICE](../../how-to/run/run-admitted-spice.md).

## Pattern

```text
compile.seal-admission@3
  -> ReopenAdmittedCompilationSource
  -> isolatedRequestFromAdmittedSource
  -> IsolatedCodeRunner
       -> fail-closed broker
            -> EphemeralExecutionBackend (digest-pinned OCI microVM)
            -> language-owned output validator
            -> publication-gated output CAS
  -> language-owned WAL + documentary Thread evidence
```

The shared use case reopens the sealed admission and returns exact source bytes. It does
not execute, select a worker, or grant MRTR. Language executors own the documentary
Thread shape after the runner returns.

Callers never pass source text, a provider name, a command, or a runtime alias. The
server owns the profile, image digest, wrapper, paths, policy, and limits.

`project_resource_capture` is draft MCP-resource ingress only. Public small-file
captures now take that full `resourceRef`, reopen exact UTF-8, then reuse the existing
parser/canonicalizer. Do not pass its raw CAS URI to a microVM. Isolated execution still
starts from `compile.seal-admission@3` via `ReopenAdmittedCompilationSource`.

## Consumers

| Language  | Review tool                            | Operation                          | What a success is                                     | What it is not                           |
| --------- | -------------------------------------- | ---------------------------------- | ----------------------------------------------------- | ---------------------------------------- |
| Build123d | `project_build123d_execution_review`   | `design.execute-build123d@1`       | Documentary capture + noncanonical STEP draft         | Canonical geometry / FEA `geometry`      |
| Modelica  | `project_admitted_modelica_run_review` | `simulate.run-admitted-modelica@1` | Documentary capture + `evidence.json` + `result.csv`  | The pinned kit, recorded `@2`, a verdict |
| SPICE     | `project_admitted_spice_run_review`    | `simulate.run-admitted-spice@1`    | Documentary capture + `evidence.json` + `result.json` | mcp-spice, LED-driver fiche, a verdict   |

Both bind one `compilationAdmission` artifact. Both refuse extra source-text bindings.
The run-review result returns the registered operation already bound to that artifact on
the current Thread tip; reuse it verbatim. Do not reconstruct the binding from a
historical `compile.seal-admission@3` creation snapshot.

## Not this pattern

| Lookalike                                  | Why it is different                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `simulate.run-qualified-modelica-kit@1`    | Image smoke. Worker ENTRYPOINT pins one LinearThermalRamp kit. Empty bindings. No caller `.mo`. |
| `simulate.run-modelica-scenario@1`/`@2`    | Retired recorded-provider route. Not registered. Not a fallback.                                |
| `verify.run-fea-static-proof@3`            | Isolated CalculiX. Agent never writes `.inp`. Server lowers a sealed proof + STEP.              |
| `design.write-geometry@1`                  | Canonical STEP seal of admitted export. Not isolated execution.                                 |
| Caller `modelicaText` / CAD script in MRTR | Refused. Source comes only from the sealed admission.                                           |

## One Modelica image family

There is one image name: `casys/modelica-microsandbox-worker`. Do not invent a second
image (`closed-subset-worker` or similar).

| Worker                                                 | Selected how                              | Source bytes                                      | Qualification                        |
| ------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------- | ------------------------------------ |
| `/opt/casys/profiles/modelica-qualified-kit-v1/run.ts` | Image `ENTRYPOINT`. Kit `@1` composition. | Pinned kit `.mo` inside the image                 | Digest `7d3fdeabe794…` (unchanged)   |
| `/opt/casys/profiles/modelica-closed-subset-v2/run.ts` | Backend args in the admitted composition. | Generic bounded `/input/source.mo` from admission | Separate local pin (see `server.ts`) |

Kit qualification stays on the old digest until a later bake of
[`images/modelica-microsandbox-worker/Dockerfile`](../../../images/modelica-microsandbox-worker/Dockerfile)
is itself qualified. Adding the admitted worker to that Dockerfile does **not** reroute
kit `@1`.

The current admitted pin in `server.ts`
(`LOCAL_ADMITTED_MODELICA_EXECUTION_IMAGE_REFERENCE`) is a local digest of that same
image name. A later official bake of the committed Dockerfile produces a new digest and
must update that constant. Do not reuse the kit qualification digest for admitted runs.

## Product Modelica AX

```text
project_technical_source_capture          # modelica-closed-subset-v2; pass result.reference
  -> project_technical_compilation_preview
  -> compile.seal-admission@3
  -> project_admitted_modelica_run_review
  -> simulate.run-admitted-modelica@1
```

`--local-execution` (or `start:yolo`) composes the review and executor. Without that
flag the descriptor stays registered and the dispatcher is fail-closed.

A successful isolated Modelica run is documentary. It is not a requirement verdict and
not `simulate.run-qualified-modelica-kit@1`.

## Product SPICE AX

```text
project_technical_source_capture          # spice-circuit-closed-subset-v1; pass result.reference
  -> project_technical_compilation_preview
  -> compile.seal-admission@3
  -> project_admitted_spice_run_review
  -> simulate.run-admitted-spice@1
```

`--local-execution` (or `start:yolo`) composes the review and executor. Without that
flag the descriptor stays registered and the dispatcher is fail-closed.

A successful isolated SPICE run is documentary operating-point evidence. It is not
mcp-spice, not the LED-driver fiche, and not a requirement verdict. Derived current or
power and L4/L5 belong to the later method-sheet operations, not this isolated run.

## Admitted Modelica replay boundary

Only the invocation that just claimed a queued run may create its WAL and dispatch
generation 0. A run already marked `running` or `publishing` without that WAL is
quarantined; the server never adopts it as a new attempt. After an uncertain outcome,
the executor first reopens the exact CAS publication. A proven absence may authorize one
generation-1 dispatch, but only after durable generation-0 cleanup and a one-shot WAL
transition. There is no generation 2.

Publishing and completed replay reopen the exact receipt, capture, immutable project
revisions and Thread successor without invoking the worker. These rules deliberately do
not preserve pre-WAL development runs.

## Hexagonal placement

| Layer       | Owns                                                                                          | Must not                     |
| ----------- | --------------------------------------------------------------------------------------------- | ---------------------------- |
| Domain      | Admission target, isolated request schema, language evidence / output contracts, MRTR grammar | Image names, SDK, filesystem |
| In-port     | `ReopenAdmittedCompilationSource`, language review ports                                      | Worker args, OCI pull        |
| Out-port    | `TechnicalCompilationAdmissionReader`, `IsolatedCodeRunner`, language profile catalog         | Thread document shape        |
| Use case    | Reopen + `isolatedRequestFromAdmittedSource`                                                  | Execute, publish Thread      |
| Adapter     | Profile catalog, Microsandbox backend, language executor, image worker                        | Caller-selected runtime      |
| Composition | `--local-execution` wires review + executor when the exact profile and runtime exist          | Implicit env-var activation  |

New language verticals that already compile through `compile.seal-admission@3` reuse the
reopen port. They add a profile, worker, MRTR, review tool, and executor. They do not
duplicate admission reopen. CalculiX stays out until the agent writes a closed solver
language (it does not).
