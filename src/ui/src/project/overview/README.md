# Whiteboard UI

The whiteboard projects recorded project and Thread data. Its local UI state
never creates an engineering fact, a viewer capability, or a provider command.

## Component and state ownership

| Layer              | Location                                                        | Owns                                                                                |
| ------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Foundation         | `../../styles.css`, `../../ui/`                                 | Theme tokens, Button, Badge and other shared primitives                             |
| Whiteboard chrome  | `../../ui/whiteboard.ts`                                        | Tailwind recipes and visual variants for controls and floating surfaces             |
| Hull content       | `hulls/`                                                        | Exact row identities, source/record/navigation distinctions and presentation models |
| Canvas components  | `components/`                                                   | One flow-item surface for raw and structured rows; hull chrome; listed-row body     |
| Canvas engines     | `flow/` and the adjacent layout/routing modules                 | Coordinates, routing and animation                                                  |
| Local presentation | `whiteboard/`                                                   | State transitions, project hydration and local persistence                          |
| Composition        | `../overview-thread-hero.tsx`, `../overview-thread-d3-flow.tsx` | Connect projected data, presentation state, interactions and visual pieces          |

A component belongs with the responsibility it implements; its size alone does
not determine its folder. Do not introduce atoms/molecules/organisms folders.

Hierarchy hulls share one visible grammar: `OverviewHullContentRow` →
`FlowStructureRow` → `FlowItemSurface`. Saturated domain point, white rim,
selected halo, muted network state, right-aligned detail and compact viewer
affordance. Both the structured shell and the fail-closed `FlowNode` fallback
set `data-whiteboard-flow-item="true"` and share roving tabIndex plus arrow-key
focus movement. `FlowNode` is not a parallel records-mode renderer; it remains
only for a group without exploitable hull rows. The radial `HeroNode` is outside
the hull contract. While viewer hierarchy for the current basis is in flight,
the whiteboard, controls, hull chrome and graph cables stay; only candidate
hulls show neutral placeholder rows inside their own body. After a terminal
available or unavailable result those hulls stay on the shared structured path;
they never flash raw FlowNodes. Activity status never replaces lane colour; a
floating caption exists only in point density.

Radial mode keeps SVG markers and leaders; `FlowSegmentLayer` is not used there.
Radial graph cables share the Thread graph idle `#6e7f86` / incoming `#6d28d9` /
outgoing `#0f766e` tokens via `whiteboardFlowCable`. Leaders stay a soft layout
affordance in `17-saas-shell.css`, never an inspected Thread edge. Hierarchy
parent guides are CSS18 only. Residual exception: SVG text paint-order, leader
stroke and focus-ring width stay geometry in `17-saas-shell.css`.

## Keep different kinds of state separate

- Server projections own recorded identities and literal contract states such as
  `unavailable`, `unresolved`, `documentary`, `TRACE GAP` and `UNLINKED`.
- Persisted presentation owns project-scoped placements, the viewport and exact
  viewer presentation. Reopening a saved session still requires its current
  capability.
- Selection, hover, focus and pointer gestures are transient UI state. They must
  not become evidence or trigger an engineering operation.
- Cable animation owns transient motion values. An animation frame is not a
  saved layout change.

Changing the project must isolate its presentation. Receiving a new snapshot
must reconcile exact identities without replacing the user's valid placement. An
unknown session registry is different from a known empty registry.

## Making a coherent change

1. Choose the owning layer above. Keep semantic data preparation out of a
   Button, hull header or canvas engine.
2. Use shared Tailwind recipes for ordinary chrome, including hover, focus,
   pressed, disabled and compact states. Remove the corresponding historical CSS
   declarations when migrating a surface; do not fight them with `!important`
   utilities.
3. Retain identity classes and `data-*` attributes where geometry, accessibility
   or interactions depend on them. These hooks do not require a second styling
   system.
4. Make coordinated state changes through the presentation controller. Add a
   transition test for an interaction that spans loading, replacement,
   restoration or a project switch.
5. Validate the changed behavior in the mounted whiteboard. Source-text checks
   can protect a narrow contract, but are not evidence of a working click,
   pointer gesture or browser lifecycle.

Domain colors identify disciplines. Status colors communicate state. Selection
and keyboard focus must remain distinguishable from both.

See the [hull contracts](hulls/README.md),
[flow responsibilities](flow/README.md),
[Tailwind ownership](../../../../../docs/reference/ui/whiteboard-design-system.md)
and
[browser validation](../../../../../docs/how-to/setup/validate-whiteboard-interactions.md).
