# Overview flow components

Presentational hull chrome and listed-row bodies for the whiteboard canvas. They
take controlled props from `OverviewThreadD3Flow` and never own source/record
identity. Shared row actions and the contextual-menu body stay in
`../hulls/row.ts` and `../hulls/row.tsx`.

## Responsibilities

| Module                     | Owns                                                         | Must not                                      |
| -------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| `hull-chrome.tsx`          | Band, fold, foot, monitor, resize; group caption             | Drag/keyboard move, view-mode buttons, cables |
| `flow-item-surface.tsx`    | Shared marker, label/detail, viewer affordance, visual state | Button actions, presentation/graph identity   |
| `flow-item-interaction.ts` | Shared tabIndex, keyshortcuts, Enter/Space/arrow contract    | Graph toggle vs hull-row activation           |
| `flow-row-body.tsx`        | Listed node name/meta using the shared label/detail recipe   | Structure-row identity, a second marker style |

Pointer capture, hull view/sort controls, structure-row shells, and `FlowNode`
shells stay on the orchestrator so existing source-pinned tests and keyboard
behavior remain exact. Density (`controlsVisible`, collapsed, matrix) is passed
in; these components do not invent a hull view. `flow-item-interaction.ts` holds
the shared roving tabIndex, `aria-keyshortcuts` and Enter/Space/arrow contract;
graph toggle versus hull-row activation stay on each shell.

Structured rows instantiate `FlowItemSurface` and the same `data-state` /
`data-whiteboard-flow-item` contract. `FlowNode` is the fail-closed fallback for
a group without exploitable `OverviewHullContent` rows; it is not a second
records-mode grammar. Related destinations use that state machine, never a
second ring recipe. Hierarchy reorganizes those items; it does not add a second
node style. Parentage is indentation plus orthogonal hierarchy connector paths,
never a static tree glyph. Pending hulls reuse the same surface with the neutral
`pending` marker, never a saturated product dot. The renderer does not paint
FEA, SysML, or Brief identities; `role`, `availability`, and `provenance` stay
on the hull contract.

Activity status is a marker variant on that surface. A floating status label is
point density only; listed modes use `FlowRowBody`.

Do not copy `overviewHullRowPresentation` or parent-row identity here.
