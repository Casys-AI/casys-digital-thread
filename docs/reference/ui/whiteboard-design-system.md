# Whiteboard chrome recipes
> Verified-Against: be7714f8 (2026-09-08).

Audience: agent · Diátaxis: reference · Kind: contract

Presentation-only. The Workbench remains a read-only `GET` + SSE projection.
These recipes do not change authority, provider contracts, evidence identities,
viewer sessions, or literal `unavailable` / `unresolved` / `TRACE GAP` copy.

## Ownership

| Surface                                                                                     | Owns                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/ui/src/ui/whiteboard.ts`](../../../src/ui/src/ui/whiteboard.ts)                       | Shared Tailwind + cva chrome: toolbar, viewer, hull monitor, hull controls, reading notes, current-brief, requirements trace, flow items                                                             |
| [`17-saas-shell.css`](../../../src/ui/src/styles/17-saas-shell.css)                         | Default toolbar spatial pin; radial SVG geometry (leaders, label paint-order, focus-ring width). No flow-item, flow-segment or cable state paint.                                                    |
| [`18-overview-thread-flow.css`](../../../src/ui/src/styles/18-overview-thread-flow.css)     | Graph geometry, SVG cables (incoming `#6d28d9`, outgoing `#0f766e`), zoom density, CSS-variable hull placement. Hierarchy parent guides are a separate idle-token orthogonal tree, not graph cables. |
| [`19-project-thread-canvas.css`](../../../src/ui/src/styles/19-project-thread-canvas.css)   | Board/HUD layout, pan viewport, toolbar embedding, selection-note spatial pin                                                                                                                        |
| [`20-project-thread-viewers.css`](../../../src/ui/src/styles/20-project-thread-viewers.css) | Viewer layer transform, SVG tethers, pointer routing, iframe fill                                                                                                                                    |
| Identity classes `overview-thread-*`                                                        | Test hooks, `querySelector`, geometry. Keep them when adding recipes.                                                                                                                                |

Foundation tokens stay `--ui-*` in
[`styles.css`](../../../src/ui/src/styles.css) (`bg-card`, `text-foreground`,
`border-border`, `ring-ring`, `text-brand`, `text-success`, `text-destructive`).
Lane colour (`--flow-color`, `--ui-lane-*`) is domain identity and never a
status. Status never paints a lane.

Unlayered CSS takes precedence over Tailwind utilities. The migrated
declarations were removed from 17/18/19/20 so shared recipes control their
surfaces. Keep this boundary when moving further controls to Tailwind.

`styles.css` declares `@source "./"` so the UI source tree is scanned when
`src/ui/node_modules` is a symlink.

## Recipes

Compose with `cn("overview-thread-…", recipe)`. Variants live on one cva per
surface:

- `whiteboardToolbar` / `whiteboardToolbarButton({ pressed })` /
  `whiteboardToolbarPart`
- `whiteboardViewer({ expanded })` / `whiteboardViewerPart({ part })`
- `whiteboardMonitor` / `whiteboardMonitorPart({ part })` /
  `whiteboardMonitorAction({ app })`
- `whiteboardHullControl()` / `whiteboardHullFold` / `whiteboardHullViewSelect`
  / `whiteboardHullMonitorChip`
- `whiteboardNote` / `whiteboardNotePart({ part })` /
  `whiteboardNoteAction({ app })` / `whiteboardNoteLink`
- `whiteboardBriefPart({ part })` / `whiteboardTracePart({ part })`
- `whiteboardFlowItem({ density, pending })` /
  `whiteboardFlowItemPart({ part, status, emphasis, live })` — shared marker,
  label, detail and viewer affordance for raw FlowNodes and structured rows.
  Idle marker fill is `var(--flow-color)` with a white rim. `pendingMarker` is a
  neutral pulse, never a lane fill. Activity `status` is a marker variant
  (dashed / outline) and never replaces lane colour. Floating `activityLabel` is
  point density only. There is no tree-glyph part.
- `whiteboardFlowCable({ state })` / `whiteboardFlowRadialNode` — radial SVG
  graph cables using the same idle `#6e7f86` / incoming `#6d28d9` / outgoing
  `#0f766e` tokens as `FlowSegmentLayer`. Hierarchy parent guides stay on CSS18
  only; they never pass through `FlowSegmentLayer`. Residual radial exception:
  SVG text paint-order, leader stroke and focus-ring width.

Toolbar pressed uses `aria-pressed` plus the `pressed` variant, not a lane
colour. Selection notes use `whiteboardNoteState` and `whiteboardNotePin`;
related endpoint rows stay in the shared `whiteboardFlowItem` `data-state`
grammar (`related` / `muted` / `default`), with a restrained lane tint or marker
halo weaker than selected, never a dedicated related-row recipe or gray
rectangular ring. Pin state belongs to the presentation controller. Viewer
compact padding/gap uses `@max-[18rem]/viewer` (max-width 18rem). Action and
resize controls keep a minimum hit area (`min-h-6` / `min-h-7` / `min-h-8` /
`min-h-[1.2rem]`).

The hull band must keep the `group` class: fold visibility is `group-hover` and
`group-data-[collapsed=true]`. `data-collapsed` stays on the band; fold is a
child.

## How to change a state

1. Edit the matching recipe in `whiteboard.ts`. Keep the identity class on the
   element.
2. Use existing `data-*` / `aria-*` / `group` attributes (`aria-pressed`,
   `data-active`, `data-alert`, `data-expanded`, `data-viewer-kind`, `data-app`,
   `data-live`, `data-collapsed`).
3. Do not add paint back to 17/18/19/20 for a class whose recipe exists.
4. Pointer, transform, zoom, and CSS-variable placement stay in the owning CSS
   sheet.

## CSS that stays mechanical

- Toolbar: default `absolute` pin in 17; hero `relative` + end alignment in 18;
  board `top: calc(var(--project-thread-top-inset) + 0.35rem)` in 19.
- Viewer layer: `position: absolute`, `transform-origin: 0 0`,
  `pointer-events: none`, world transform in inline style.
- Viewer article: `position: absolute`; width/height/z from inline geometry.
- Hull monitor: `position: absolute`; geometry inline; header
  `touch-action: none`.
- Hull band / monitor chip / resize grip: `--flow-x` / `--flow-y`.
- Selection note: `z-index: 31`; measured placement beside the selected row is
  bounded by the canvas viewport. The CSS pin is only a fallback before
  measurement.
- Reduced-transparency HUD/toolbar background in 19.
