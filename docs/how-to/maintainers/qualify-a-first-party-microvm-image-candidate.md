# How-to: qualify a first-party microVM image candidate

Audience: maintainer · Diátaxis: how-to · Kind: release procedure

Qualify one imported first-party Microsandbox worker candidate on the reviewed ARM Mac.
This is host/runtime evidence only. It does not promote a catalogue pin, write Thread or
project proofs, or produce L3/L4/L5 engineering evidence. CalculiX candidate
qualification is never a product FEA verdict.

Import first:
[Import a first-party microVM image candidate](import-a-first-party-microvm-image-candidate.md).
Contract:
[first-party microVM distribution](../../reference/runtime/capability-packs/first-party-microvm-distribution.md).

The physical images stay distinct. Do not merge them.

| Physical image                     | Gate task                                                         | Worker                                               |
| ---------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| `build123d-isolated-worker`        | `verify:build123d-isolated-worker:candidate-qualification`        | Arbitrary admitted Build123d source, isolated worker |
| `geometry-module-assembler-worker` | `verify:geometry-module-assembler-worker:candidate-qualification` | Deterministic sealed module assembly                 |
| `calculix-worker`                  | `verify:calculix-worker:candidate-qualification`                  | Code-owned synthetic static-proof worker fixture     |
| `modelica-microsandbox-worker`     | `verify:modelica-worker:candidate-qualification`                  | Two proofs: qualified-kit and admitted closed-subset |
| `ngspice-worker`                   | `verify:ngspice-worker:candidate-qualification`                   | Code-owned resistor-divider admitted-circuit source  |

The Docker CalculiX worker preflight
(`scripts/gates/verify-calculix-microsandbox-worker.ts`) remains source-image and
worker-contract evidence. It is not this imported-candidate Microsandbox path and not
the active-pin vertical (`verify:calculix:microsandbox:vertical`). The Docker Modelica
worker preflight (`scripts/gates/verify-modelica-microsandbox-worker.ts`) and the
active-pin vertical (`verify:modelica:microsandbox:vertical`) remain distinct
source-image and pinned-capture contracts. They are not this imported-candidate path.
The Docker ngspice worker smoke (`scripts/gates/verify-ngspice-microsandbox-worker.ts`)
remains a container contract outside IsolatedCodeRunner. It is not this
imported-candidate path, not cache preparation, and not product admitted-SPICE.

## 1. Plan first

Each gate accepts only `--import-record=<path>` plus an explicit boolean action. Default
mode is planning/read. It re-parses the import record with
`readBoundFirstPartyMicrosandboxImageCandidateImportRecord` against the current
server-owned matrix, rejects the wrong `physicalImageId` before any runtime effect, and
prints the planned candidate reference. It does not call Docker or Microsandbox.

```bash
deno task verify:build123d-isolated-worker:candidate-qualification --import-record=<path>
deno task verify:geometry-module-assembler-worker:candidate-qualification --import-record=<path>
deno task verify:calculix-worker:candidate-qualification --import-record=<path>
deno task verify:modelica-worker:candidate-qualification --import-record=<path>
deno task verify:ngspice-worker:candidate-qualification --import-record=<path>
```

Callers cannot pass provider, image, digest, platform, command, endpoint, tool, worker,
binding, unit, proof, STEP, or args. The Microsandbox candidate reference comes only
from `candidate.microsandbox.candidateReference` on the bound record.

## 2. Qualify only with `--run`

```bash
deno task verify:build123d-isolated-worker:candidate-qualification --import-record=<path> --run
deno task verify:geometry-module-assembler-worker:candidate-qualification --import-record=<path> --run
deno task verify:calculix-worker:candidate-qualification --import-record=<path> --run
deno task verify:modelica-worker:candidate-qualification --import-record=<path> --run
deno task verify:ngspice-worker:candidate-qualification --import-record=<path> --run
```

`--run` is the mutation acknowledgement. Geometry, CalculiX, Modelica and ngspice also
accept `--recover` for the existing durable WAL; recovery never redispatches the worker.
Modelica has no profile selector: one run always owns both server-owned proofs. ngspice
has no profile, source or netlist selector: one run always owns the server-owned
admitted circuit profile and the code-owned resistor-divider fixture.

The gates execute the exact cached candidate image through the production composition,
broker, output validator, CAS reread, and proven run-scoped destruction. CalculiX reuses
the code-owned worker contract, wrapper digest, nine-file validators and batch inspector
under a candidate-specific root. Modelica reuses the qualified-kit bundle/validators and
the admitted closed-subset v2 worker/validators under distinct `targets/<proof-id>/`
subroots; the aggregate is `passed` only after both proofs are durably reread. Partial
success stays `incomplete` and does not write a passed aggregate. ngspice reuses the
admitted circuit profile, IsolatedCodeRunner composition, `result.json`/`evidence.json`
validators and the code-owned resistor-divider operating-point check under a
candidate-specific root. Admitted method/binding qualification remains `unqualified`.
Policy, limits, worker command, fixture and oracle stay code-owned. Import already owns
acquisition: the gates do not build Docker, load or remove images, or assume Docker and
Microsandbox digest identity.

## 3. Isolated candidate state

Candidate outputs and records live under
`state/local/first-party-microsandbox-image-candidate-qualification/<physicalImageId>/<import-record fingerprint>/`.
Geometry keeps attempts, attestations, captures and outputs there. Build123d keeps
outputs and the qualification record there. CalculiX keeps WAL, CAS outputs, evidence,
leases and the qualification record there. Modelica keeps per-profile WAL, CAS and
attestations under `targets/openmodelica-qualified-kit/` and
`targets/openmodelica-admitted-modelica/`, with the aggregate `qualification.json` at
the physical root. ngspice keeps WAL, CAS outputs, captures/attestations and the
qualification record under `ngspice-worker/<import-record fingerprint>/`. The record
binds the observed host identity and the exact run/receipt. Host observation comes from
the existing control-plane composition (`linux/arm64` only), is read once for the whole
qualification, and is refused before composition. None of these paths write
qualification attempts or attestations into `state/local/capability-runtime-host`.
CalculiX never writes `state/local/calculix-*`. Modelica never writes
`state/local/modelica-microsandbox-qualification`. ngspice never writes
`state/local/recorded-analysis/electrical/spice/admitted/`.

The imported candidate cache is preserved on success and failure. Only run-scoped
sandboxes, staging and CAS temporary artifacts that the gate owns are removed. The
active catalogue pin, catalogue source, Thread, project proofs, Docker images and other
cached images are never touched.

## 4. What success means

A passed result is `kind=candidate-qualification` with `eligibleForPromotion=false`. It
is host/runtime evidence only. It is not L3, L4 or L5 engineering evidence and never
changes a catalog pin. This coding lot does not claim that a real candidate image was
executed.
