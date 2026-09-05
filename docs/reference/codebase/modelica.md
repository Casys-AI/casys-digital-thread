# Reference: source map — Modelica

Audience: agent · Diátaxis: reference · Kind: contract

Census of admitted Modelica, the qualified kit, and the retired recorded island. Those
authorities are not interchangeable.

Index: [workspace source map](../codebase/codebase-map.md). Domain coverage stays on
[engineering domains](../domains/README.md).

## Source map

#### [`src/domain/modelica/`](../../../src/domain/modelica)

Modelica authority context: `source/` (closed-subset parse, not admission), `admitted/`
(`simulate.run-admitted-modelica@1`), `qualified-kit/` (image smoke), `evaluation/`
(conditional L4 / human L5). Historical `recorded/` is retired. Not interchangeable.
Shared `IsolatedCodeRunner` / `reopen-admitted-compilation-source` live under `compile/`

#### [`src/application/ports/in/modelica/`](../../../src/application/ports/in/modelica)

Inbound Modelica review ports, split by authority (`admitted-run-review` ≠
`qualified-kit-run-review`)

#### [`src/application/ports/out/modelica/`](../../../src/application/ports/out/modelica)

Outbound Modelica catalogs, isolated-run stores and kit factory. Shared
`IsolatedCodeRunner` lives in `ports/out/compile/isolation/`

#### [`src/application/use-cases/modelica/`](../../../src/application/use-cases/modelica)

Modelica reviews and kit isolated runner. `reopen-admitted-compilation-source` is shared
with CAD under `use-cases/compile/admission/`

#### [`src/adapters/modelica/`](../../../src/adapters/modelica)

Modelica adapters by authority: `admitted/`, `qualified-kit/`, `evaluation/`, `source/`.
Historical `recorded/` (including `run-observer.ts`) is retired. Not a flat `captures/`
/ `executors/` dump

#### [`src/adapters/modelica/qualified-kit/execution-composition.ts`](../../../src/adapters/modelica/qualified-kit/execution-composition.ts)

Fail-closed Modelica local-isolation composition: the operation descriptor and
unavailable dispatcher entry remain registered, while its review and concrete executor
are wired only under explicit local execution after reopening the exact persisted
qualification

#### [`src/adapters/modelica/qualified-kit/microsandbox-qualification.ts`](../../../src/adapters/modelica/qualified-kit/microsandbox-qualification.ts)

Content-addressed qualification capture store and publication-backed authority; profile
activation requires exact capture, receipt, generation, image, worker, evidence and
publication reread rather than a successful process exit alone

#### [`scripts/gates/verify-modelica-microsandbox-vertical.ts`](../../../scripts/gates/verify-modelica-microsandbox-vertical.ts)

Real local microVM qualification gate for the digest-pinned Modelica worker and fixed
linear-ramp case: OMC/MSL result validation, generation-0 CAS reread after adapter
restart, proven destruction and persisted qualification authority; no arbitrary Modelica
or project-operation activation

#### `deno task verify:modelica:microsandbox:vertical`

Permission-bounded entry point for that exact real Modelica worker qualification; it
does not execute a project run or broaden the one-kit authority

#### [`scripts/gates/verify-modelica-microsandbox-worker.ts`](../../../scripts/gates/verify-modelica-microsandbox-worker.ts)

Earlier Docker worker preflight for the fixed Modelica bundle; useful worker-contract
evidence but not a substitute for the real local microVM qualification gate, imported
candidate qualification, or project activation

#### [`scripts/gates/verify-modelica-worker-candidate-qualification.ts`](../../../scripts/gates/verify-modelica-worker-candidate-qualification.ts)

Maintainer-only imported-candidate qualification for `modelica-microsandbox-worker`.
Input is only a bound `first-party-microsandbox-image-candidate-import/3.0` record plus
`--run` or `--recover`. One run owns both server-owned proofs
(`openmodelica-qualified-kit` and `openmodelica-admitted-modelica`). Host observation is
read once. The aggregate is `passed` only after both profile proofs are durably reread.
`eligibleForPromotion` stays `false`. Admitted method/binding remain `unqualified`. It
is not the Docker preflight, not the active-pin vertical, and not project/Thread
authority

#### [`src/adapters/modelica/first-party-modelica-execution.ts`](../../../src/adapters/modelica/first-party-modelica-execution.ts)

Code-owned active Modelica policy, limits and local server options for qualified-kit and
admitted execution. The server, the active vertical and the imported-candidate gate
share these builders. Candidate factories accept only an already-bound import record

#### [`src/adapters/modelica/modelica-worker-candidate-qualification.ts`](../../../src/adapters/modelica/modelica-worker-candidate-qualification.ts)

Record-bound plan/run/recover orchestration for an imported Modelica worker candidate.
Two profile-distinct proofs under `targets/<proof-id>/`; aggregate `qualification.json`
only after both pass. Never reopens admission, MRTR, project or Thread authority

#### [`src/adapters/modelica/qualified-kit/run-executor.ts`](../../../src/adapters/modelica/qualified-kit/run-executor.ts)

Registered `simulate.run-qualified-modelica-kit@1` executor: exact
basis/MRTR/qualification replay, one fixed local solve, three documentary artifacts and
one `22 degC` observation; no ROP, arbitrary Modelica, provider provenance or verdict,
and recovery never redispatches a completed solve

#### [`src/domain/modelica/admitted/run-proposal.ts`](../../../src/domain/modelica/admitted/run-proposal.ts)

Closed MRTR for `simulate.run-admitted-modelica@1`; binds one `compile.seal-admission@3`
artifact and the server-owned isolation contract. No Modelica text

#### [`src/application/use-cases/modelica/admitted/reopen-reviewed-execution.ts`](../../../src/application/use-cases/modelica/admitted/reopen-reviewed-execution.ts)

Read-only reopen of one reviewed admitted Modelica execution. Revalidates MRTR,
admission scope and sealed compilation source. Callers never supply Modelica text.

#### [`src/application/use-cases/modelica/admitted/attempt-resume-policy.ts`](../../../src/application/use-cases/modelica/admitted/attempt-resume-policy.ts)

Pure WAL resume choice from journal phase and already-observed publication. No runner,
attempt store, CAS or dispatch.

#### [`src/domain/modelica/admitted/published-output-evidence.ts`](../../../src/domain/modelica/admitted/published-output-evidence.ts)

Pure published-output validation and capture build for one admitted Modelica isolated
run. No path, CAS or runner.

#### [`src/domain/modelica/admitted/documentary-thread-evidence.ts`](../../../src/domain/modelica/admitted/documentary-thread-evidence.ts)

Pure documentary Thread successor from already-reopened admitted Modelica values. No
clock.

#### [`src/adapters/modelica/admitted/execution-composition.ts`](../../../src/adapters/modelica/admitted/execution-composition.ts)

Profile plus optional Microsandbox runner for admitted `.mo`. Same
`casys/modelica-microsandbox-worker` family as the separate qualified kit; backend args
select `modelica-closed-subset-v2/run.ts`

#### [`src/adapters/modelica/server-composition.ts`](../../../src/adapters/modelica/server-composition.ts)

Qualified-kit and admitted Modelica capabilities plus project contributions. Kit and
admitted stay distinct (options, output roots, reviews, executors). L4 evaluation
requires SysON. Thermal method-sheet join is a separate factory.

#### [`src/adapters/modelica/admitted/run-executor.ts`](../../../src/adapters/modelica/admitted/run-executor.ts)

Trusted executor: reopen admission via `ReopenAdmittedCompilationSource`, run
`IsolatedCodeRunner`, publish documentary capture/evidence/result. Not the kit, not `@2`

#### [`src/application/ports/out/modelica/admitted-execution-attempt-store.ts`](../../../src/application/ports/out/modelica/admitted-execution-attempt-store.ts)

Closed monotone WAL contract for admitted Modelica: exact reviewed authority, dispatch
generations 0/1, publication receipt and documentary Thread evidence. A transition
grants dispatch only when it reports `transitioned-now`

#### [`src/adapters/modelica/admitted/file-execution-attempt-store.ts`](../../../src/adapters/modelica/admitted/file-execution-attempt-store.ts)

Private canonical admitted-Modelica WAL. Cross-process locks serialize each project/run;
uncertain acknowledgements sacrifice availability rather than permit duplicate microVM
dispatch, and there is no generation 2

#### [`src/adapters/modelica/admitted/closed-subset-v2/`](../../../src/adapters/modelica/admitted/closed-subset-v2)

Image-owned worker that executes generic bounded `/input/source.mo` using its source
experiment annotation. Lives in `images/modelica-microsandbox-worker/` next to the
separate qualified-kit V1 profile

#### [`images/modelica-microsandbox-worker/Dockerfile`](../../../images/modelica-microsandbox-worker/Dockerfile)

One Modelica microVM image: kit worker (ENTRYPOINT, pinned source) plus admitted
closed-subset worker. Kit qualification stays on its old digest until a later bake of
this Dockerfile

#### Retired `src/adapters/modelica/recorded/` and port 3016 `mcp-modelica` sidecar

Historical observed-run catalog. Product Modelica is the local microVM (admitted + kit).
Do not restore `ModelicaRunObserver`, the fleet entry, or the Compose volume.
