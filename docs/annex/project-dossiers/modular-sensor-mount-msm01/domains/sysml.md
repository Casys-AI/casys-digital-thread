# MSM01 — SysML / SysON

The reviewed architecture r3 is
`architecture-37f2a2db4b76b22d23bd984bcea11dc847827788c348a9f7ae1280d4bd0936a5`.
Its product root and immediate part definitions are:

| Element | Kind | Exact ID |
| ------- | ---- | -------- |
| ModularSensorMount | PartDefinition | `28021de5-947a-4dbe-a925-0fd80d6739e2` |
| BasePlate | PartDefinition | `928bc80a-ccc0-42cf-81c5-70a8d660e04b` |
| Riser | PartDefinition | `fb5d36ed-a1aa-41a2-aa5c-068ede90f833` |
| SensorCradle | PartDefinition | `0ed5ed4c-b8ea-42c8-a247-575eb191a330` |

The root owns the immediate usages BasePlate
`cc6cabf4-2e0b-4033-a5e1-288d04244a1d`, Riser
`55bbfb96-ebd9-4387-ad46-6274a566f3c1` and SensorCradle
`a0878bd5-f3d8-4899-9ec9-50dbffcd4ba7`.

MCP exploration, search and inspect used these identities to traverse root,
occurrence, target definition and linked source records. Thread r10 is the separate
exact part-definitions capture required by the immediate-module export; it does not
add a generic SysML or mechanism surface.
