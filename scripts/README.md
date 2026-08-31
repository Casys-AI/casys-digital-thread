# scripts/ — entry-point index

Each row names one entry-point script, the `deno task` that invokes or statically checks
it, and its observable effect. `Direct invocation` means that no runnable task is
registered for that script. Durable application captures are written under
`state/local/`; worker build and preflight scripts may instead create temporary files or
local container images as stated below.

`scripts/lib/cli.ts` is a shared module, not an entry point — it has no task.

## runners/ — write immutable local state

Registered MCP operations remain the canonical writers. This directory holds operator
recovery that must not appear on the agent MCP path.

| Script                                        | Task or registration          | Effect | Scope                                                                                                                             |
| --------------------------------------------- | ----------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `runners/reconcile-work-item-successor.ts`    | `recover:work-item-successor` | write  | Close a leftover ready work item behind a completed successor. Inspect by default; `--apply` writes.                              |
| `runners/capability-runtime-admin.ts`         | `capability:admin`            | write  | Private local operator lock/revoke/remove. No provider, image, tool or argument flags.                                            |
| `runners/capability-runtime-qualification.ts` | `capability:qualify`          | write  | Private Chrono `chrono-arm64-emulation-v1` review/apply/recover. No provider, image, platform, URL, tool, token, project or MRTR. |

## gates/ — verification and qualification entry points

The `*-worker.ts` gates qualify a worker in isolation. Build123d does so directly in a
microVM; the Modelica and CalculiX worker gates are Docker preflights. None proves the
brokered composition-to-CAS vertical. Only the corresponding `*-vertical.ts` gates
exercise that complete local microVM path end to end.

| Script                                                                 | Task or registration                                                         | Effect     | Scope                                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gates/verify-console-evidence.ts`                                     | `verify:evidence`                                                            | read       | Verify persisted console evidence.                                                                                                                                                                        |
| `gates/verify-doc-links.ts`                                            | `verify:docs`                                                                | read       | Verify local Markdown links and anchors against tracked plus new non-ignored repository content.                                                                                                          |
| `gates/verify-native-workbench-presentation.ts`                        | `verify:thread:presentation`                                                 | read       | Verify the built native-workbench presentation.                                                                                                                                                           |
| `gates/prepare-geometry-module-assembler-microsandbox.ts`              | `prepare:geometry-module:microsandbox`                                       | cache      | Idempotently inspect and import the exact reviewed Docker source image into the fixed Microsandbox runtime cache. No pull, build, worker execution, qualification, or product run.                        |
| `gates/verify-geometry-module-assembler-microsandbox-qualification.ts` | `verify:geometry-module:microsandbox:qualification`                          | write      | Private `--run` / `--recover` qualification of the fixed two-bracket worker fixture, with durable attempt, capture, and attestation records. It is neither catalogue promotion nor a project product run. |
| `gates/verify-build123d-microsandbox-worker.ts`                        | `check` (static check); direct invocation to run                             | temp/image | Direct Build123d worker microVM qualification; not the broker/composition/CAS vertical.                                                                                                                   |
| `gates/verify-build123d-microsandbox-vertical.ts`                      | `verify:build123d:microsandbox:vertical`                                     | temp       | Run the digest-pinned local microVM, broker, CAS, STEP validation, and cleanup vertical.                                                                                                                  |
| `gates/verify-modelica-microsandbox-worker.ts`                         | `check:modelica-isolated-execution` (static check); direct invocation to run | temp/image | Docker deny-all OMC worker preflight; not a microVM vertical.                                                                                                                                             |
| `gates/verify-modelica-microsandbox-vertical.ts`                       | `verify:modelica:microsandbox:vertical`                                      | write      | Run the digest-pinned local microVM vertical and publish its durable qualification capture.                                                                                                               |
| `gates/build-calculix-worker-candidate.ts`                             | `check:calculix-isolated-execution` (static check); direct invocation to run | image      | Build the local CalculiX worker candidate with the reviewed wrapper digest.                                                                                                                               |
| `gates/verify-calculix-microsandbox-worker.ts`                         | `check:calculix-isolated-execution` (static check); direct invocation to run | temp/image | Docker-isolated native CalculiX worker preflight; not a microVM vertical.                                                                                                                                 |
| `gates/verify-calculix-microsandbox-vertical.ts`                       | `verify:calculix:microsandbox:vertical`                                      | temp       | Run the digest-pinned local microVM, broker, CAS, external validation, replay, and cleanup vertical.                                                                                                      |
| `gates/verify-ngspice-microsandbox-worker.ts`                          | Direct invocation (`--run`)                                                  | temp/image | Docker deny-all ngspice worker preflight; not Microsandbox cache prep and not the product run.                                                                                                            |
| `gates/prepare-ngspice-microsandbox.ts`                                | `prepare:ngspice:microsandbox`                                               | cache      | Idempotent import of the Docker source digest into the Microsandbox cache under the runtime manifest pin. No pull, no product run.                                                                        |

The geometry-module stages are deliberately non-substitutable. Cache preparation only
makes the exact, already reviewed runtime image visible to Microsandbox. Qualification
then executes and rereads the fixed qualification fixture through its own WAL and
attestation capture. Neither stage performs `project_geometry_module_export`, produces
project evidence, or authorizes a product assembly; that remains a separately registered
operation using the exact qualified runtime.

## release/ — source-only public-release inventory

These scripts generate and verify an ignored, tag-labelled source archive inventory.
They do not pull, inspect, or claim coverage of a provider image, microVM, Desktop
bundle, or live project. See the
[source-alpha SBOM guide](../docs/how-to/maintainers/source-alpha-sbom.md).
`release/source-alpha-inventory.ts` is their shared deterministic renderer, not a direct
entry point.

| Script                                     | Task                          | Effect | Scope                                                                                                                            |
| ------------------------------------------ | ----------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `release/build-source-alpha-inventory.ts`  | `release:source-alpha:build`  | write  | Builds a deterministic source archive, CycloneDX 1.6 SBOM, manifest, notices, and checksums below ignored `dist/release/<tag>/`. |
| `release/render-third-party-notices.ts`    | `release:source-alpha:render` | write  | Re-renders the source-only third-party notice table from the generated CycloneDX document and refreshes checksums.               |
| `release/verify-source-alpha-inventory.ts` | `release:source-alpha:verify` | read   | Rebuilds the exact source-alpha inventory in memory and compares every tagged artifact and checksum without publishing anything. |

## probes/ — read-only diagnostic; `thread:capture-syson-inventory` writes a capture

| Script                                         | Task                                 | Risk  |
| ---------------------------------------------- | ------------------------------------ | ----- |
| `probes/capture-build123d-api-inventory.ts`    | (direct `deno run`)                  | write |
| `probes/capture-syson-model-inventory.ts`      | `thread:capture-syson-inventory`     | write |
| `probes/mcp-call.ts`                           | `mcp:call`                           | write |
| `probes/probe-constraint-solver.ts`            | `probe:constraint-solver`            | read  |
| `probes/probe-build123d-contract.ts`           | `probe:build123d-contract`           | read  |
| `probes/probe-calculix-contract.ts`            | `probe:calculix-contract`            | read  |
| `probes/probe-spice-contract.ts`               | `probe:spice-contract`               | read  |
| `probes/probe-architecture-attribute-value.ts` | `probe:architecture-attribute-value` | write |
| `probes/probe-archive-cascade.ts`              | `probe:archive-cascade`              | read  |
| `probes/probe-requirement-units.ts`            | `probe:requirement-units`            | write |

## serve/ — serve local preview; preview:thread and preview:cockpit start focus-first

| Script                             | Task                                      | Risk  |
| ---------------------------------- | ----------------------------------------- | ----- |
| `serve/console-browser-harness.ts` | `preview:browser` (retired; refuses)      | read  |
| `serve/preview-thread.ts`          | `preview:thread` (Vite :5173 + BFF :5175) | read  |
| `serve/serve-native-workbench.ts`  | `preview:cockpit` (frozen BFF :5175)      | read  |
| `serve/supervise-agent-stack.ts`   | `start:agent`                             | write |
