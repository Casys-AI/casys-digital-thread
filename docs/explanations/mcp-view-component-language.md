# The mcp-view component language

The ERPNext BOM palette established the visual baseline for Casys component viewers. It
worked because every block reads as one calm engineering fact: a short uppercase title,
dense content, restrained borders, one warm accent, and no page-level chrome competing
with its host. That baseline now belongs to `mcp-view`, not to ERPNext.

The same primitives serve two different shells. Standard MCP Apps keep their isolated
runtime for individual rich tool results. The native digital-thread Workbench imports
reviewed first-party components directly so that one application owns layout, selection,
navigation, and linked state.

## What is shared

The intended native import is the presentation-only `@casys/mcp-view/preact/components`
entry point. It exports the reusable primitives and shared theme without the Apps
lifecycle. Provider MCP Apps may continue to use `@casys/mcp-view/preact`, which also
exposes the lifecycle adapter.

```tsx
import { Badge, Card, DataTable, MetricGrid } from "@casys/mcp-view/preact/components";
```

The curated core currently contains:

- cards and compact section titles;
- responsive metric grids;
- status badges and empty/error/loading states;
- dense, horizontally safe tables;
- selected rows and cross-MCP selection feedback;
- simple stacks and rows with container-query behaviour.

The default palette follows host MCP Apps color variables first and supplies the proven
dark neutral fallbacks only when the host provides none. Container-aware components can
therefore live in an isolated result view or in the native shell without inventing
`S/M/L/XL` variants.

## What stays domain-specific

The shared layer does not try to turn all engineering UI into generic cards. SysON owns
its diagrams, Build123d owns its Three.js canvas, CalculiX owns mesh and solve evidence,
Modelica owns simulation provenance, and ERPNext owns BOM semantics. Those components
may extend the theme, but should reuse its shell, spacing, states, and typography.

The native shell imports reviewed first-party components and renders a linked
`ThreadSnapshot` projection directly. YAML selects data-producing workflow nodes and
bindings; presentation remains native application code.

## Authoring rule

New atomic components use Preact by default through `@casys/mcp-view/preact/components`,
unless a specialized renderer gives a concrete reason not to. An MCP App adapter calls
`startPreactSurfaceApp()` from `@casys/mcp-view/preact` for the result-driven Apps
lifecycle. The native shell imports the pure component and theme layer without starting
that bridge. Domain UI assembles `Card`, `MetricGrid`, `DataTable`, `Badge`,
`KeyValueList`, `Toolbar`, `Button`, `EmptyState`, and `StateMessage`, then adds local
CSS only for its irreducible diagram, CAD, mesh, or evidence layout.

This is shadcn-like in authoring style—small typed building blocks composed in the
consumer—but the canonical primitives are package imports, not copied source files. That
keeps isolated MCP Apps and the native shell visually aligned through one versioned
contract. Workflow YAML never receives arbitrary Preact code.

A provider viewer may keep a `defaultSurface` for a single rich MCP result. The product
Workbench does not mount that viewer; it imports trusted primitives and domain renderers
directly.

### Release gate

This repository consumes `@casys/mcp-view@0.7.1`, the first published version with the
pure `./preact/components` export. `deno task verify:thread:presentation` is therefore a
hard gate: it requires that exact import boundary and fails if `ui/initialize`,
`toolresult`, or `postMessage` reappear in the native bundle. No sibling or `file:`
dependency is involved.

This gives agents a small visual and semantic language without making iframe layout the
product architecture: agents compose workflows and linked evidence, while trusted UI
code composes reusable domain blocks.
