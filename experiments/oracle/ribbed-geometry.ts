/**
 * Pure, deterministic geometry functions for the ribbed-tray FEA experiment.
 *
 * Why transversal ribs: the five ribs run along the y-axis (span −60..+60 mm),
 * stiffening the plate against its primary bending mode (load applied at y ≈ −67,
 * support at y ≈ +67). Longitudinal ribs — aligned with the load direction — would
 * contribute almost nothing against that bending. The stiffening effect of a
 * transversal T-section grows with R, but not proportionally: the composite T-section
 * moment of inertia increases roughly with R² and saturates as the rib centroid moves
 * far below the plate neutral axis. There is no single-variable textbook formula for
 * five discrete ribs on a finite plate — that is exactly why this geometry is chosen
 * as the experiment subject instead of the earlier solid box whose H³ law the LLM
 * subject recites unprompted.
 *
 * Why the selection bands never touch the ribs: the FIXED band is at y ∈ [66.5, 68.5]
 * and LOADED at y ∈ [−68.5, −66.5]. Each rib spans y ∈ [−60, +60]. Since 60 < 66.5,
 * the rib faces always lie outside both selection bands regardless of R. The boundary
 * conditions are therefore stable under R variation, and the measured u(R) reflects
 * only rib stiffening — never a banding-artefact. This is the lesson learned from
 * the tangency failures of the first sensitivity campaign.
 */

/** Minimum reviewed rib height (inclusive). */
export const RIB_HEIGHT_MIN_MM = 1 as const;

/** Maximum reviewed rib height (inclusive). */
export const RIB_HEIGHT_MAX_MM = 14 as const;

/**
 * Render a build123d Python script for a ribbed tray at the given rib height.
 *
 * Geometry (all in mm, origin at plate centre):
 *   Plate : 190 × 135 × 6, z ∈ [−3, +3]
 *   Ribs  : 5 × (8 × 120 × R), x ∈ {−60, −30, 0, 30, 60}, y ∈ [−60, +60],
 *            z ∈ [−3−R, −3]
 *
 * The `+` operator in build123d algebra mode performs boolean union, so the
 * result is a single fused solid ready for STEP export and Gmsh meshing.
 *
 * @throws {TypeError} when ribHeightMm is not finite, ≤ 0, or outside [1, 14].
 */
/** Second design parameter of the two-parameter bench: plate thickness. */
export const PLATE_THICKNESS_MIN_MM = 4;
export const PLATE_THICKNESS_MAX_MM = 10;
export const PLATE_THICKNESS_DEFAULT_MM = 6;

function requirePlateThickness(plateThicknessMm: number): void {
  if (
    !Number.isFinite(plateThicknessMm) ||
    plateThicknessMm < PLATE_THICKNESS_MIN_MM ||
    plateThicknessMm > PLATE_THICKNESS_MAX_MM
  ) {
    throw new TypeError(
      `plateThicknessMm must be a finite number in [${PLATE_THICKNESS_MIN_MM}, ${PLATE_THICKNESS_MAX_MM}] mm, ` +
        `got ${plateThicknessMm}`,
    );
  }
}

export function renderRibbedTrayScript(
  ribHeightMm: number,
  plateThicknessMm: number = PLATE_THICKNESS_DEFAULT_MM,
): string {
  if (
    !Number.isFinite(ribHeightMm) ||
    ribHeightMm <= 0 ||
    ribHeightMm < RIB_HEIGHT_MIN_MM ||
    ribHeightMm > RIB_HEIGHT_MAX_MM
  ) {
    throw new TypeError(
      `ribHeightMm must be a finite number in [${RIB_HEIGHT_MIN_MM}, ${RIB_HEIGHT_MAX_MM}] mm, ` +
        `got ${ribHeightMm}`,
    );
  }
  requirePlateThickness(plateThicknessMm);

  // z-centre of each rib in global coordinates: the rib top face is flush with
  // the plate bottom (z = −T/2), so the rib centre sits at z = −T/2 − R/2.
  const zc = -plateThicknessMm / 2.0 - ribHeightMm / 2.0;

  return [
    "from build123d import Align, Box, Location",
    "",
    `_R = ${ribHeightMm}`,
    `_zc = ${zc}`,
    `plate = Box(190, 135, ${plateThicknessMm}, align=(Align.CENTER, Align.CENTER, Align.CENTER))`,
    "result = (",
    "    plate",
    "    + Box(8, 120, _R, align=(Align.CENTER, Align.CENTER, Align.CENTER)).move(Location((-60, 0.0, _zc)))",
    "    + Box(8, 120, _R, align=(Align.CENTER, Align.CENTER, Align.CENTER)).move(Location((-30, 0.0, _zc)))",
    "    + Box(8, 120, _R, align=(Align.CENTER, Align.CENTER, Align.CENTER)).move(Location((0.0, 0.0, _zc)))",
    "    + Box(8, 120, _R, align=(Align.CENTER, Align.CENTER, Align.CENTER)).move(Location((30, 0.0, _zc)))",
    "    + Box(8, 120, _R, align=(Align.CENTER, Align.CENTER, Align.CENTER)).move(Location((60, 0.0, _zc)))",
    ")",
  ].join("\n");
}

/**
 * Build the CalculiX request arguments for a ribbed-tray solve.
 *
 * The selection boxes are literal constants reviewed against the plate geometry:
 *   FIXED  : y ∈ [66.5, 68.5], x ∈ [−96, 96], z ∈ [−4, +4]  (rear wall)
 *   LOADED : y ∈ [−68.5, −66.5], x ∈ [−96, 96], z ∈ [−4, +4] (front wall)
 *
 * The z range [−4, +4] captures the full plate thickness (z ∈ [−3, +3]) without
 * touching the ribs (which stop at |y| = 60, outside both bands). Changing any
 * of these literals requires a new reviewed case, not a code change.
 */
export function buildRibbedCalculixRequest(
  stepPath: string,
  stepSha256: string,
  plateThicknessMm: number = PLATE_THICKNESS_DEFAULT_MM,
): Record<string, unknown> {
  requirePlateThickness(plateThicknessMm);
  // The band boxes must cover the full plate thickness with a declared 1 mm
  // margin on each side: z ∈ ±(T/2 + 1). This is a RULE, not a constant,
  // because the plate is now parametric — the R2 selection-box failure taught
  // that a frozen box silently stops matching when the geometry it selects
  // moves. The ribs stop at |y| = 60, far inside both bands' y range, so no z
  // extension can ever catch a rib.
  const zHalf = plateThicknessMm / 2 + 1;
  return {
    step_path: stepPath,
    expected_step_sha256: stepSha256,
    mesh_size_mm: 5,
    material: { e_mpa: 2200, nu: 0.35 },
    selections: [
      {
        name: "FIXED",
        box: { min: [-96, 66.5, -zHalf], max: [96, 68.5, zHalf] },
      },
      {
        name: "LOADED",
        box: { min: [-96, -68.5, -zHalf], max: [96, -66.5, zHalf] },
      },
    ],
    fixed: ["FIXED"],
    loads: [{ selection: "LOADED", force_n: [0, 0, -100] }],
  };
}

/**
 * Exact analytic volume of the ribbed tray in mm³ — the mass column of the
 * two-parameter jacobian, free of any solve: plate 190×135×T plus five ribs
 * 8×120×R, disjoint by construction (ribs sit strictly below the plate).
 * Mass follows as volume × density; density stays a reviewed case value.
 */
export function ribbedTrayVolumeMm3(
  plateThicknessMm: number,
  ribHeightMm: number,
): number {
  requirePlateThickness(plateThicknessMm);
  if (
    !Number.isFinite(ribHeightMm) ||
    ribHeightMm < RIB_HEIGHT_MIN_MM ||
    ribHeightMm > RIB_HEIGHT_MAX_MM
  ) {
    throw new TypeError(
      `ribHeightMm must be a finite number in [${RIB_HEIGHT_MIN_MM}, ${RIB_HEIGHT_MAX_MM}] mm, ` +
        `got ${ribHeightMm}`,
    );
  }
  return 190 * 135 * plateThicknessMm + 5 * (8 * 120 * ribHeightMm);
}
