# The mcp-view component language

The ERPNext BOM palette established the visual baseline for Casys component viewers. It
worked because every block reads as one calm engineering fact: a short uppercase title,
dense content, restrained borders, one warm accent, and no page-level chrome competing
with the dashboard. That baseline now belongs to `mcp-view`, not to ERPNext.

## What is shared

`@casys/mcp-view/preact` exports the real reusable presentation primitives, while
`@casys/mcp-view` installs their small shared theme. Domain MCPs import the primitives
instead of copying their markup and CSS:

```tsx
import { Badge, Card, DataTable, MetricGrid } from "@casys/mcp-view/preact";
```

The curated core currently contains:

- cards and compact section titles;
- responsive metric grids;
- status badges and empty/error/loading states;
- dense, horizontally safe tables;
- selected rows and cross-MCP selection feedback;
- simple stacks and rows with container-query behaviour.

The default palette follows host MCP Apps color variables first and supplies the proven
dark neutral fallbacks only when the host provides none. A component can therefore live
inside a small dashboard cell without knowing the page width or inventing `S/M/L/XL`
variants.

## What stays domain-specific

The shared layer does not try to turn all engineering UI into generic cards. SysON owns
its diagrams, Build123d owns its Three.js canvas, CalculiX owns mesh and solve evidence,
Modelica owns simulation provenance, and ERPNext owns BOM semantics. Those components
may extend the theme, but should reuse its shell, spacing, states, and typography.

Compose does not send CSS or inspect an iframe. YAML selects advertised component keys,
their safe props, and a `stack|row|grid` surface. The child MCP App still validates
data, renders its domain, holds local state, and cleans up its renderer.

## Authoring rule

New atomic viewers use Preact by default through `@casys/mcp-view/preact`, unless a
specialized renderer gives a concrete reason not to. They call
`startPreactSurfaceApp()`, which installs the theme and handles the result-driven Apps
lifecycle. A domain component assembles `Card`, `MetricGrid`, `DataTable`, `Badge`,
`KeyValueList`, `Toolbar`, `Button`, `EmptyState`, and `StateMessage`, then adds local
CSS only for its irreducible diagram, CAD, mesh, or evidence layout.

This is shadcn-like in authoring style—small typed building blocks composed in the
consumer—but the canonical primitives are package imports, not copied source files. That
keeps five independent MCP Apps visually and behaviourally aligned through one versioned
contract. Compose still selects only advertised domain component keys; it never receives
arbitrary Preact code from YAML.

A public viewer may keep a `defaultSurface` for standalone use. A product-only palette,
such as `mcp-erpnext-components`, omits it and exposes an explicit component vocabulary
for Compose. Missing composition then yields `surface-required`; no fake standalone
dashboard is assembled.

This gives agents a small visual and semantic language: they compose real domain blocks,
not screenshots, arbitrary DOM, or full pages squeezed into panels.
