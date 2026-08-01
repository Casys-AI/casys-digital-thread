# How-to: run the CoffeeMachine mechanical workflow

> **Current boundary.** The workflow is executable, but the live CoffeeMachine
> model has no mechanical `ConstraintUsage`. It therefore stops before CAD and
> FEA instead of inventing a material limit.

## Start the provider MCPs

```bash
docker compose up -d syson-db syson-app mcp-syson mcp-build123d mcp-calculix
curl --fail --silent http://127.0.0.1:3009/health
curl --fail --silent http://127.0.0.1:3014/health
curl --fail --silent http://127.0.0.1:3015/health
```

Docker Compose only starts the services. It does not compose the product
interface.

## Inspect the reviewed DAG

The workflow lives at
[`config/thread-workflows/coffee-machine-mechanical-v1.yaml`](../../config/thread-workflows/coffee-machine-mechanical-v1.yaml).
It declares this causal path:

```text
SysON constraints -> build123d STEP + SHA-256
                  -> CalculiX input snapshot + SHA-256
                  -> unit-bearing observations
                  -> SysON evaluation
```

The executor requires runtime values for the SysON editing context and the
element that owns the mechanical constraints. Loading or compiling the YAML
performs no MCP call.

## Interpret the current fail-fast result

The current live model contains two `RequirementUsage` elements and zero
`ConstraintUsage` elements. `syson_constraint_extract` therefore returns an
empty constraint array. The workflow requires at least one constraint and blocks
every dependent node. This is expected and prevents solver work without an
authoritative criterion.

Do not add `120 MPa` or any other stress limit merely to make the workflow
green. The earlier proof used example values `E = 70 000 MPa`, `nu = 0.33`,
density `2700 kg/m3`, and a `500 N` load. Those values do not identify an alloy,
yield strength, design code, or safety factor. They are no longer defaults: the
workflow requires reviewed material and load inputs explicitly.

Before creating the requirement, model at least:

- the selected material or material specification;
- the authoritative yield or allowable strength and its source;
- the design factor or governing standard;
- the resulting stress criterion with units;
- the relation between the requirement and the supported part.

Then call the workflow explicitly. Opening the Workbench must only read
persisted linked state; it must never start CAD, meshing, FEA, or SysON
mutation.

## Preview the product surface

```bash
npm --prefix src/ui ci
npm --prefix src/ui run build
deno task thread:assemble
deno task preview:thread
```

The preview serves the latest persisted CM-01 snapshot at
`/api/thread/workbench`. It combines the attested local CAD → FEA evidence with
captured SysON inventory, the declared persisted Modelica run, and reviewed
ERPNext reads through an explicit identity manifest. It shows real measurements
and exact STEP consumption, but it does not make the independent thermal or ERP
branches causal consequences of the STEP. It also shows the missing model-owned
criterion as a blocker; it does not invent a verdict.
