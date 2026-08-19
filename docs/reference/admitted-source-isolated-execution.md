# Reference: admitted source → isolated microVM

This is the recurrent hexagonal pattern for executing **agent-authored closed-subset
source** that has already been sealed by `compile.seal-admission@1`. It is not a
provider MCP path and not a kit.

Lookalikes: [lookalike traps](lookalike-traps.md). File locations:
[workspace source map](workspace-source-map.md). Capture → admission:
[analysis authority pipeline](analysis-authority-pipeline.md). Isolation narrative:
[compilation and isolation](compilation-and-isolation.md). Product walk:
[run admitted Modelica](../how-to/run-admitted-modelica.md).

## Pattern

```text
compile.seal-admission@1
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

## Consumers

| Language  | Review tool                            | Operation                           | What a success is                                      | What it is not                          |
| --------- | -------------------------------------- | ----------------------------------- | ------------------------------------------------------ | --------------------------------------- |
| Build123d | `project_build123d_execution_review`   | `design.execute-build123d@1`        | Documentary capture + noncanonical STEP draft          | Canonical geometry / FEA `geometry`     |
| Modelica  | `project_admitted_modelica_run_review` | `simulate.run-admitted-modelica@1`  | Documentary capture + `evidence.json` + `result.csv`   | The pinned kit, recorded `@2`, a verdict |

Both bind one `compilationAdmission` artifact. Both refuse extra source-text bindings.

## Not this pattern

| Lookalike                                  | Why it is different                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `simulate.run-qualified-modelica-kit@1`    | Image smoke. Worker ENTRYPOINT pins one LinearThermalRamp kit. Empty bindings. No caller `.mo`. |
| `simulate.run-modelica-scenario@2`         | Recorded provider MCP. ROP 2.0. Not local isolation.                                |
| `verify.run-fea-static-proof@3`            | Isolated CalculiX. Agent never writes `.inp`. Server lowers a sealed proof + STEP.  |
| `design.write-geometry@1`                  | Canonical STEP seal of admitted export. Not isolated execution.                     |
| Caller `modelicaText` / CAD script in MRTR | Refused. Source comes only from the sealed admission.                               |

## One Modelica image family

There is one image name: `casys/modelica-microsandbox-worker`. Do not invent a second
image (`closed-subset-worker` or similar).

| Worker                                                                 | Selected how                                              | Source bytes                         | Qualification |
| ---------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------ | ------------- |
| `/opt/casys/profiles/modelica-qualified-kit-v1/run.ts`                 | Image `ENTRYPOINT`. Kit `@1` composition.                 | Pinned kit `.mo` inside the image    | Digest `7d3fdeabe794…` (unchanged) |
| `/opt/casys/profiles/modelica-closed-subset-v1/run.ts`                 | Backend args in the admitted composition.                 | `/input/source.mo` from admission    | Separate local pin (see `server.ts`) |

Kit qualification stays on the old digest until a later bake of
[`images/modelica-microsandbox-worker/Dockerfile`](../../images/modelica-microsandbox-worker/Dockerfile)
is itself qualified. Adding the admitted worker to that Dockerfile does **not** reroute
kit `@1`.

The current admitted pin in `server.ts`
(`LOCAL_ADMITTED_MODELICA_EXECUTION_IMAGE_REFERENCE`) is a local digest of that same
image name. A later official bake of the committed Dockerfile produces a new digest and
must update that constant. Do not reuse the kit qualification digest for admitted runs.

## Product Modelica AX

```text
project_technical_source_capture          # modelica-closed-subset-v1; pass result.reference
  -> project_technical_compilation_preview
  -> compile.seal-admission@1
  -> project_admitted_modelica_run_review
  -> simulate.run-admitted-modelica@1
```

`--local-execution` (or `start:yolo`) composes the review and executor. Without that
flag the descriptor stays registered and the dispatcher is fail-closed.

A successful isolated Modelica run is documentary. It is not a requirement verdict and
not `simulate.run-qualified-modelica-kit@1`.

## Hexagonal placement

| Layer        | Owns                                                                                          | Must not                                      |
| ------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Domain       | Admission target, isolated request schema, language evidence / output contracts, MRTR grammar | Image names, SDK, filesystem                  |
| In-port      | `ReopenAdmittedCompilationSource`, language review ports                                      | Worker args, OCI pull                         |
| Out-port     | `TechnicalCompilationAdmissionReader`, `IsolatedCodeRunner`, language profile catalog         | Thread document shape                         |
| Use case     | Reopen + `isolatedRequestFromAdmittedSource`                                                  | Execute, publish Thread                       |
| Adapter      | Profile catalog, Microsandbox backend, language executor, image worker                        | Caller-selected runtime                       |
| Composition  | `--local-execution` wires review + executor when the exact profile and runtime exist          | Implicit env-var activation                   |

New language verticals that already compile through `compile.seal-admission@1` reuse the
reopen port. They add a profile, worker, MRTR, review tool, and executor. They do not
duplicate admission reopen. CalculiX stays out until the agent writes a closed solver
language (it does not).
