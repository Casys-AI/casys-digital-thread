# Reference: project capability demand

Audience: both · Diátaxis: reference · Kind: contract

`project-capability-demand/1.0` is the exact, provider-neutral operational demand that
can be compiled from one validated immutable engineering-project snapshot. Stable
capability identity, catalogue vocabulary, and the demand document are separate domain
objects:

- [`engineering-capability.ts`](../../../../src/domain/capability/engineering-capability.ts);
- [`capability-requirement-catalog.ts`](../../../../src/domain/capability/capability-requirement-catalog.ts);
- [`project-capability-demand.ts`](../../../../src/domain/capability/project-capability-demand.ts).

The effect-free generic compiler accepts a trusted server-composition dependency in
[`compile-project-capability-demand.ts`](../../../../src/application/control-plane/compile-project-capability-demand.ts).
The current product path pins the frozen Behave catalogue in
[`behave-foundation-project-capability-demand.ts`](../../../../src/adapters/control-plane/behave-foundation-project-capability-demand.ts).

It answers **which semantic capabilities the registered project work requires**. It does
not answer which pack, provider, image, endpoint, tool, profile, command, or argument
should satisfy them.

## When demand becomes exact

A living brief may mention intended analyses, but that text is not an operation
catalogue. Any capability forecast made from the brief alone is `provisional` and grants
no installation, activation, provider-selection, or execution authority.

Exact demand can exist only after `project_plan_publish` has produced an immutable
project revision whose planned work names server-registered operation identities.
Without `project.plan`, compilation fails closed. When the server calls the current
Behave composition, it rereads that project revision and joins each work-item operation
to the code-owned, adapter-pinned capability-requirement catalogue. The agent never
supplies capability ids or a catalogue.

```text
approved brief
  -> project_plan_publish
  -> planned work with registered operation ids
  -> explicit server read using its pinned capability-requirement catalogue
  -> exact ProjectCapabilityDemand
```

The demand is read-only. Compiling it does not pull an image, start or stop a service,
write a local installation lock, dispatch an operation, approve an MRTR, or publish
Engineering Thread evidence. The compiler and pinned Behave composition exist today; no
MCP read model, persistence path, or supervisor invokes them yet.

## Exactness and refusal

The compiler treats the immutable project revision and capability-requirement catalogue
as authority:

- operations are identified by exact id and version, never aliases;
- repeated use of one operation by several work items becomes one canonical operation
  group with sorted work-item ids;
- a published-plan work item with no operation is refused rather than silently omitted;
- the same semantic capability version may support several planned operations;
- capability and operation order do not create a different identity;
- duplicate work-item ids, duplicate catalogue operations, and duplicate or conflicting
  requirements inside one catalogue entry are refused;
- an operation missing from the capability-requirement catalogue remains a first-class
  `unresolved / catalog-entry-missing` group and makes the whole demand `unresolved`;
- provider bindings and runtime materials cannot enter the demand record.

Requirements shared across operation groups are flattened by exact capability id,
version, and use (`preparation` or `execution`). When two groups need that same
identity, the stronger minimum qualification wins: `qualified` covers `compatible`,
never the reverse.

Demand compilation does not claim that a runtime is installed, active, healthy, or
qualified. Those are host observations and catalogue judgements joined later by a
read-only administrative plan.

## Identity and subset policy

The compiler produces two deterministic fingerprints:

- `pathFingerprint` binds the exact project snapshot, approved-brief basis, canonical
  operation identities, and their work-item membership;
- `capabilitySetFingerprint` binds the flattened canonical requirements plus every
  unresolved operation group.

These are equality and approval-basis identities, not freshness claims. A new project
revision is reread and compiled again; callers must not relabel an older demand as
current.

Subset comparison is semantic and version-exact:

- an allowed capability must match capability id, version, and use exactly;
- a `qualified` allowance covers a `compatible` requirement, but a `compatible`
  allowance does not cover a `qualified` requirement;
- any unresolved operation group makes coverage fail;
- removing demand does not widen authority;
- host effects are not implied by semantic subset and must be checked independently.

This subset policy is the foundation for a future one-time host-operational approval. It
does **not** exist to bypass engineering MRTR. Every consequential engineering run
retains its own exact inputs, method qualification, decision, dispatch, and evidence
boundary.

## Boundaries with the other records

| Record                           | Owns                                                        | Does not prove                     |
| -------------------------------- | ----------------------------------------------------------- | ---------------------------------- |
| Project brief                    | Stakeholder intent and sourced framing                      | Exact capability demand            |
| `ProjectCapabilityDemand`        | Semantic capability set required by registered planned work | Host availability or permission    |
| Capability-pack plan             | Candidate runtime materials and observable host effects     | Activation or engineering validity |
| Local installation lock          | Human-owned desired host state                              | Project intent or method evidence  |
| Resolved operation plan and MRTR | Exact method and consequential run authority                | General host administration        |
| Thread evidence                  | What exact execution and evaluation occurred                | Current pack availability          |

The future `ProjectCapabilityEnvelope` is deliberately separate from
`ProjectBriefRevision`. Its lifecycle and still-unimplemented host-effect fields are
defined in the
[Project capability envelope RFC](../../../rfcs/capability-packs/project-capability-envelope.md).
