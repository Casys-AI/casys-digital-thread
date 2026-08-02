# How-to: run and publish the CM-01 mechanical proof

> **Evidence boundary.** This runner verifies one isolated CM-01 drip-tray concept. Its
> reviewed case uses an ABS-like model, a 100 N downward service load, and preliminary
> limits of `1 mm` displacement and `20 MPa` von Mises stress. Passing this case is not
> proof of the whole CoffeeMachine, a fabrication release, or a certification claim.

## Start the required services

```bash
docker compose up -d syson-db syson-app mcp-syson mcp-build123d mcp-calculix
deno task start
```

The provider MCPs listen on ports `3009`, `3014`, and `3015`. The Console MCP server on
port `3020` owns the complementary agent project-control tools. Docker Compose only
starts providers; it neither executes the proof nor advances the project lifecycle.

The native cockpit is optional during execution, but useful for watching the recorded
operations arrive in Activity:

```bash
deno task preview:thread
```

Its GET and SSE paths remain passive. Opening or refreshing the page never invokes a
provider.

## Establish the exact authorization

The runner accepts only the named project case already recorded in the active immutable
project:

1. an agent proposes `review-mechanical-proof-case` against the exact r5 base evidence;
2. a human approves that exact proposal and its fingerprint;
3. a human queues `verify-current-mechanical-design`; and
4. an agent claims the resulting run through `project_agent_run_start`.

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

## Execute the approved run

Use the exact ID returned by the human queue and agent claim:

```bash
deno task thread:run-coffee-machine-mechanical \
  --run-id=<human-queued-and-agent-claimed-run-id>
```

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

### Bounded safe resume

A retry with the same run ID is accepted only when all prior live activity is confined
to the exact allowed SysON constraint extract, child read, or bounded SysML insertion
operations for the same base revision. The runner re-reads and validates the two exact
approved constraints before reaching CAD.

If the prior attempt reached build123d, CalculiX, normalization, evaluation,
reconciliation, an unknown operation, or a different base revision, retry fails closed.
A persisted capture also cannot be overwritten. Create a newly authorized run instead
of treating partial engineering work as safely repeatable.

## Publish in the required order

Provider success does not complete the project. Keep the lifecycle and canonical
publication as three explicit operations:

1. Call `project_agent_run_publish` with `stage: "publishing"`, a new stable
   `commandId`, and the current `expectedRevision`.
2. Validate and attach the capture:

   ```bash
   deno task thread:attach-coffee-machine-mechanical \
     --run-id=<same-run-id>
   ```

3. Call `project_agent_run_publish` again with `stage: "completed"`, another new
   `commandId`, the new project revision, and the exact `resultSnapshot` and
   `evidenceRefs` printed by the attach command.

The attach command fail-closes on authorization, effective arguments, constraint set,
provider outputs, and exact STEP consumption. It saves and reads back the immutable
snapshot before reconciling the provisional feed. It deliberately does not change the
project lifecycle.

The completed 2026-08-02 reference run used
`run:erwan-authorize-cm01-mechanical-run-v1`. It published:

```text
coffee-machine-cm01:r6:coffee-machine-mechanical-run:erwan-authorize-cm01-mechanical-run-v1-extension
```

CalculiX consumed the exact STEP SHA-256
`ea061880c9efc043fa0ad8475594a12c447481723e4e46dfdd7dc62a8dca3c84`, measured
`0.10363294359363535 mm` maximum displacement and `0.5309183805726515 MPa`
maximum von Mises stress, and SysON evaluated both limits as `pass`. Active project
revision 10 records the run and `verify-current-mechanical-design` work item as
`completed` against that exact r6 evidence.

These results validate the traced component loop and its publication contract. They do
not promote the provisional ABS-like material to a selected production material or
establish whole-machine behavior, manufacturability, release readiness, or regulatory
conformity.
