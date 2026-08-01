# Composable MCP Apps: small components, surfaces, and events

The first Compose prototype placed complete standalone viewers side by side. That was
protocol correct, but product-wise weak: each App brought its own masthead, spacing,
controls, and preferred dimensions. A dashboard became a collage of pages rather than
one useful engineering surface.

The new boundary is smaller. An MCP App owns reusable domain components; Compose selects
and arranges them.

```text
tool result -> domain App -> advertised component catalog -> selected surface
                   |                                      |
                   +-- validation and rendering           +-- stack / row / grid
                   +-- local state and actions             +-- stable instance IDs
                   +-- optional standalone surface         +-- declared event routes
```

## Three contracts, not one magic UI

1. Standard MCP Apps still owns the iframe handshake, host theme, display mode, tool
   result, and teardown lifecycle.
2. `mcp-view` adds `io.casys.mcp.view-components/v1`: stable component keys,
   descriptions, an optional standalone surface, a shared visual language, safe
   primitives, and deterministic mounting/cleanup.
3. `mcp-compose` sends `io.casys.mcp.surface/v1`: an explicit JSON-only selection and
   layout of advertised components. `ui/compose/event` remains a separate cross-view
   event route.

Compose never reads the child DOM, sends arbitrary CSS, or generates JavaScript for an
App. A surface contains only `stack|row|grid`, a bounded column count, a gap token,
stable instance IDs, component keys, and JSON props. An unknown key becomes
`unresolved`; it is not silently omitted. A component-only App without a requested
surface becomes `surface-required`; Compose does not fabricate one.

## Standalone and dashboard use the same code

An App with meaningful standalone usage declares one `defaultSurface`, built from the
same components. A product-only palette may omit it. In Compose, YAML selects the useful
subset and arrangement explicitly:

```yaml
- id: simulation
  manifest: mcp-modelica
  surface:
    layout: { type: grid, columns: 2, gap: sm }
    components:
      - { id: status, component: modelica.execution-status }
      - { id: metrics, component: modelica.metrics }
      - { id: provenance, component: modelica.provenance }
  calls:
    - tool: modelica_simulate
```

This is deliberately not a DOM grammar. The agent composes a finite vocabulary with
domain meaning; the owning MCP still decides how a metric, CAD scene, SysML diagram,
table, or action is rendered.

## Current component estates

| MCP                  | Components                                                                                                   | Examples                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------- |
| Modelica             | run identity, execution status, metrics, parameters, provenance, artifacts, warnings, run-list summary/table | `modelica.metrics`          |
| Build123d            | geometry status, metrics, Three.js canvas, export artifacts                                                  | `build123d.geometry-canvas` |
| CalculiX             | solve metrics, mesh summary, constraints, displacement details                                               | `calculix.mesh-summary`     |
| SysON                | 21 components across diagram, model explorer, query, requirements, validation, and value Apps                | `syson.diagram.visual`      |
| ERPNext presentation | BOM list, identity, metrics, materials, operations, and costs                                                | `erpnext.bom.materials`     |

The public ERPNext server is unchanged and remains a valid standard MCP Apps provider.
Product dashboards use a separate read-only Preact MCP at port `3017`. It calls the
published ERPNext data client, exposes one bounded BOM tool, and deliberately has no
standalone default. This separates provider authority from presentation without forking
ERPNext data access.

All new component palettes share the visual tokens and structural classes from
`mcp-view`. That language was extracted from the ERPNext palette after the first real
five-MCP dashboards proved it. Compose still chooses components and layout only; it does
not style child DOM. See
[The mcp-view component language](mcp-view-component-language.md).

## Events remain orthogonal

Choosing visible components does not create communication authority. A source App may
emit a named event, and YAML may route it to an action accepted by another App. Existing
SysON selections and the filter/chart fixture prove this path. A surface change neither
rewrites the route nor grants access to undeclared tools.

## A2UI boundary

A2UI is a useful reference for agent-authored, host-native widget trees. This project
solves a different problem: composing specialized industrial components whose renderer
and state remain inside their MCP App. We may add an adapter for a safe A2UI subset
later, but Compose does not reimplement A2UI or execute agent-generated UI code.

## Source locations and release sequence

- `mcp-server/packages/view/src/components.ts` owns the child component/surface runtime.
- `mcp-server/packages/compose/src/core/components/` owns pure surface resolution.
- `mcp-server/packages/compose/src/host/renderer/js/event-bus.ts` negotiates catalogs
  and host context while preserving standard MCP Apps dimensions and events.
- each domain repository owns its `src/ui/` catalog and component implementations;
- `services/mcp-erpnext-components/` owns the product-only ERP presentation palette;
- this repository owns saved product surfaces under `config/compose/dashboards/`.

JSR currently has `@casys/mcp-view@0.5.0` and `@casys/mcp-compose@0.8.0`. The sibling
workspace contains the post-proof `0.6.0` view candidate (Preact adapter and shared
theme) and `0.8.1` Compose candidate (component-only catalogs). Until those revisions
are published, real integration checks use the sibling builds. After publication,
update domain locks and rerun the same built-resource and Workbench proof.

## Next boundary

The next useful feature is an agent-editable operation model—inspect a surface, propose
a typed patch, preview it, apply it, and retain history. That should extend this stable
component grammar; it should not bring back prebuilt page variants or make raw generated
code the default dashboard language.
