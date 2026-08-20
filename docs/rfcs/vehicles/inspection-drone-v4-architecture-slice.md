Audience: agent · Diátaxis: none · Kind: RFC
Status: implemented
This page is a session brief or study, not the product contract.
Living page: [author architecture SysML](../../how-to/compile/author-architecture-sysml.md)

# Inspection-drone V4 qualitative architecture slice

`architecture.author-inspection-drone@3` is a trusted, server-owned SysON operation. It
accepts only the exact approved brief and the r2 SysON seed artifact of
`inspection-drone-v4`; it writes one fixed recipe, journals the insertion before
dispatch, re-reads the root and package, then persists a content-addressed capture and
one r3 descendant snapshot.

The recipe creates `InspectionDrone` composed of `Airframe`, `EnergySystem`,
`PropulsionSystem`, `AvionicsAndFlightControl`, and `InspectionCameraPayload`, plus
qualitative named requirements. It deliberately retains site/weather/separation, camera
mass/power/dimensions/fixation, and autonomy/wind/battery reserve as TBDs. It produces
no CAD, physical result, certification claim, flight authorization, or manufacturing
verdict.

A WAL entry left at `dispatched` is an unknown provider outcome and is not retried
automatically. Provider tool, arguments, and SysML text are owned by the server; an
agent supplies only the queued run identity.

The r3 gate is deliberately stronger than a list of top-level labels. It asks the
server-owned `syson_part_structure` endpoint to re-read `InspectionDrone` and requires
exactly these five direct `PartUsage` records: `airframe`, `energySystem`,
`propulsionSystem`, `avionicsAndFlightControl`, and `inspectionCameraPayload`. For each
usage it runs the fixed, read-only
`aql:self.ownedRelationship->select(r | r.oclIsKindOf(sysml::FeatureTyping)).type` query
and requires exactly one result whose id is the corresponding top-level `PartDefinition`
id (not only its label). For each named requirement it runs the fixed Documentation-body
query and requires the exact qualitative/TBD text written by the recipe. The
content-addressed capture retains this verified contract, including the provider tool
and fixed query expressions.

`syson_element_get` and `syson_element_children` do not by themselves expose a usage
type or requirement body. If SysON cannot return the expected `syson_part_structure` or
`syson_query_aql` shape, type, or text, the executor fails closed before it publishes
r3; it never infers those facts from its own inserted SysML. This is an evidence
limitation, not a certification, flight, or compliance verdict.

The current read-only SysON probe supports this contract on the prior drone model: the
filtered `FeatureTyping` expression returns one `PartDefinition`, and the
Documentation-body expression returns the exact text. The new recipe's
`RequirementDefinition` documentation remains a post-insertion readback gate: if that
provider release cannot expose it in the same closed shape, r3 is not published.
