/**
 * Operation constants for the first-order FEA sensitivity analysis vertical.
 *
 * Two operations, two distinct authorities:
 *
 *   analyze.run-fea-sensitivity@1 — runs the two-solve finite-difference
 *   study (base + stepped geometry) against a sealed sensitivity-study-case/2.0
 *   and publishes dimensioned observations and a sensitivity-study capture
 *   artifact. NEVER a verdict.
 *
 *   model.write-sensitivity-edges@1 — reads a sealed sensitivity-study
 *   capture artifact from the thread, renders the derivative set as a SysML
 *   PartDef (via renderSensitivityEdgeSetSysml), inserts it into SysON, and
 *   publishes the resulting sensitivity-edges artifact.
 *
 * Why two operations — the measurement authority (CalculiX, observed data) and
 * the model-authoring authority (SysON, structural declaration) are deliberately
 * separate. The measurement step can be re-run without re-authoring; the
 * model-write step can be reviewed independently before any SysON mutation.
 */

export const ANALYZE_RUN_FEA_SENSITIVITY_OPERATION = {
  id: "analyze.run-fea-sensitivity",
  version: "1",
} as const;

export const MODEL_WRITE_SENSITIVITY_EDGES_OPERATION = {
  id: "model.write-sensitivity-edges",
  version: "1",
} as const;
