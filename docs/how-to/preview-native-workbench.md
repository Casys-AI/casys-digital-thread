# How-to: preview the native digital-thread Workbench

Use this guide to inspect the single-shell Preact product surface against a persisted,
canonical `ThreadSnapshot`. The page never starts an engineering tool.

## Assemble the observed CM-01 evidence

Install the UI dependencies once, then assemble the declared CoffeeMachine CM-01 subject
from its captured and provider-read evidence:

```bash
npm --prefix src/ui ci
deno task thread:assemble
```

The assembler reads the workspace-declared identity manifest, captured SysON inventory,
the attested CAD → FEA capture, one persisted Modelica run, and two reviewed ERPNext
reads. It writes successive immutable canonical documents under
`state/local/thread-snapshots/`; all captures remain ignored local state. See
[the assembly how-to](assemble-coffee-machine-thread.md) for prerequisites and the exact
read boundary.

The command reports five providers, `requirements: 0`, and
`verdict: unavailable-no-model-owned-mechanical-criterion`. This is expected: the live
CoffeeMachine model has no approved mechanical `ConstraintUsage`.

## Start the read-only BFF

```bash
deno task preview:thread
```

The task builds the dedicated single-file Preact shell and starts the Deno BFF at:

```text
http://127.0.0.1:5173/
```

No Docker service, Console MCP server, MCP Apps host, or provider MCP is required to
read an already persisted snapshot. Refreshing the page performs one ordinary HTTP GET
and opens one same-origin server-sent event stream. Neither path reruns assembly,
build123d, CalculiX, or Modelica. Provider MCP calls happen only in an explicit backend
runner such as `deno task thread:run-coffee-machine-build`.

## Inspect the truth boundary

```bash
curl -i http://127.0.0.1:5173/api/thread/workbench
```

The response header must contain:

```text
X-Casys-Data-Source: canonical-thread-snapshot
```

While an engineering run is waiting for canonical publication, the value is
`canonical-thread-snapshot+live-updates`.

The live read path is:

```bash
curl -N http://127.0.0.1:5173/api/thread/workbench/events
```

It emits the latest validated projection as `event: thread-snapshot`. Event IDs are
`<canonical-revision>:<live-sequence>`, so persisted MCP activity can update the
existing feed before a new immutable snapshot exists. Canonical publication replaces the
provisional nodes in place. Reconnecting with `Last-Event-ID` replays no tool call.

The projection must show:

- source `observed`, not `fixture`;
- exact producer and consumed SHA-256 values for every claimed CAD handoff;
- mass `0.05691576 kg`, maximum displacement `0.0427849 mm`, and maximum von Mises
  stress `26.29 MPa`;
- four explicit branches in addition to SysON: build123d, CalculiX, Modelica, and
  ERPNext;
- zero requirements and an unavailable verdict, not a successful one.

The page opens on the lineage feed. Use it as the primary navigation:

- leave **Follow live** enabled so a newly persisted fact becomes active automatically;
- read the active card's complete inline subgraph as upstream evidence → selected fact →
  downstream impact;
- pause following or select an older card only when revisiting history;
- select an edge to inspect its typed relation, rationale, and any hash attestation;
- switch between **Tool context** and **Exact record** in the right drawer;
- open **Graph** for the complete subject graph and **Show all evidence** only when
  implementation artifacts and consumption proof nodes are needed;
- treat separate component frames as missing causal links, not layout errors.

Use **Parts** when the navigation starts from a physical component instead of a thread
event:

- select a PartUsage in the SysON structure, then switch to ERPNext without losing the
  selected component;
- read the exact provider IDs in the trace strip and open their canonical evidence in
  the right inspector;
- select the root **CoffeeMachine CM-01**, then **build123d**, to orbit the real STL
  display mesh; every reviewed child keeps its own exact assembly identity;
- treat `Unlinked facet`, `TRACE GAP`, and `UNLINKED` literally. They mean that the
  current snapshot has no reviewed provider identity for that component;
- distinguish the STL display hash from the authoritative STEP SHA-256 shown below the
  viewer.

The component declaration is loaded from
`config/thread-subjects/coffee-machine-cm01.components.json`. The ERP identities are
backed by the persisted full `erpnext_bom_get` document, not by the BOM-list header.

The local snapshot records its exact provider revisions and capture timestamps. Treat it
as integration evidence unless those provider revisions are released and reproduced in
the target environment.

## Know what this slice proves

It proves durable canonical snapshot validation, explicit provider-to-subject and
component identity, exact CAD → FEA artifact identity, persisted Modelica observations
and ERPNext BOM detail, a read-only BFF, and one coherent native UI with shared
selection and no nested Apps.

It does **not** prove:

- a new solve at preview time;
- a model-owned mechanical requirement or compliance verdict;
- the SysON evaluation and correction loop;
- a browser execution API. The BFF intentionally exposes reads and SSE only; explicit
  backend runners own provider MCP calls.

The assembly groups independent branches under a reviewed CM-01 identity; it does not
manufacture causal links between the CAD/FEA, thermal, and ERP branches.

## Compare the preview paths

| Command                     | Address                  | Purpose                                      |
| --------------------------- | ------------------------ | -------------------------------------------- |
| `deno task preview:thread`  | `http://127.0.0.1:5173/` | Native product shell over persisted evidence |
| `deno task preview:browser` | `http://127.0.0.1:3021/` | Console MCP App against the Console server   |

MCP Apps remains useful for one rich tool result or for embedding the complete Workbench
once in an agent host. It is not used to compose the first-party product page.

## Stop the preview

Press `Ctrl-C` in the BFF terminal. Stopping it does not affect Docker, engineering
services, Console state, or persisted Modelica runs.
