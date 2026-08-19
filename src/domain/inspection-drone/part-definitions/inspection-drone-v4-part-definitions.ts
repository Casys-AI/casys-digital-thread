/**
 * Domain module for the product
 * `model.capture-inspection-drone-part-definitions@1` operation.
 *
 * Pure: no I/O, no Deno.*, no fetch. This is not generic
 * `model.capture-part-definitions@1`.
 */

export const INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION = {
  id: "model.capture-inspection-drone-part-definitions",
  version: "1",
} as const;

export const INSPECTION_DRONE_V4_PART_DEFINITIONS_STATEMENT =
  "Read-only PartDefinition structures from the exact qualitative architecture. No CAD, physics, quantity inference, manufacturing claim or verdict is recorded." as const;
