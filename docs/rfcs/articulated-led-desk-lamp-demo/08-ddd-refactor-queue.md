Audience: agent · Diátaxis: none · Kind: RFC Status: active Living pages:
[Agent workspace](../../reference/agent/agent-workspace.md),
[Workspace source map](../../reference/runtime/workspace-source-map.md)

# RFC: 08 — DDD and hexagonal cleanup queue

This lane spends fast-agent throughput on architectural debt demonstrated by the lamp
vertical. It is not a license for repository-wide renaming, generic frameworks, folder
fashion, or cleanup mixed into feature commits. Every lot names one ownership defect,
preserves or deliberately retires behaviour, and ends in an independently reviewable
commit.

The demo core must remain runnable between lots. A refactor that discovers a product
contract change returns that change to its owning feature RFC.

## Placement rules

- Domain owns pure vocabulary, invariants, decisions and deterministic transitions.
- Application owns use cases and inward/outward ports expressed in domain language.
- Adapters own SysON/MCP/filesystem/Microsandbox/Docker/wire formats.
- Composition owns construction and runtime selection; it does not become domain.
- Presentation owns read models, never command authority or provider credentials.
- A helper shared by two contexts is not automatically a shared-domain abstraction.
  Extract only an invariant with identical meaning and failure semantics.

## Queue

### R01 — publish a current dependency/census baseline

Run a read-only import/census report for the touched bounded contexts and record:

- runtime entry points and registered operations;
- domain → application → adapter edges;
- files over 1,000 lines and their distinct responsibilities;
- dead operations/types with no registered product path; and
- cross-context imports that carry provider vocabulary inward.

Use this as the before-state in the handoff, not as a new permanent generator unless an
existing architecture gate can consume it. **Commit:** none unless a false living doc is
corrected. **Stop:** evidence does not support the planned lot.

### R02 — retire the runtime-dead recorded Modelica island

The product Modelica path is admitted closed-subset v2 plus the qualified-kit smoke.
Historical `simulate.seal-simulation-case@1/@2` and
`simulate.run-modelica-scenario@1/@2` are not registered product operations. Remove the
dead recorded V1/V2 domain/adapters/tests and their dedicated fixtures rather than
maintaining old runs in active development.

Scope must include exact import surgery in shared files, not deletion by folder alone:

- Modelica arms in `ResolvedOperationPlanResolver`;
- `dynamic-system-simulation` arms in resolved-plan contracts while preserving FEA;
- recorded-only descriptors/capture stores/proposal validators;
- the unstarted `@1 → @2` supersession command/tool when no other operation uses it;
- generic test fixtures rewritten against active FEA/admitted paths; and
- living docs reduced to one short tombstone/lookalike warning.

Do not delete generic decision supersession, graph links, WAL primitives or FEA ROP
functionality merely because recorded Modelica used them.

**Accept:** registry tombstone tests still prove those identities unknown; admitted v2,
qualified kit and FEA gates remain green; `rg` finds no production import of the retired
island.

### R03 — decide and remove the legacy Modelica observer boundary

`ModelicaRunObserver` and the `mcp-modelica` fleet/Compose entry may still project old
provider runs despite the recorded operations being dead. Treat this as a separate
behavioural decision:

1. prove all current consumers;
2. confirm admitted/qualified local microVM paths do not need the sidecar;
3. remove observer composition, control-plane merge, fleet entry, Compose service and
   volume atomically if the no-old-run policy applies; and
4. update provider/runtime docs and fleet tests.

Do not leave a required fleet dependency or ghost UI read model. A negative decision
parks this lot without weakening R02.

### R04 — decompose server composition by bounded context

`server.ts` is composition root, but construction for architecture, CAD, Modelica, FEA,
sensitivity and electrical work should live in narrow composition functions/modules.
Extract construction only: no service locator, dependency-injection framework, global
registry singleton or business rule.

Each factory returns explicit ports/executors/availability contributions. Server-owned
paths, digests and mode flags stay visible at composition. Add one construction test per
new module where a wrong dependency would change authority.

**Accept:** `server.ts` reads as orchestration of contexts; there is no import cycle and
the architecture boundary test remains green.

### R05 — separate architecture write orchestration from graph verification

Coordinate with A07 in [02](02-sysml-architecture-and-parameters.md). The large
`model-write-architecture-run-executor.ts` currently mixes provider sequencing,
recovery, capture construction and predecessor/proposal/live graph comparison. Extract
only pure graph verification and deterministic capture building; leave provider calls
and WAL in the adapter executor.

No generic graph library. The extracted algorithm speaks PartDefinition, PartUsage and
AttributeUsage explicitly and returns typed failure reasons.

### R06 — decompose admitted Modelica execution authority

Split `src/adapters/modelica/admitted/run-executor.ts` along existing authority phases:

- reviewed admission/source reopening;
- durable attempt transition and recovery choice;
- isolated receipt/output validation;
- Thread evidence construction; and
- completed replay verification.

Pure evidence and transition validation may move inward; CAS, files, clocks and runner
calls remain adapters/ports. Preserve exact no-redispatch guarantees and do not invent a
generic engineering executor superclass.

### R07 — decompose isolated FEA execution authority

Apply the same evidence-led separation to
`verify-run-fea-static-proof-v3-run-executor.ts`, retaining distinct mechanical
vocabulary. Extract pure proof/STEP/criteria identity checks, output-manifest
validation, oracle request construction and completed replay verification. Keep
Gmsh/CalculiX, SysON and filesystem envelopes in adapters.

The static path must remain bit-for-bit authoritative. Do not prepare modal or buckling
fields in this refactor.

### R08 — narrow cross-context shared helpers

Audit `src/adapters/shared/` consumers touched by the demo. A shared helper remains only
if all callers require identical capability and failure semantics. Context-specific WAL
manifests, artifact selectors and evidence builders stay beside their context.

Prefer duplication of five obvious lines over a generic helper that erases which
authority is being checked. Remove dead exports and stale comments as part of the owning
commit only.

### R09 — enforce the intended dependency rules

Update `src/testing/architecture-boundaries_test.ts` only for boundaries demonstrated by
the refactor:

- domain cannot import application/adapters/presentation;
- application cannot import adapters/presentation;
- presentation may use domain types only through the documented type-only allowance;
- retired `src/contracts/` and recorded Modelica folders cannot reappear; and
- provider vocabulary stays out of domain/application contracts.

Do not add filename-specific allowances to make a violation pass.

### R10 — reconcile living maps after code lands

Update the workspace source map, provider taxonomy, lookalike traps and relevant domain
READMEs. Delete stale historical detail instead of copying it into another page. RFCs
remain archive context; reference pages describe the current tree.

## Definition of done

The lane is complete when each accepted context has a clear owner, pure invariants are
testable without I/O, composition contains no business decision, dead runtime islands
are removed according to policy, and the lamp demo still reopens/replays the same exact
evidence. A lower line count is not itself success.

## Validation and commit policy

- One commit per R lot; no feature behaviour and no unrelated formatting.
- Focused tests for the moved invariant plus its former executor path.
- Architecture boundary test after each import-direction change.
- `deno task check` after R02/R04 and once at lane completion, not after every file
  move.
- Compare persisted replay before/after R05–R07; any new dispatch is a blocker.
