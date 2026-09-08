# Whiteboard UX follow-up

Contributor work list from the whiteboard review of 2026-09-08. This tracks
presentation work, not engineering operations or authoritative evidence.

The foundation is implemented: shared Tailwind recipes, controlled canvas
components, extracted geometry/motion helpers and a project-scoped presentation
controller. The integration gate passed 577 UI tests, including browser
coverage, and 10 cable-motion tests. The browser test also exposed and now
protects against a stale canvas effect overwriting restored hull positions.

| Priority | Reported problem                                                       | Intended behavior                                                                     | Status                                         |
| -------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1        | Selection note appears far from the selected row                       | Position the note near the selection and keep it inside the viewport                  | In progress                                    |
| 1        | Panning clears selection, note and highlighted links                   | Distinguish background click from drag; support pin/unpin and explicit close          | In progress                                    |
| 1        | Switching tree/list/points retains an unsuitable hull size             | Size each mode to its content; respect deliberate manual sizing                       | View switch drops stale width/height/scrollRow |
| 2        | Planned Project activities clutter the engineering canvas              | Keep scheduling in Activity; preserve recorded evidence and its identity              | In progress                                    |
| 2        | FEA has apparently duplicated calculated-result rows                   | Current-only `engineering-cases/1.1` rows; independent cases stay distinct            | No series/history HULL; no fabricated lineage  |
| 2        | A verdict hull is titled with the provider name SysON                  | Use a semantic title supported by exact operation/type provenance                     | In progress                                    |
| 2        | Brief lacks a useful root and individual nested items                  | Root for the current brief viewer, sections, then exact snapshot items                | In progress                                    |
| 2        | Hull-border edges hide their actual target row                         | Anchor and highlight exact visible rows; never fabricate an endpoint                  | In progress                                    |
| 3        | Large trees need a controllable reading depth                          | Add a depth control consistent with collapse, links and automatic dimensions          | Presentation-only follow-up; not this pass     |
| 3        | Physics, viewer invocation and spatial interaction need a wider review | Review real pan/zoom/drag/resize/selection scenarios before changing the motion model | Planned                                        |

## Additional loading and grouping reports

- Newly captured RadialArm requirement (Thread r87) appeared in another hull:
  investigate its exact kind, operation and lane assignment, then keep it in
  SYSML.
- Cold load appears to switch styles, with inconsistent cell outlines: compare
  settled CSS with staged hierarchy/session projection before changing
  rendering.
- Full content sizing exposed unrouted connections in the r620 canvas: inspect
  actual computed ports and obstacles; preserve every exact edge.
- Selection notes are now bounded by the canvas viewport, including long
  historic Brief sources, so they do not cover the Activity strip.

Same-id mechanical-proof revisions are not a series HULL and not a fabricated FEA
lineage. The whiteboard is current-only via `current-engineering-cases`. Exact cases
stay in `engineering-cases/1.1` `cases`. Explicit Requirement and Geometry `supersedes`
keep the generic current-only graph fold.

## Acceptance boundaries

- Click selection, exact viewer opening and engineering commands are different
  actions. This work changes only the first two UI interactions.
- A shared label is not proof that two records are versions. Missing or
  ambiguous lineage remains visible as such.
- A current Brief item cannot impersonate a historical source endpoint. Exact
  snapshot/item joins determine row correspondence.
- New chrome and interaction states use the shared Tailwind recipes. Spatial
  geometry stays in the canvas layer.
- Browser evidence must include actual input and lifecycle transitions; a source
  assertion alone cannot validate interaction behavior.

A controllable tree `maxDepth` remains presentation-only follow-up. It must stay
consistent with collapse, parent guides and automatic dimensions, and it is not
an engineering operation.

See [component ownership](../../../src/ui/src/project/overview/README.md),
[Tailwind recipes](../../reference/ui/whiteboard-design-system.md), and
[browser validation](../../how-to/setup/validate-whiteboard-interactions.md).
