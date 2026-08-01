# How-to: assemble the CoffeeMachine CM-01 thread

Use this guide to materialize one native `ThreadSnapshot` for CoffeeMachine CM-01 from
evidence which already exists or is read through reviewed, provider-native MCP tools.
Assembly is not an engineering execution command.

## Preconditions

The product subject is declared in
[`config/thread-subjects/coffee-machine-cm01.json`](../../config/thread-subjects/coffee-machine-cm01.json).
It contains exact bindings for the SysON project, build123d STEP artifact path,
persisted Modelica run, and ERPNext item. Do not replace those identities with matching
names.

The local evidence inputs must be available:

- a captured SysON inventory in `state/local/syson-inventory/`;
- the declared Modelica run available through `http://127.0.0.1:3016/mcp`; and
- ERPNext available through `http://127.0.0.1:3012/mcp`.

Capture the SysON inventory explicitly when it is missing or needs refreshing. The
identifiers below are the current CM-01 binding, not values inferred from a display
name:

```bash
deno run --allow-net=127.0.0.1:3009 --allow-write=state/local \
  scripts/capture-syson-model-inventory.ts \
  --project-id=54607f66-c590-4d5e-ac25-2abebe33dfd8 \
  --project-name='Casys CoffeeMachine CM-01' \
  --editing-context-id=01942665-3ded-4d3a-9902-08691eae190e
```

## Assemble

```bash
deno task thread:assemble
```

The task persists successive immutable revisions under `state/local/thread-snapshots/`
and an exact ERPNext capture under `state/local/erpnext-captures/`. It reads:

| Provider | Evidence used by the CM-01 bootstrap                                           |
| -------- | ------------------------------------------------------------------------------ |
| SysON    | Captured read-only model inventory                                             |
| Modelica | Declared persisted run, its model/scenario identities, results, and quantities |
| ERPNext  | Active default BOM list, detail document, and item-filtered Bin query          |

The task does not run `build123d_execute`, `calculix_solve_static`, or
`modelica_simulate`. It does not mutate SysON or ERPNext. Its provider calls are the
read-only Modelica run lookup and the reviewed ERPNext reads.

## Run the live SysON to CAD branch

The canonical snapshot must exist before a live run starts. Keep the Workbench open in
one terminal so the same feed can show the provisional operations:

```bash
deno task preview:thread
```

In another terminal, execute the reviewed build declaration through the two provider
MCPs:

```bash
deno task thread:run-coffee-machine-build
```

This command performs 90 exact `syson_value_read` calls with bounded concurrency, then
one `build123d_export` call. The feed coalesces them into one SysON progress card and
one CAD card; it does not create 91 panels. The runner accepts no caller-supplied Python
and performs no retry. It persists the exact capture under
`state/local/coffee-machine-build-runs/` and leaves its live nodes visible until
publication.

Copy the reported `runId`, validate and attach the capture, then reconcile the
provisional cards:

```bash
deno task thread:attach-coffee-machine-build --run-id=<reported-run-id>
```

Publication creates a new immutable revision with six artifacts: exact SysON source
evidence, canonical build plan, deterministic build123d script, and STEP, GLTF, and STL
exports. Explicit consumption attestations prove source-to-plan, plan-to-script, and
script-to-export identity. The Workbench receives that new revision over SSE without a
page reload.

## Inspect the assembled state

```bash
deno task preview:thread
```

The native Workbench at `http://127.0.0.1:5173/` reads the latest validated CM-01
snapshot through its read-only BFF. It does not call MCP from the browser and does not
rerun assembly on refresh.

After bootstrap, the subject contains the thermal and enterprise observations below. The
explicit SysON-to-CAD run adds build123d evidence in a later immutable revision:

- Modelica maximum water temperature `94.000000073 degC`, time to target `138 s`, heater
  energy `493914.2758 J`, and peak power `1500 W`;
- ERPNext active default BOM `BOM-CASYS-CM01-001` at quantity `1 Nos`; and
- an item-filtered Bin query returning `0` rows.

## Read the limits literally

This snapshot does **not** produce a product verdict. The captured SysON inventory
contains two `RequirementUsage` elements and no `ConstraintUsage`, so there is no
model-owned mechanical criterion to evaluate. No `120 MPa` or other limit is inserted by
the assembler.

The branches share one declared product subject, but their provenance remains bounded.
The Modelica run is an independent versioned system scenario and the ERP observations
are provider-native manufacturing data. Assembly does not claim that changing the STEP
caused the thermal result or the BOM state.

Likewise, zero rows from the ERPNext Bin query means only that this query returned zero
rows. It is not an availability, shortage, or inventory verdict.
