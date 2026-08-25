# PS-01 runtime evidence

Audience: both · Diátaxis: reference · Kind: local observation

Observed locally on 2026-08-25 with `start:yolo` and `preview:cockpit` running.

- Project r101; Thread snapshot
  `project:desktop-parts-sorter-ps01:r10:design-write-geometry-225ec098c68860ef5c596d62f0aee556da5fc1d8f3765014a7c665ec7120bd33`.
- Current architecture artifact:
  `architecture-6cf575e5ccdc339f78bf5c75614afe30ff08cb1685688a9935058b1ead6eafd8`.
- Workspace r31; event fingerprint
  `1908ef627d79fd08e25ee579b1c830a0f45fa9d35032e2e7d1bb33115fee2b11`;
  8 modules, 6 active files and 6 active attachments.
- Ready single-root technical captures:
  - SPICE at workspace r28: `0ce29730…1df3`;
  - Modelica at workspace r29: `a26f443a…646e`;
  - Frame CAD at workspace r31: `3a541368…9c1d`.
- Fresh admitted SPICE observations from Thread r6:
  - `@rdrive[i]` and `@rreturn[i]`: `0.0004545455 A`;
  - `i(vlogic)`: `-0.000454545 A`;
  - `v(output)`: `4.545455 V`;
  - `v(supply)`: `5 V`.
- Fresh admitted Modelica observations from Thread r8:
  `normalizedPosition.final` and `normalizedPosition.max_abs` are both
  `0.999954433048095 1`.
- Canonical Frame PartDefinition geometry from Thread r10:
  - authoritative STEP `1187c5725bc16f6c6d4c6caba144b394195834fed8958aaa0b6a4257e521cd3e`;
  - visual GLB `fb7bb6f54fce1e25b45271b6f59e4890ac40a76e5b719837505b131126bacebe`.
- Workbench projection: FRAME `1/1`, SYSTEM MODEL `4/4`, GEOMETRY `2/2`,
  PHYSICS `4/4`, VERIFICATION `0/0`; Frame opens with exact STEP and GLB while
  the other component geometry buttons remain disabled. The evidence inspector exposes
  5 Modelica and 8 SPICE records as engineering facets while their exact host provenance
  stays `digital-thread`.

SPICE and Modelica are documentary L3 observations. The geometry is one exact
PartDefinition, not an assembly. No requirement, L4 evaluation, L5 closeout, routing
judgement, FEA or product verdict has been recorded.
