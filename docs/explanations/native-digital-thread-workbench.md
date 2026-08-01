# Native digital-thread Workbench: compose evidence, not applications

**Status: accepted target — first five-provider read-only CM-01 assembly running,
2026-08-01**

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
3. What can the operator inspect, prepare, approve, or reject now?

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
reasoning is being streamed. Browsing and inspection are immediate; an engineering tool
execution remains an explicit, operator-confirmed command with recorded inputs.

## Runtime boundary

```text
SysON / build123d / CalculiX / Modelica / ERPNext MCP tools
                              |
                              | stateless tools/call
                              v
                  Digital-thread orchestrator
                  - workflow DAG and bindings
                  - artifact fingerprints
                  - cache and invalidation
                  - provenance and run state
                  - linked ThreadSnapshot
                              |
                              | HTTP JSON + snapshot SSE
                              v
                       native Preact SPA
                       one shell and state
```

Opening or refreshing the application reads a persisted `ThreadSnapshot`. It never
starts CAD, meshing, FEA, or physical simulation. A recomputation is an explicit command
with an identified change set, durable run state, and provenance.

The current read-only BFF implements that load path. It serves the CM-01 snapshot and a
same-origin SSE stream which announces newer persisted revisions. It is assembled from
captured SysON inventory, attested build123d → CalculiX evidence, one persisted Modelica
run, and reviewed ERPNext reads. It has no execution route. The snapshot deliberately
stops before a requirement verdict because SysON has no approved mechanical
`ConstraintUsage` for this example yet.

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
current assembly groups these observed branches through a reviewed CM-01 identity
manifest:

1. build123d produces an identified STEP artifact and measurements;
2. build123d hashes the exported STEP bytes;
3. CalculiX snapshots its input, recomputes its hash, and refuses a supplied
   `expected_step_sha256` mismatch before meshing;
4. the orchestrator accepts the CAD → FEA edge only when producer and consumer hashes
   are equal;
5. its observations are normalized with units and source identities;
6. SysON inventory establishes the actual current absence of a mechanical constraint,
   rather than supplying a default;
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

This is an evidence assembly, not a causal merger. CAD → FEA is an attested edge.
Modelica's scenario and ERPNext's provider reads are independent branches until an
explicit transformation or requirement trace links them. In particular, zero ERP Bin
rows is not a stock conclusion, and a successful Modelica run is not a compliance
verdict.

## Product rule

Product behavior targets the linked model and native shell. Do not add an iframe panel
or a presentation-only MCP to compensate for missing orchestration.
