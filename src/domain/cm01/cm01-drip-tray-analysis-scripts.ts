/**
 * CM-01 DripTray build123d script renderers and R2-recipe guard.
 *
 * Why this boundary exists: the three render functions and the R2-recipe
 * assertion are project-specific to CM-01 — they embed the DripTray plan
 * geometry (190 × 135 mm, 30 mm R2 height, centred origin). Keeping them
 * here prevents the generic analysis/ schemas from carrying project knowledge.
 * The direction of dependency (cm01 → analysis) is intentional and allowed:
 * both sub-families live in domain/, and there is no I/O.
 */

import type { SensitivityStudyCase } from "../analysis/sensitivity-study.ts";

/**
 * The one canonical base value for DripTray size-z in the reviewed R2 recipe.
 * An executor that checks against this constant is checking against the reviewed
 * component geometry, not a free parameter.
 */
export const DRIP_TRAY_SIZE_Z_R2_BASE_MM = 30 as const;

/**
 * Assert that the declared base value matches the reviewed R2 recipe's DripTray
 * size-z value. A divergent base means the derivative would describe a point
 * that does not correspond to the reviewed component geometry — that is a lie
 * about the starting condition, not a measurement error.
 */
export function assertBaseValueMatchesDripTrayRecipeR2(
  sensitivityCase: SensitivityStudyCase,
): void {
  if (
    sensitivityCase.target.componentKey !== "drip-tray" ||
    sensitivityCase.target.semanticKey !== "size-z"
  ) {
    throw new TypeError(
      "assertBaseValueMatchesDripTrayRecipeR2 requires target " +
        "componentKey drip-tray and semanticKey size-z.",
    );
  }
  if (sensitivityCase.baseValue.unit !== "mm") {
    throw new TypeError(
      "$case.baseValue.unit must be mm for drip-tray/size-z against the R2 recipe.",
    );
  }
  if (sensitivityCase.baseValue.value !== DRIP_TRAY_SIZE_Z_R2_BASE_MM) {
    throw new TypeError(
      `$case.baseValue.value must equal the reviewed R2 recipe value ` +
        `${DRIP_TRAY_SIZE_Z_R2_BASE_MM} mm; got ${sensitivityCase.baseValue.value}.`,
    );
  }
}

/**
 * Render a build123d DripTray isolation script for a given height in mm.
 *
 * Pure and deterministic: the same height always produces the same script bytes.
 * The caller is responsible for supplying either case.baseValue.value or
 * case.baseValue.value + case.step.value — both come from the validated case,
 * never from a free agent input. The plan geometry (190 × 135 mm, centred
 * origin) is fixed; only the height varies between the two sensitivity runs.
 */
export function renderDripTraySensitivityScriptForHeight(heightMm: number): string {
  if (!Number.isFinite(heightMm) || heightMm <= 0) {
    throw new TypeError(
      "DripTray sensitivity height must be a finite positive number.",
    );
  }
  return [
    "from build123d import Align, Box",
    "",
    `result = Box(190, 135, ${heightMm}, align=(Align.CENTER, Align.CENTER, Align.CENTER))`,
  ].join("\n");
}

/**
 * Render the server-fixed DripTray isolation script for a printability STL
 * export.
 *
 * Pure and deterministic: the same output every time. The 30 mm height is the
 * reviewed R2 baseline (same geometry as the sensitivity study base point).
 * The agent never supplies this script — the server owns the geometry.
 */
export function renderDripTrayPrintabilityScript(): string {
  return [
    "from build123d import Align, Box",
    "",
    "result = Box(190, 135, 30, align=(Align.CENTER, Align.CENTER, Align.CENTER))",
  ].join("\n");
}

/**
 * Render the server-fixed DripTray print-estimate script for build123d.
 *
 * Pure and deterministic: the same output every time for the same inputs.
 * The Python script:
 *   1. Decodes the base64 profile content and writes it to /exports.
 *   2. Exports the 30 mm DripTray Box as STL.
 *
 * The profileContentB64 parameter must be a standard (not URL-safe) base64
 * encoding of the UTF-8 profile content. The executor is responsible for
 * encoding; this function only renders the deterministic script.
 *
 * The 30 mm height is the reviewed R2 baseline (same geometry as the
 * sensitivity study base point). The agent never supplies this script —
 * the server owns the geometry and the profile embedding.
 */
export function renderDripTrayPrintEstimateScript(
  profileContentB64: string,
  profileExportName: string,
): string {
  if (!profileContentB64.trim()) {
    throw new TypeError(
      "profileContentB64 must be a non-empty base64 string.",
    );
  }
  if (!profileExportName.trim() || !/^[A-Za-z0-9._-]+$/.test(profileExportName)) {
    throw new TypeError(
      "profileExportName must be a non-empty alphanumeric string (letters, digits, ._-).",
    );
  }
  return [
    "import base64, pathlib",
    "from build123d import Align, Box",
    `_profile_bytes = base64.b64decode(${JSON.stringify(profileContentB64)})`,
    `pathlib.Path("/exports/${profileExportName}.ini").write_bytes(_profile_bytes)`,
    "result = Box(190, 135, 30, align=(Align.CENTER, Align.CENTER, Align.CENTER))",
  ].join("\n");
}
