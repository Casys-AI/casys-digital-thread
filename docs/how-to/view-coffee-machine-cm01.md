# How-to: inspect the CM-01 mechanical proof

> **Evidence boundary.** This runner verifies one isolated CM-01 drip-tray concept. Its
> reviewed case uses an ABS-like model, a 100 N downward service load, and preliminary
> limits of `1 mm` displacement and `20 MPa` von Mises stress. Passing this case is not
> proof of the whole CoffeeMachine, a fabrication release, or a certification claim.
>
> **Control-plane boundary.** The r6 run below is an immutable historical reference. The
> public Console MCP surface has no generic agent-run lifecycle tools. This historical
> runner is not the fresh CM-01 V3 executor path, so it is not a recipe for an agent or
> browser to advance a new project run. See the
> [CM-01 V3 local golden-run guide](run-cm01-v3-golden-local.md).

## Start the required services

```bash
docker compose up -d syson-db syson-app mcp-syson mcp-build123d mcp-calculix
deno task start
```

The provider MCPs listen on ports `3009`, `3014`, and `3015`. The Console MCP server on
port `3020` exposes the current bounded V3 idea/specification path:
`baseline.from-approved-brief@1`, `architecture.seed-syson-model@2`, and
`architecture.author-inspection-drone@2`. Those operations can record an approved brief,
create its blank SysON container, and author one fixed inspection-drone architecture;
none is a generic CM-01 lifecycle or produces CAD/physics evidence. Docker Compose only
starts providers; it neither executes this historical proof nor advances a project
lifecycle.

The native cockpit is optional during execution, but useful for watching the recorded
operations arrive in Activity:

```bash
deno task preview:thread
```

Its GET and SSE paths remain passive. Opening or refreshing the page never invokes a
provider.

## Read the archived authorization

The active immutable CM-01 history records this exact authorization chain:

1. an agent proposes `review-mechanical-proof-case` against the exact r5 base evidence;
2. a human approves that exact proposal and its fingerprint;
3. a human queues `verify-current-mechanical-design`; and
4. the historical bounded execution process claims and advances the resulting run
   internally.

Those human approval and queue receipts describe this archived r6 run; they are not the
current product interaction model. New projects express consequential decisions through
signed MCP elicitation in chat, and the agent queues only ready registered work. A
registered server-owned executor owns any later provider calls, capture, snapshot
attachment, validation, and lifecycle transitions. No such CM-01 technical executor is
exposed by the current Console MCP server.

The approved CM-01 reference proposal identifies the isolated `190 x 135 x 28 mm`
DripTray, an ABS-like concept model (`E = 2200 MPa`, `nu = 0.35`), a fully fixed rear
vertical face, a `100 N` downward force on the front vertical face, a `5 mm` target
mesh, and the `1 mm` / `20 MPa` preliminary limits. The runner derives its arguments
from that proposal; it does not accept replacement physics from the CLI.

The tracked baseline remains exactly:

```text
coffee-machine-cm01:r5:coffee-machine-build-coffee-machine-cm01-cad-baseline-extension
```

That historical r5 capture has zero mechanical `ConstraintUsage` elements and no
CalculiX verdict. The approved runner is allowed to add only the two proposal-derived
DripTray constraints to SysON before continuing:

```text
assembly_max_displacement <= 1 mm
assembly_max_von_mises <= 20 MPa
```

## Audit the historical bounded runner

For a local maintainer auditing an already prepared historical run, the command-side
runner accepts its exact recorded run ID:

```bash
deno task thread:run-coffee-machine-mechanical \
  --run-id=<recorded-historical-run-id>
```

This is not an MCP execution endpoint and is not a way to create or complete a new
project run. The V2 `baseline.from-approved-discovery@1` remains trusted only for an
exact historical approved-discovery project. The similarly named
`architecture.seed-syson-model@1` and `architecture.author-inspection-drone@1` revisions
remain readable for audit but are planning-only and never dispatched. None is a route
into the current V3 product path.

The current V3 path starts from the exact human-approved living brief with
`baseline.from-approved-brief@1`, then uses `architecture.seed-syson-model@2` from exact
r1 and `architecture.author-inspection-drone@2` from exact r2 and the same authorization
chain. It is not a CM-01 path: those fixed operations create only a SysON container and
one bounded inspection-drone architecture. They create no CM-01 or general CAD, physics,
flight, cost, compliance, or verification evidence. The separate CM-01 V3 golden path
now provides reviewed registered executors with fresh identities; it does not reuse this
r6 reference.

The command executes this backend-only chain:

```text
SysON preflight and constraint extraction
                 │
                 ▼
build123d content-addressed STEP
                 │ exact SHA-256
                 ▼
CalculiX static solve
                 │ unit-bearing observations
                 ▼
thread_observations_normalize
                 │
                 ▼
SysON constraint evaluation
```

The capture is written once under
`state/local/coffee-machine-mechanical-runs/<run-id>.json`. Recorded calls also append
browser-safe provisional activity under `state/local/live-thread-updates/`; that feed is
not canonical evidence.

### Historical runner safe-resume boundary

A retry with the same run ID is accepted only when all prior live activity is confined
to the exact allowed SysON constraint extract, child read, or bounded SysML insertion
operations for the same base revision. The runner re-reads and validates the two exact
approved constraints before reaching CAD.

If the prior attempt reached build123d, CalculiX, normalization, evaluation,
reconciliation, an unknown operation, or a different base revision, retry fails closed.
A persisted capture also cannot be overwritten. Create a newly authorized run instead of
treating partial engineering work as safely repeatable.

## Read the historical publication boundary

Provider success did not complete the historical project by itself. Its bounded process
internally moved through publication, validated and attached the capture with
`deno task thread:attach-coffee-machine-mechanical`, then completed only against the
read-back immutable snapshot and exact evidence references. That sequence describes the
r6 provenance; it is not a set of public calls to replay.

The attachment command fail-closes on authorization, effective arguments, constraint
set, provider outputs, and exact STEP consumption. It saves and reads back the immutable
snapshot before reconciling the provisional feed. It does not itself advance a project
lifecycle, and the public MCP surface no longer exposes a separate publishing or
completion transition.

The completed 2026-08-02 reference run used
`run:erwan-authorize-cm01-mechanical-run-v1`. It published:

```text
coffee-machine-cm01:r6:coffee-machine-mechanical-run:erwan-authorize-cm01-mechanical-run-v1-extension
```

CalculiX consumed the exact STEP SHA-256
`ea061880c9efc043fa0ad8475594a12c447481723e4e46dfdd7dc62a8dca3c84`, measured
`0.10363294359363535 mm` maximum displacement and `0.5309183805726515 MPa` maximum von
Mises stress, and SysON evaluated both limits as `pass`. Active project revision 10
records the run and `verify-current-mechanical-design` work item as `completed` against
that exact r6 evidence.

These results validate the traced component loop and its publication contract. They do
not promote the provisional ABS-like material to a selected production material or
establish whole-machine behavior, manufacturability, release readiness, or regulatory
conformity.
