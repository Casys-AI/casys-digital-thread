# PS-01 runtime evidence

Audience: both · Diátaxis: reference · Kind: local observation

The persisted Thread snapshot below was observed locally on 2026-08-25 with `start:yolo`
and `preview:cockpit` running. The provider smoke below is a separate direct
observation.

- Project r101; Thread snapshot
  `project:desktop-parts-sorter-ps01:r10:design-write-geometry-225ec098c68860ef5c596d62f0aee556da5fc1d8f3765014a7c665ec7120bd33`.
- Current architecture artifact:
  `architecture-6cf575e5ccdc339f78bf5c75614afe30ff08cb1685688a9935058b1ead6eafd8`.
- Workspace r31; event fingerprint
  `1908ef627d79fd08e25ee579b1c830a0f45fa9d35032e2e7d1bb33115fee2b11`; 8 modules, 6
  active files and 6 active attachments.
- Ready single-root technical captures:
  - SPICE at workspace r28: `0ce29730…1df3`;
  - Modelica at workspace r29: `a26f443a…646e`;
  - Frame CAD at workspace r31: `3a541368…9c1d`.
- Fresh admitted SPICE observations from Thread r6:
  - `@rdrive[i]` and `@rreturn[i]`: `0.0004545455 A`;
  - `i(vlogic)`: `-0.000454545 A`;
  - `v(output)`: `4.545455 V`;
  - `v(supply)`: `5 V`.
- Fresh admitted Modelica observations from Thread r8: `normalizedPosition.final` and
  `normalizedPosition.max_abs` are both `0.999954433048095 1`.
- Canonical Frame PartDefinition geometry from Thread r10:
  - authoritative STEP
    `1187c5725bc16f6c6d4c6caba144b394195834fed8958aaa0b6a4257e521cd3e`;
  - visual GLB `fb7bb6f54fce1e25b45271b6f59e4890ac40a76e5b719837505b131126bacebe`.
- Workbench projection: FRAME `1/1`, SYSTEM MODEL `4/4`, GEOMETRY `2/2`, PHYSICS `4/4`,
  VERIFICATION `0/0`; Frame opens with exact STEP and GLB while the other component
  geometry buttons remain disabled. The evidence inspector exposes 5 Modelica and 8
  SPICE records as engineering facets while their exact host provenance stays
  `digital-thread`.

## Assembly-integrity provider smoke (not Digital Thread evidence)

A direct smoke ran through the normal provider fleet on the exact canonical PS-01 STEP
at
`state/local/thread-assets/415401322b6ce4678db220c4ad34358a788c73ce81a58745fa0e9e735a5d4968.step`:

- 97,975 bytes; SHA-256
  `415401322b6ce4678db220c4ad34358a788c73ce81a58745fa0e9e735a5d4968`;
- `mcp-build123d` 0.5.0, raw tool `build123d_observe_assembly_integrity`, through the
  normal fleet (not the sandbox);
- toolchain
  `ghcr.io/casys-ai/engineering-toolchain@sha256:7a255f24448ddb6de496c4e47c2d1634c63daea67e9082b558257287215b23b5`;
- unit `mm`; valid BRep; 6 solids and 6 shells; 0 degenerate edges and 0 free edges; 6
  observed occurrences/transforms; 15 pairs; every `intersectionVolume` was `0`;
- every pair was no-contact with minimum distance at least 19 mm.

This is a real provider smoke over these exact bytes, **not** a Digital Thread run. It
does not establish a `verify.observe-assembly-integrity@1` receipt or
`assembly-integrity-observation/1.0` capture, an L4
`verify.evaluate-assembly-integrity@1` capture, or an L5 closeout/gate result. In
particular, no-contact and a distance of at least 19 mm do not prove joints, required
contact, physical assemblability, required clearance, motion, load behavior, safety, or
certification. Digital Thread runtime closeout remains pending.

SPICE and Modelica are documentary L3 observations. The persisted Thread geometry is one
exact PartDefinition, not an assembly-integrity result. No Digital Thread
assembly-integrity L3/L4/L5, requirement, routing judgement, FEA, or product verdict has
been recorded.
