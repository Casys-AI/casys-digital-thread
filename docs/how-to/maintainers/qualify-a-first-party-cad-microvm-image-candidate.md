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

The Docker CalculiX worker preflight
(`scripts/gates/verify-calculix-microsandbox-worker.ts`) remains source-image and
worker-contract evidence. It is not this imported-candidate Microsandbox path and not
the active-pin vertical (`verify:calculix:microsandbox:vertical`).

## 1. Plan first

Each gate accepts only `--import-record=<path>` plus an explicit boolean action. Default
mode is planning/read. It re-parses the import record with
`readBoundFirstPartyMicrosandboxImageCandidateImportRecord` against the current
server-owned matrix, rejects the wrong `physicalImageId` before any runtime effect, and
prints the planned candidate reference. It does not call Docker or Microsandbox.

```bash
deno task verify:build123d-isolated-worker:candidate-qualification -- --import-record=<path>
deno task verify:geometry-module-assembler-worker:candidate-qualification -- --import-record=<path>
deno task verify:calculix-worker:candidate-qualification -- --import-record=<path>
```

Callers cannot pass provider, image, digest, platform, command, endpoint, tool, worker,
binding, unit, proof, STEP, or args. The Microsandbox candidate reference comes only from
`candidate.microsandbox.candidateReference` on the bound record.

## 2. Qualify only with `--run`

```bash
deno task verify:build123d-isolated-worker:candidate-qualification -- --import-record=<path> --run
deno task verify:geometry-module-assembler-worker:candidate-qualification -- --import-record=<path> --run
deno task verify:calculix-worker:candidate-qualification -- --import-record=<path> --run
```

`--run` is the mutation acknowledgement. Geometry and CalculiX also accept `--recover`
for the existing durable WAL; recovery never redispatches the worker.

The gates execute the exact cached candidate image through the production composition,
broker, output validator, CAS reread, and proven run-scoped destruction. CalculiX reuses
the code-owned worker contract, wrapper digest, nine-file validators and batch inspector
under a candidate-specific root. Policy, limits, worker command, fixture and oracle stay
code-owned. Import already owns acquisition: the gates do not build Docker, load or
remove images, or assume Docker and Microsandbox digest identity.

## 3. Isolated candidate state

Candidate outputs and records live under
`state/local/first-party-microsandbox-image-candidate-qualification/<physicalImageId>/<import-record fingerprint>/`.
Geometry keeps attempts, attestations, captures and outputs there. Build123d keeps
outputs and the qualification record there. CalculiX keeps WAL, CAS outputs, evidence,
leases and the qualification record there. The record binds the observed host identity
and the exact run/receipt. Host observation comes from the existing control-plane
composition (`linux/arm64` only), is read once, and is refused before composition. None
of these paths write qualification attempts or attestations into
`state/local/capability-runtime-host`, and CalculiX never writes
`state/local/calculix-*`.

The imported candidate cache is preserved on success and failure. Only run-scoped
sandboxes, staging and CAS temporary artifacts that the gate owns are removed. The
active catalogue pin, catalogue source, Thread, project proofs, Docker images and other
cached images are never touched.

## 4. What success means

A passed result is `kind=candidate-qualification` with `eligibleForPromotion=false`. It
is host/runtime evidence only. It is not L3, L4 or L5 engineering evidence and never
changes a catalog pin. This coding lot does not claim that a real candidate image was
executed.
