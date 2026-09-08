# Overview flow

Numeric cable motion and canvas geometry for the native Workbench whiteboard.
The Workbench remains a read-only projection: these modules never call a
provider, invent a Thread entity, or authorize an App.

Generic canvas engines live here. Hull _content_ — what a row is — stays in
`../hulls/`. Visible hull chrome and listed-row bodies live in `../components/`.

## Responsibilities

| Module        | Owns                                                                | Must not                                              |
| ------------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| `motion.ts`   | Critically damped cable morph, topology signatures, path generation | Read or write the DOM, choose a route, invent a cable |
| `geometry.ts` | ViewBox percents, hull bleed, keyboard move step                    | Change layout boxes or persisted placements           |
| `segments.ts` | Segment presentation, drag-route flags, visual corridor union       | Re-route cables or drop an unresolved segment         |

`OverviewThreadD3Flow` remains the orchestrator: pointer capture, keyboard move,
context-menu targets, and the SVG layer that paints one rAF scene. Existing
tests import motion helpers from that file; it re-exports them.

Literal labels (`TRACE GAP`, `UNLINKED`, `documentary`) stay literal.
