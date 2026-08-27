/**
 * Domain module for the generic `model.capture-part-definitions@1` operation.
 *
 * Pure: no I/O, no Deno.*, no fetch. All logic here is project-agnostic — the
 * word "coffee", "drone" or any product name is a defect in this module.
 */

export const MODEL_CAPTURE_PART_DEFINITIONS_OPERATION = {
  id: "model.capture-part-definitions",
  version: "1",
} as const;

export const PART_DEFINITIONS_CAPTURE_STATEMENT =
  "Read-only re-read of the exact PartDefinition subgraph sealed by the generic architecture capture. Sibling PartDefinitions added in SysON after that capture are not observed. No CAD, physics, quantity inference, manufacturing claim or verdict is recorded." as const;
