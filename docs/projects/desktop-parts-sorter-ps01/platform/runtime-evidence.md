# PS-01 runtime evidence

Audience: both · Diátaxis: reference · Kind: local observation

Observed locally on 2026-08-25 after restarting `start:yolo` and
`preview:cockpit`.

- Project r52; Thread snapshot
  `project:desktop-parts-sorter-ps01:r3:model-write-architecture-ff48e5d6e51f42e8ada29c14c731b32b0f16a2b3d38d5c11e2fe0372458d28ab`.
- Architecture artifact and fingerprint digest:
  `architecture-ff48e5d6e51f42e8ada29c14c731b32b0f16a2b3d38d5c11e2fe0372458d28ab`.
- Workspace r27; event contains 8 modules, 6 active files and 6 active attachments.
- Verification closure: 5 files, 5 edges, no diagnostic.
- Passed capture locators at the common r27 basis:
  - frame CAD `0dd0a148…e60478`;
  - diverter CAD `6f840109…5545c1`;
  - Modelica behavior `65045627…f4d4a`;
  - SPICE circuit `9faebe36…33faa6`.
- Combined compilation preview: `unresolved`, with 9 `binding.missing` gaps and one
  `source.dependency-lowering-unavailable` gap.
- Workbench `http://127.0.0.1:5175/#product/structure`: 7/7 SysML elements, no exact
  geometry, no browser console warning or error.

These are local captures and observations, not admission, execution, L4 or L5.
