# Native digital-thread Workbench: compose evidence, not applications

Audience: both · Diátaxis: explanation · Kind: explanation

**Status: accepted target — native schema-3.0 project cockpit, generic documentary/
SysON bootstrap, focus-only project selection, and isolated proof `@3`**

The first Workbench proved that five independent MCP Apps can be discovered,
capability-bounded, mounted, and synchronized. It also exposed the product limit of that
architecture: five isolated applications remain five isolated applications even when
they share colors and small reusable components.

The product Workbench therefore no longer uses nested MCP Apps or iframes as its main
composition primitive. It renders one linked engineering state in one native React +
Vite application. MCP remains the protocol between the backend and the engineering
tools. Provider MCP Apps may still show one rich tool result in another host; they are
not the atelier product page. `preview:browser` refuses.

## Product question

The Workbench is a multi-tool cockpit in which an engineer works with an agent. It must
answer three questions at the same time:

1. What did the agent just produce or change?
2. What does that fact affect across the engineering chain, and why?
3. Which prepared recommendation should the person discuss or confirm next in the paired
   conversation?

Those questions share one evidence model but must not compete visually. The beginner
view leads with current project stage, agent activity, and the next review. Technical
lineage and provider records appear progressively when the person selects the affected
fact. The product may start from an idea, existing CAD, or an existing product; those
entry points converge on the same change-to-proof loop described in
[the product direction](../product/product-direction.md).

The primary UI object is therefore a change and its propagation, not an MCP server or a
dashboard panel. The activity feed is the chronological backbone of the cockpit, not the
whole product: its inline lineage explains impact, and the contextual tool surface is
where the engineer inspects records. Control remains in the paired conversation.

```text
CAD change
  -> invalidates a structural solve
  -> produces a unit-bearing stress observation
  -> evaluates a traced requirement
  -> creates a named violation with evidence and a next action
```

![Five Workbench spaces. The shell is GET and SSE only.](../../media/workbench-five-spaces.svg)

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
reasoning is being streamed. Browsing and inspection are immediate. Human decisions are
explicit, revision-bound confirmations elicited by MCP in the paired conversation;
engineering tool execution is a separate bounded agent operation with recorded inputs
and evidence.

The default human role is reviewer, not technical payload author. Decision states have
different owners in the UI: `required` means the agent is preparing a recommendation,
`proposed` means the conversation has a review question, and `rejected` means the agent
owes a revision. **Project** exposes a lightweight notification view: it signals what
needs attention and leads the reviewer to the relevant context; it is neither a command
surface nor a second technical authoring surface. **Activity** is where the reviewer
follows the live evidence and lineage behind a recommendation. Inspection and any
correction request start with the affected SysON/specification context in **Product**
and the paired agent conversation, never in a generic decision card. The person requests
a revision or confirms the recommendation in conversation; Activity only reflects the
resulting immutable state. Exact hashes and snapshot IDs remain available as audit
context.

## Runtime boundary

```text
native React + Vite SPA                     paired agent MCP client
  | GET + snapshot SSE                       | propose / elicit / queue / execute
  | no command authority                     | bounded registered operations only
  v                                          v
                 immutable EngineeringProject revisions
                              |
                              | registered executors (not the frozen YAML DAG)
                              v
                  Digital-thread orchestrator
                  - code-owned operation registry
                  - artifact fingerprints
                  - provenance and run state
                  - linked ThreadSnapshot
                              |
                              | server-owned sequence
                              v
       SysON / build123d / CalculiX / Modelica / ERPNext
       or an independently qualified local microVM
```

Opening or refreshing the application reads persisted project and thread snapshots. It
never starts CAD, meshing, FEA, or physical simulation. The read and SSE paths remain
passive. A provider recomputation is a separately orchestrated agent action with an
identified change set, durable run state, and provenance.

The current BFF serves the focused durable project and a same-origin SSE stream which
announces newer persisted revisions. It has no default project or fallback: without
durable focus or an explicit project ID it reports awaiting project context. The BFF
exposes no product command or provider-execution authority. Human intent enters through
the paired conversation and consequential decisions are bound to exact revisions through
signed MCP elicitation.

The same project is visible to agents through the Console MCP server. MCP exposes
snapshot, proposal, signed human approval or rejection elicitation, append-only project
changes, server-derived queueing, and narrow execution of registered V3 operations. The
human never supplies tool names or solver payloads, and the agent cannot confirm its own
proposal. Every accepted command converges on one immutable active store with optimistic
revision checks and durable idempotency receipts.

For a new idea/specification project, `baseline.from-approved-brief@1` creates a
SHA-256-addressed immutable document of the exact human-approved living brief and
reviewed plan: documentary `ThreadSnapshot` r1. The cockpit can show its queue, redacted
live milestones, and resulting provenance without presenting it as a technical graph.
This documentary baseline is deliberately pre-technical: it is not a SysML model, CAD
artifact, FEA/simulation result, measurement, requirement verdict, or conformity claim.

The first implemented provider-backed V3 operation, `architecture.seed-syson-model@2`,
is intentionally just as narrow. After an append-only project change has named exact
documentary r1, its server-fixed executor creates a blank SysON project container, blank
SysML document, and root package, then reads the root package back. The
`syson-model-seed-capture/2.0` binds normalized provider identities to the exact
approved brief, documentary artifact, and project change before immutable r2 is
published. The live activity is a small closed sequence, not a generic SysON viewer; the
agent cannot supply a provider, tool, arguments, SysML text, or result. Each
non-idempotent creation is durably recorded before dispatch, so an unknown outcome stops
for review instead of being blindly retried. r2 proves only the editable container
identity: it is not a system architecture, requirements, CAD, simulation, measurement,
or a verdict.

The generic route continues beyond r2 only through separately registered operations for
reviewed architecture, requirements, geometry, proof sealing and isolated CalculiX `@3`. Each
operation must publish and reread its own exact descendant `ThreadSnapshot`; no earlier
project or superficially similar artifact can satisfy completion.

The browser does not call the five MCP endpoints directly. The Deno backend owns service
endpoints, credentials, workflow execution, and result validation. Provider tools keep
their native contracts; normalization happens only when a result is added to the linked
thread model.

## Presentation boundary

The product cockpit is a React + Vite SPA (`native-preview.tsx` mounts
`ThreadWorkbench`). Presentation primitives live in `src/ui/src/ui/*`. A local
token copy (`src/ui/src/view/mcp-view-theme.ts`) holds `--cockpit-*` and
`.cockpit-surface`; leftover `.mcp-view-*` class rules were retired. The native
bundle must not import `@casys/mcp-view` and must not contain the Apps handshake
(`ui/initialize`, `toolresult`). `deno task verify:thread:presentation` enforces
that boundary.

The standalone browser Workbench talks to the BFF over HTTP and SSE. It is not an
MCP App and is not embedded through an Apps host. Individual provider viewers
remain useful when an agent calls one provider tool and wants one rich result in
that provider's own host. An iframe remains an isolation fallback for third-party
or unreviewed Apps; it is not the first-party product layout.

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

The current vertical slice is deliberately bounded:

1. build123d produces and hashes an identified STEP artifact;
2. CalculiX snapshots its exact input and rejects an expected-hash mismatch before
   meshing;
3. solver observations are normalized with units and source identities before SysON
   evaluates model-owned criteria;
4. the UI follows persisted revisions, renders recorded dependencies, keeps unlinked
   provider branches separate and opens one contextual inspector;
5. reloading the shell starts no engineering computation;
6. consequential human decisions happen in the paired conversation and append immutable
   project revisions;
7. agents queue only registered, server-derived runs and cannot confirm their own
   proposals; and
8. completion fails closed until an exact descendant snapshot contains new or
   content-changed evidence from the run basis.

This is an evidence assembly, not a causal merger. CAD → FEA becomes an attested edge
only after a solver run consumes the exact STEP and its result is canonically published.
Modelica and ERPNext records remain independent branches until an explicit
transformation or requirement trace links them. A successful provider run is never by
itself a compliance, fabrication-release or certification verdict.

## Product rule

Product behavior targets the linked model and native shell. Do not add an iframe panel,
a presentation-only MCP, cockpit command buttons, or a browser-to-provider escape hatch
to compensate for missing orchestration.
