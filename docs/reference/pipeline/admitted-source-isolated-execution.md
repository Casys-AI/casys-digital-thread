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

## One physical Modelica image

There is one physical artefact: `casys/modelica-microsandbox-worker` at
`LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE`
(`sha256:834c759291320eb5f35ccb6eba03587445d259dcb38a2814c5def4ac41d5d730`). Do not
invent a second image (`closed-subset-worker` or similar). Qualified-kit and admitted
workers are two logical units and two cache recipes on that shared load identity; the
second acquisition is a cache hit. Binding qualifications stay separate scientific
captures.

| Worker                                                 | Selected how                              | Source bytes                                      | Binding qualification                                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/opt/casys/profiles/modelica-qualified-kit-v1/run.ts` | Image `ENTRYPOINT`. Kit `@1` composition. | Pinned kit `.mo` inside the image                 | Live-qualified for the fixed kit only; capture `bf85aa19…` (OpenModelica 1.27.0, MSL 4.1.0, exact 22 degC). Does not qualify the admitted worker     |
| `/opt/casys/profiles/modelica-closed-subset-v2/run.ts` | Backend args in the admitted composition. | Generic bounded `/input/source.mo` from admission | Separate, currently unqualified/unknown                                                                                                             |

The pin lives in `src/domain/modelica/local-execution-image.ts` and is the only active
Modelica runtime constant. Adding the admitted worker to
[`images/modelica-microsandbox-worker/Dockerfile`](../../../images/modelica-microsandbox-worker/Dockerfile)
does **not** merge the two binding qualifications. A later official bake of that
Dockerfile produces a new digest and must update that constant. A local
`trusted-dockerfile` rebuild is a candidate recipe, not that official bake and not
bit-reproducible proof: after import, the cached image must still match the exact
target digest, or the capability stays unavailable.

## Product Modelica AX

```text
project_technical_source_capture          # modelica-closed-subset-v2; pass result.reference
  -> project_technical_compilation_preview
  -> compile.seal-admission@3
  -> project_admitted_modelica_run_review
  -> simulate.run-admitted-modelica@1
```

The approved capability-runtime supervisor composes the review and executor from the
exact atomic unit. Until then the descriptor stays registered and the dispatcher is
fail-closed. `start:yolo` does not activate a runtime.

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

The approved capability-runtime supervisor composes the review and executor from the
exact atomic unit. Until then the descriptor stays registered and the dispatcher is
fail-closed. `start:yolo` does not activate a runtime.

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
| Composition | Approved capability supervisor wires review + executor from an exact unit | Implicit env-var or CLI activation |

New language verticals that already compile through `compile.seal-admission@3` reuse the
reopen port. They add a profile, worker, MRTR, review tool, and executor. They do not
duplicate admission reopen. CalculiX stays out until the agent writes a closed solver
language (it does not).
