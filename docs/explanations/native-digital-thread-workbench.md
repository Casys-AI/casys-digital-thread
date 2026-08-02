# Native digital-thread Workbench: compose evidence, not applications

**Status: accepted target — multi-provider CM-01 baseline plus the first human-agent
project-control slice, 2026-08-01**

The first Workbench proved that five independent MCP Apps can be discovered,
capability-bounded, mounted, and synchronized. It also exposed the product limit of that
architecture: five isolated applications remain five isolated applications even when
they share colors and small reusable components.

The product Workbench therefore no longer uses nested MCP Apps or iframes as its main
composition primitive. It renders one linked engineering state in one native Preact
application. MCP remains the protocol between the backend and the engineering tools; MCP
Apps remain a delivery surface for rich tool results and for embedding the complete
Workbench once in an agent host.

## Product question

The Workbench is a multi-tool cockpit in which an engineer works with an agent. It must
answer three questions at the same time:

1. What did the agent just produce or change?
2. What does that fact affect across the engineering chain, and why?
3. Which prepared recommendation needs the operator to review, challenge, approve, or
   return now?

The primary UI object is therefore a change and its propagation, not an MCP server or a
dashboard panel. The activity feed is the chronological backbone of the cockpit, not the
whole product: its inline lineage explains impact, and the contextual tool surface is
where the engineer inspects records and controls the next action.

```text
CAD change
  -> invalidates a structural solve
  -> produces a unit-bearing stress observation
  -> evaluates a traced requirement
  -> creates a named violation with evidence and a next action
```

The Workbench renders that topology first as a live lineage feed and second as a
complete graph. Feed cards are meaningful canonical facts; selecting or automatically
following a card renders every recorded ancestor and descendant as an inline scoped
graph. Nodes are canonical changes, artifacts, consumptions, observations, requirements,
evaluations, violations, and proposed actions. Edges retain their semantic relation and
factual rationale. Visual direction is consistently source or dependency to result or
consumer.

The graph does not join branches by name. A disconnected component is rendered in a
separate frame and means that the subject identity is shared but no causal relation has
been recorded.

The shell must never imply more autonomy than the runtime provides. A live indicator
means that validated persisted revisions are being followed, not that raw model
reasoning is being streamed. Browsing and inspection are immediate. Human decisions and
queue release are explicit, revision-bound project commands; engineering tool execution
is a separate agent operation with recorded inputs and evidence.

The default human role is reviewer, not technical payload author. Decision states have
different owners in the UI: `required` means the agent is preparing a recommendation,
`proposed` means the human has a review action, and `rejected` means the agent owes a
revision. Only `proposed` contributes to the human review counter. **Project** exposes a
lightweight review-notification inbox: it signals what needs attention and leads the
reviewer to the relevant context; it is not a second technical authoring surface.
**Activity** is where the reviewer follows the live evidence and lineage behind a
recommendation. Inspection and any correction request start with the affected
SysON/specification context in **Product** and the paired agent conversation, never in a
generic decision card. Activity may record one exact-bound request for a revised
recommendation; it never collects replacement technical values. Exact hashes and snapshot
IDs remain available as audit context.

## Runtime boundary

```text
native Preact SPA                           agent MCP client
  | GET + snapshot SSE                       | project snapshot/proposal
  | human-only POST                          | run lifecycle only
  v                                          v
                 immutable EngineeringProject revisions
                              |
                              | separate orchestration
                              v
                  Digital-thread orchestrator
                  - workflow DAG and bindings
                  - artifact fingerprints
                  - provenance and run state
                  - linked ThreadSnapshot
                              |
                              | stateless tools/call
                              v
       SysON / build123d / CalculiX / Modelica / ERPNext MCP tools
```

Opening or refreshing the application reads persisted project and thread snapshots. It
never starts CAD, meshing, FEA, or physical simulation. The read and SSE paths remain
passive. A provider recomputation is a separately orchestrated agent action with an
identified change set, durable run state, and provenance.

The current BFF serves the CM-01 snapshot and a same-origin SSE stream which announces
newer persisted revisions. Its narrow same-origin POST appends only human-authorized
project commands: propose, approve, reject, and queue. The local actor identity is
self-declared and unauthenticated, so this remains a loopback prototype rather than a
multi-user authorization system. The route has no provider-execution authority.

The same project is visible to agents through the Console MCP server. MCP exposes
snapshot, proposal, and run-lifecycle tools, but deliberately no approval, rejection, or
queue tool. Human and agent commands converge on one immutable active store with
optimistic revision checks and durable idempotency receipts.

The tracked r5 technical snapshot is assembled from captured SysON inventory, attested
build123d evidence, one persisted Modelica run, and reviewed ERPNext reads. It
deliberately stops before a mechanical verdict because that historical inventory has no
mechanical `ConstraintUsage`. The approved DripTray runner later adds the exact reviewed
constraints, provider evidence, and evaluations as r6. Completing its project run still
requires that separately published exact `ThreadSnapshot` and resolvable cited evidence.

The browser does not call the five MCP endpoints directly. The Deno backend owns service
endpoints, credentials, workflow execution, and result validation. Provider tools keep
their native contracts; normalization happens only when a result is added to the linked
thread model.

## Presentation boundary

`@casys/mcp-view` remains the shared visual language. Its pure Preact primitives and
domain components may be imported by the native application without the MCP Apps bridge.
A clean components-only sub-export is preferred over relying on tree-shaking from an
entry point that also exports the MCP App surface runtime.

The same views support two host adapters:

- an HTTP client for the standalone browser Workbench;
- an MCP Apps client when the complete Workbench is embedded once in an agent host.

Individual provider viewers remain useful when an agent calls one provider tool and
wants one rich result. An iframe remains an isolation fallback for third-party or
unreviewed Apps; it is not the normal first-party product layout.

In the native Workbench, SysON, build123d, CalculiX, Modelica, and ERPNext are tool
facets in one contextual drawer. Feed or topology selection activates the owning tool
and its related evidence. A second drawer mode exposes the exact selected record. A full
geometry, diagram, or BOM view replaces the central viewport through native routing; it
is not mounted as a permanent mini application beside four other tools. The first
implemented route is the part-centric workspace: one component selection persists across
native SysON structure, ERPNext BOM, and build123d geometry surfaces.

Component identity is a reviewed data contract, not a visual guess. The shell maps exact
PartUsage, Item, and CAD artifact IDs through a workspace-declared component catalog
whose bindings cite immutable provider evidence. Missing facets remain visible as trace
gaps. This is distinct from causal lineage: saying that two records describe the same
component does not say that one produced or verified the other.

## Composition model

There is no iframe dashboard or secondary compatibility host. The useful composition
concepts are native workflow concerns:

- reviewed manifests and deny-by-default grants;
- named tools and bounded arguments;
- data bindings between node outputs and inputs;
- events, actions, and execution history;
- an agent-editable YAML authoring format.

The new YAML describes a workflow graph. It is validated and compiled into a typed DAG
before execution. It does not carry live UI state and does not describe iframes,
viewports, or CSS layout.

## Current acceptance slice

The first real vertical slice is deliberately narrower than a five-panel cockpit. The
clean r5 baseline groups four observed branches through a reviewed CM-01 identity
manifest. The approved reference run extends it with one bounded DripTray mechanical
branch:

1. build123d produces an identified STEP artifact and measurements;
2. build123d hashes the exported STEP bytes;
3. CalculiX snapshots its input, recomputes its hash, and refuses an
   `expected_step_sha256` mismatch before meshing;
4. the r6 CAD → FEA edge is accepted only because the produced and consumed DripTray
   STEP hashes are equal; no such edge is claimed by the clean r5 baseline;
5. solver observations are normalized with units and source identities before SysON
   evaluates them;
6. the r5 SysON inventory establishes the historical absence of a mechanical constraint;
   the runner adds only the human-approved `1 mm` and `20 MPa` DripTray limits and
   re-extracts them before continuing;
7. Modelica contributes one persisted model/scenario run and unit-bearing thermal
   observations;
8. ERPNext contributes one active default BOM observation and the exact number of Bin
   rows returned by its read query;
9. the UI follows persisted revisions as a lineage feed, renders recorded dependencies
   as inline and full native graphs, keeps unlinked provider branches separate, and
   opens one contextual tool inspector;
10. the part-centric workspace preserves one component selection across ten exact
    SysON-to-ERP identities and one real build123d geometry, while exposing every
    missing facet;
11. reloading the shell starts no engineering computation.
12. **Project** exposes a lightweight review-notification inbox, **Activity** supplies
    the live evidence and lineage for review, and **Product** routes specification
    inspection and any correction request to the affected SysON context; explicit human approval,
    rejection, and bounded work authorization still append immutable project revisions;
13. agents can advance only an already queued run, and cannot grant themselves approval
    or queue authority;
14. run completion fails closed until an exact descendant snapshot contains evidence
    that is new or content-changed from the run base;
15. the completed r6/r10 reference path keeps provider execution, canonical attachment,
    and project lifecycle transitions distinct: `publishing` → attach → `completed`.

This is an evidence assembly, not a causal merger. CAD → FEA becomes an attested edge
only after a solver run consumes the exact STEP and its result is canonically published;
r6 contains that edge for the isolated concept DripTray, while the clean r5 baseline does
not. Modelica's scenario and ERPNext's provider reads
are independent branches until an explicit transformation or requirement trace links
them. In particular, zero ERP Bin rows is not a stock conclusion, and a successful
Modelica run is not a compliance verdict. The passing DripTray evaluations are likewise
not whole-machine, fabrication-release, or certification evidence.

## Product rule

Product behavior targets the linked model and native shell. Do not add an iframe panel,
a presentation-only MCP, or a browser-to-provider escape hatch to compensate for missing
orchestration.
