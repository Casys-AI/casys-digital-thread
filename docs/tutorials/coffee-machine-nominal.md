# Tutorial: inspect the CoffeeMachine nominal scenario run

This tutorial follows a real, persisted OpenModelica run through the local
console. It deliberately proves a narrow statement: the approved nominal
scenario reached the temperature target declared by that scenario. It does not
create, edit, or validate a product requirement.

By the end, the Runs view will show a separate simulation state and a live
SysON comparison with values, units, margin, source plan, and hashes.

## Before you begin

You need Docker, Deno, Node.js, and an MCP-capable client. Start at the
repository root. The commands below use only loopback endpoints.

## 1. Start the engineering services

```bash
docker compose up -d
```

This starts SysON and the four engineering MCP servers. In particular,
`mcp-modelica` owns the immutable `/runs` records and SysON owns the
units-aware comparison tool. Wait for the services to be healthy before going
on.

## 2. Obtain the approved CoffeeMachine evidence

First ask the Modelica MCP server which approved kits and scenarios it offers:

```text
modelica_kit_list({})
```

Then, from the same MCP-capable client, run the approved nominal scenario if
your local Modelica volume does not already contain one:

```text
modelica_simulate({
  model_id: "coffee-machine-v1",
  scenario_id: "heat-up-nominal"
})
```

`modelica_simulate` accepts only approved, versioned model/scenario identities
and bounded parameter overrides. It produces evidence; it does not return a
pass/fail requirement verdict. Use `modelica_run_list({})` and
`modelica_run_get({ run_id: ... })` to inspect the immutable record directly.

The first real local run currently recorded in the development stack is
`run_64079a7b-a866-4d7e-9376-d9be40b6b945`. It completed on 2026-07-30 with
`water_temperature_max = 94.00000007343664 degC`. A new run gets its own ID,
but receives the same comparison only when its exact model and scenario
identities match the plan described below.

## 3. Build and start the console

```bash
npm --prefix src/ui ci
npm --prefix src/ui run build
deno task start
```

The read-only console MCP server now listens at
`http://127.0.0.1:3020/mcp`. Leave it running.

## 4. Open the same MCP App in a browser

In a second terminal:

```bash
deno task preview:browser
```

Open <http://127.0.0.1:3021/>. The page hosts the registered resource
`ui://casys-digital-thread/console`; it does not read a local fixture or the
Docker volume directly. See the [browser-preview how-to](../how-to/preview-console.md)
for the harness boundary.

## 5. Read the run and its comparison

In **Runs**, select `coffee-machine-v1 / heat-up-nominal`. The console first
shows the OpenModelica stage and then loads the detail through
`console_run_detail`. For the recorded first run, read the result in this
order:

1. **Simulation** is `succeeded`: OpenModelica produced measurements and
   hashed artifacts.
2. **Scenario contract** is `passed`: SysON evaluated the one planned
   condition, `water_temperature_max >= 90 degC`.
3. **Computed / limit / margin** are `94.00000007343664 degC`, `90 degC`, and
   `4.000000073436638 degC` (4.44%).
4. The second stage names `syson_constraint_evaluate`; the evidence ledger
   points to `config/verification-plans/coffee-machine-nominal-v1.json`.
5. The plan's raw-byte SHA-256 is
   `2208a36ee6c2bae10422550ad032f43e7720fe25833152840bc9b80da2ed8b7d`.

The full binding is intentionally strict:

| Item | Bound identity |
| --- | --- |
| Model | `coffee-machine-v1` version `0.1.0`, SHA-256 `a641b63a493435fd2ce8123a7b6afbd478656a124610ca33d22112985af8e8ec` |
| Scenario | `heat-up-nominal`, SHA-256 `5db8a06592050a03a8d727900801f9185b2e7fa2fb3092ce15dd3c6c70eb0941` |
| Condition | `water_temperature_max >= 90 degC` |
| Scenario provenance | horizon `900 s` |

If the identity does not match, the console leaves the run
`not_evaluated`; it never applies the verdict to a merely similar run.

## 6. Interpret the result correctly

The `90 degC` threshold comes from the versioned nominal scenario. Therefore:

- `passed` means that this evidence satisfies this scenario contract.
- It does **not** mean that the CoffeeMachine product satisfies all product
  requirements.
- It does **not** create or update a SysON project requirement.
- The `900 s` horizon identifies the scenario that was run; it is not a
  maximum heat-up-time requirement.

To promote a real product requirement later, model its business limit and
traceability in SysON, then attach the appropriate evidence to that requirement.
Do not silently promote the scenario contract.

## If the expected row is missing

- If no Modelica run is listed, create the approved run in step 2 and refresh
  the console.
- If Fleet reports a service as unavailable, inspect the ports in the
  [workspace reference](../reference/workspace-map.md), then rerun the
  read-only refresh.
- If the browser shows only labelled demo data, verify that the console is
  running on `3020`, then reload the local harness on `3021`. Do not treat the
  demo fixture as a live result.
