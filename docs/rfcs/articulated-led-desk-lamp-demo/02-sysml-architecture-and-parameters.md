Audience: agent · Diátaxis: none · Kind: RFC Status: active Living pages:
[SysML coverage](../../reference/domains/sysml/coverage.md),
[SysON provider surface](../../reference/providers/syson/README.md)

# RFC: 02 — lamp architecture, parameter handles and bounded value semantics

This brief builds the semantic spine of the articulated LED desk-lamp demo. It does not
open arbitrary SysML, direct SysON access, or a second source authority. The renderer
path remains server-authored and MRTR-reviewed; the agent proposes product meaning and
never supplies SysML text, provider tools, AQL, UUIDs, or retry instructions.

Read [01 — demo product contract](01-demo-product-contract.md) first. If its human input
sheet is incomplete, implement only the generic infrastructure lots below. Do not fill
physical values from intuition, existing fixtures, CA02, DL05, or provider defaults.

## Target architecture

The first architecture is deliberately structural. It needs stable identities for:

- one `ArticulatedLedDeskLamp` system;
- `Base`, `Arm`, `LampHead`, `LedDriver`, and `PowerSupply` definitions;
- one typed `PartUsage` occurrence for each component under the system; and
- reviewed parameter handles owned by the component whose behaviour they describe.

Names are proposal inputs, not permission to invent values. The minimum handles are
classes of information, not pre-approved literals:

| Owner                 | Parameter meaning                              | Downstream consumers                            |
| --------------------- | ---------------------------------------------- | ----------------------------------------------- |
| Arm                   | geometric lever used by admitted CAD           | CAD, mechanical proof, sensitivity              |
| Arm                   | material/density references                    | mechanical method; modal only if later approved |
| LampHead              | thermal initial state and thermal coefficients | admitted Modelica                               |
| LedDriver             | electrical source/component parameters         | circuit method                                  |
| LampHead or LedDriver | reviewed electrical power                      | electrical and thermal branches                 |

Do not create duplicate SysML attributes merely because two analyses consume one
quantity. One reviewed semantic parameter may have multiple exact bindings.

## Fixed authority boundaries

1. `model.write-architecture@1` is the only SysON-writing architecture operation in this
   queue. `model.seal-architecture-sysml@1` remains documentary-only.
2. Current bare `AttributeUsage` support is a stable handle, not proof of value, type,
   unit, equation, connection, or requirement semantics.
3. Any typed/value extension begins with a real write → readback probe against the
   pinned SysON surface. A syntax accepted by an insertion tool but not exactly
   extractable is `unresolved`, not an implementation hint.
4. Active development requires no compatibility machinery for old demo runs. If the
   capture or proposal schema changes, retire the old identity explicitly and fail
   closed; never reinterpret old bytes as the new schema.
5. Ports/interfaces/connections are a separate capability gate. The first demo may use
   stable component and parameter identities without claiming a native electrical
   connection graph.

## Execution queue

### A01 — freeze the architecture vocabulary

Add one exact architecture vocabulary table to this RFC's implementation handoff:
system, definitions, occurrences, parameter handles, owning definitions, and intended
consumer branches. Obtain human approval for product-facing names. This is not a source
file or catalog yet.

**Accept:** every downstream spec refers to the same semantic handle; no physical value
is present. **Stop:** ambiguous ownership or two meanings sharing one handle.

### A02 — prove the existing structural renderer path

Using focused domain/application tests, prove that the current proposal grammar can
represent the system, five definitions/usages and bare attributes without a
demo-specific branch. Do not execute SysON in this lot.

Likely owners:

- `src/domain/architecture/renderer/architecture-proposal.ts`;
- `src/application/use-cases/architecture/renderer/prepare-project-brief-architecture-review.ts`;
- their focused tests.

**Accept:** the proposal is generic and entirely expressible with the current grammar.
If a structural form is missing, record it before extending anything.

### A03 — isolate a provider round-trip probe for value semantics

Create a disposable, read-only-after-write probe that tests one candidate typed/value
`AttributeUsage` shape at a time against the pinned SysON image. The probe must record:
inserted text owned by the server, returned identity, readback type/value/unit, exact
AQL or tool call selected by the server, provider version, and cleanup result.

Probe the already admitted oracle units needed by the demo only after the human sheet
names them. Do not treat the generic `V`, `A`, `W`, `K`, `s`, `mm` unit inventory as
proof that architecture attributes round-trip the same way as requirements.

**Commit:** probe and documentary capture only. **Stop:** missing or ambiguous readback;
do not proceed to A04 on a negative probe.

### A04 — define a closed value contract

Only after A03 is green, add a pure domain contract under
`src/domain/architecture/renderer/`. It must close:

- scalar value representation and finite-number rules;
- admitted unit strings and exact unit ownership;
- declared value versus measured/derived value semantics;
- owner definition and stable parameter identity;
- change rules and canonical fingerprinting; and
- duplicate, collision, non-finite, unknown-unit and extra-field rejection.

Prefer a discriminated parameter record inside a new architecture proposal version over
optional fields spread across the existing bare attribute type. Do not add provider
identifiers or SysML syntax to the domain.

### A05 — compile reviewed brief facts into proposal parameters

Extend the application review use case so only exact approved brief items can produce
typed/value proposal entries. Every value/unit needs a source item and an explicit human
decision. The compiler may normalize representation but cannot invent a physical input.

**Accept:** missing source, unit, owner or approval yields an explicit gap; no executor
or provider call occurs.

### A06 — lower and reread the typed attribute

Implement provider vocabulary in the renderer adapter, not in domain/application. The
executor must write only the probed closed form, reread it from SysON, and persist the
exact returned identity, type, value and unit in a new capture schema.

Likely owners:

- `src/adapters/architecture/renderer/model-write-architecture-run-executor.ts`;
- `architecture-structure-extractor.ts`;
- `architecture-capture.ts`;
- focused adapter tests.

Do not increase the 3,000-line executor by embedding another large validation algorithm;
A07 extracts the ratchet as a pure collaborator in the same commit series.

### A07 — extract the architecture graph ratchet

Move predecessor/current/proposal graph comparison from the executor into a pure,
bounded architecture-domain or adapter-local algorithm with explicit inputs and a closed
result. It must cover PartDefinitions, PartUsages and AttributeUsages including
type/value/unit. Preserve exact provider identities.

Reject disappearance, replacement, owner move, type drift, unit drift, unreviewed new
facts, duplicate semantic ids and ambiguous labels. Table-drive the transition matrix;
do not create a generic graph framework for unrelated bounded contexts.

**Commit:** pure ratchet + tests + thin executor integration. Behaviour must remain
fail-closed for existing part/usage/attribute cases.

### A08 — publish exact semantic bindings

Extend source-analysis/compilation joins only where the demonstrated branches need a
parameter. Each binding names the exact SysML attribute identity plus source artifact,
source symbol and downstream input identity. Labels are display data, never a join.

Prove these classes independently:

- arm lever → admitted CAD parameter;
- thermal parameters/power → admitted Modelica parameters;
- electrical parameters/power → sealed circuit inputs.

Do not build a universal unit-conversion or expression engine in this lot.

### A09 — decide the connection boundary

Run a separate provider probe for the smallest useful relation between `LedDriver` and
`LampHead`. A successful probe must establish stable ownership, endpoint identities,
typing and readback. If it fails, park native connections and use explicit parameter
bindings in the demo; do not encode a fake connection as an attribute or label.

This lot may end as a negative study. It does not block the mechanical or thermal demo.

### A10 — execute and replay the architecture operation

After the human approves the exact proposal, execute one fresh architecture write. Save
the project revision, Thread successor, capture fingerprint, semantic identities and WAL
state. Replay the exact command and prove no second SysON mutation.

**Human gate:** approval of the architecture proposal and every physical value. The
agent may prepare but never self-approve.

## Definition of done

This spec is complete when the fresh lamp project has stable, rereadable architecture
and parameter identities sufficient for the downstream branches, and a completed replay
does not call SysON again. Native typed/value attributes count only if A03–A08 are
green. Native connections count only if A09 is green. Otherwise their literal gaps
remain in the handoff and coverage.

## Validation and commits

- Run focused domain tests after A04/A05, focused adapter tests after A06/A07, and join
  tests after A08. Do not run the whole repository for every lot.
- Run `deno task check` once after the accepted architecture series integrates.
- Stage exact paths. Keep provider probes, product behaviour and documentation in
  reviewable commits; do not mix UI or unrelated formatting.
- Update living SysML coverage only after real execution/readback proves the new
  surface.
