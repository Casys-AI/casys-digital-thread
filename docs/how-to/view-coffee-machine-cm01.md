# How-to: view the CoffeeMachine CM-01 digital thread

Use this guide to open the first product-specific Compose dashboard. It presents five
live sources together: the SysON internal-structure diagram, build123d GLB assembly,
ERPNext BOM, Modelica heat-up simulation, and CalculiX bracket solve.

## 1. Start the fleet

Start the engineering stack and confirm that the five product endpoints used by this
dashboard are healthy:

```bash
docker compose up -d
curl --fail --silent http://127.0.0.1:3009/health
curl --fail --silent http://127.0.0.1:3014/health
curl --fail --silent http://127.0.0.1:3016/health
curl --fail --silent http://127.0.0.1:3015/health
curl --fail --silent http://127.0.0.1:3017/health
```

ERPNext remains an external data owner. The read-only component service on `3017` joins
the ERPNext Docker network, uses the published provider client, and reads credentials
from the ignored env file described in
[Show the real ERPNext BOM in Compose](show-erpnext-bom.md).

## 2. Provide local model identifiers

The saved YAML is portable, so it contains placeholders rather than one machine's SysON
UUIDs. Copy the documented argument shape and replace the two SysON values with the
editing-context and diagram IDs returned by the model tools:

```bash
mkdir -p state/local
cp config/compose/args/coffee-machine-cm01.example.json \
  state/local/coffee-machine-cm01.json
```

`state/local/` is ignored by Git. The file also names the BOM item, CAD export, Modelica
kit, and scenario, so a run can override them without modifying the saved layout.

## 3. Compose the dashboard

```bash
deno task compose:cm01
```

Open the printed loopback URL. Expected live evidence for the current example is:

- SysON diagram `CM-01 Internal Structure` with ten part usages;
- build123d export `coffee-machine-cm01.glb`, with orbit, pan, zoom, fit, reset, and
  wireframe controls;
- submitted/default BOM `BOM-CASYS-CM01-001` for item `CASYS-CM01`;
- a newly executed `coffee-machine-v1 / heat-up-nominal` Modelica run.
- the current real bracket solve extrema from CalculiX.

The current real component-surface proof is captured in
[`cm01-component-surfaces.png`](../assets/cm01-component-surfaces.png).

The build123d App receives only a small export reference in the initiating tool result.
It retrieves the bounded GLB through the manifest-approved, App-only
`build123d_export_read` helper. The ERPNext App is similarly limited to BOM list/detail
reads; it cannot create or submit documents from browser code.

The saved surface composes real small components for all five MCPs. Public engineering
Apps may use the same component implementations in a complete default surface. The
product-specific ERPNext palette is intentionally component-only: the YAML selects BOM
identity, metrics, materials, operations, and costs explicitly. Selecting a SysON part
routes `syson.element.selected` to the ERP materials component and highlights the
matching row when one exists.

## What the YAML saves

[`coffee-machine-cm01.yaml`](../../config/compose/dashboards/coffee-machine-cm01.yaml)
saves the panel sources, selected component surfaces, tool arguments, and cockpit
layout. It is a reproducible recipe, not a snapshot database. Starting it calls the MCP
tools again, so SysON and ERP reflect current state, CAD is regenerated, and Modelica
creates a new immutable run. That replay has real solver latency. Persisted result
selection or cached replay belongs in a later Compose feature and must remain distinct
from layout persistence.

Modelica deliberately retains at most 20 runs. When the evidence volume is full, the
server refuses a new simulation instead of deleting proof. Archive or remove prior runs
as an explicit operator action before replaying this recipe; a blank Modelica panel is
not a successful cached replay.

For a one-off override, the launcher also accepts typed `key=value` arguments after the
task name; direct arguments override the local file:

```bash
deno task compose:cm01 --arg bom_item=CASYS-CM01
```

Press `Ctrl-C` in the Compose terminal to close the dashboard and release its per-panel
loopback hosts.
