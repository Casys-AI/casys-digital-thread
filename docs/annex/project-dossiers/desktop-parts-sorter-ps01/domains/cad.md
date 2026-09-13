# PS-01 CAD

Audience: both · Diátaxis: reference · Kind: project domain status

`frame.py@3` and `diverter.py@3` pass `build123d-closed-subset-v1`. Their provisional
named dimensions are analyzer levers, not approved product requirements.

The single-root Frame capture at workspace r31 joined `frame_length`, `frame_width` and
`frame_height`, reached admission at Thread r9, and published exact canonical
PartDefinition STEP and GLB assets at r10.

The diverter file declares an exact dependency on frame v2. Its capture succeeds, but a
combined compilation remains `source.dependency-lowering-unavailable` because no
deterministic multi-file CAD lowering exists yet.

No Digital Thread record has published a Diverter target geometry capture, assembly
placement, `assembly-integrity-observation/1.0`, assembly-integrity L4 evaluation, or L5
closeout for PS-01. The direct provider smoke over an exact canonical PS-01 assembly
STEP is recorded separately in [runtime evidence](../platform/runtime-evidence.md); it
does not backfill any of those Thread records or become a geometry verdict. Canonical
Frame geometry alone does not imply any of them.
