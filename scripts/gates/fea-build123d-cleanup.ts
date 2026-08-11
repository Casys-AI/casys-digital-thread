/**
 * Shared, fail-closed cleanup proof for ephemeral FEA STEP exports.
 *
 * `build123d_execute` cannot return a filesystem deletion receipt.  The
 * strongest provider-native proof available is therefore a script which first
 * removes the exact generated file, then raises if it still exists, followed by
 * the ordinary complete execution payload.  The caller validates that complete
 * payload instead of treating only its schema label as success.
 */

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${path} does not match the build123d execution contract.`);
  }
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

/**
 * OCCT reports analytical box values, but its JSON number conversion is still
 * floating-point. Keep the tolerance deliberately much smaller than any
 * engineering tolerance: it accepts representation noise, not another shape.
 */
const CLEANUP_PROOF_ABSOLUTE_TOLERANCE = 1e-9;

function expectedNumber(
  value: unknown,
  expected: number,
  path: string,
): void {
  const actual = finiteNumber(value, path);
  if (Math.abs(actual - expected) > CLEANUP_PROOF_ABSOLUTE_TOLERANCE) {
    throw new Error(
      `${path} must equal ${expected} within the cleanup-proof tolerance.`,
    );
  }
}

function vector(value: unknown, path: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${path} must be a three-coordinate vector.`);
  }
  return value.map((coordinate, index) =>
    finiteNumber(coordinate, `${path}[${index}]`)
  );
}

function expectedVector(
  value: unknown,
  expected: readonly [number, number, number],
  path: string,
): void {
  const actual = vector(value, path);
  for (const [index, coordinate] of actual.entries()) {
    expectedNumber(coordinate, expected[index]!, `${path}[${index}]`);
  }
}

/**
 * Builds the only cleanup script used by the FEA smoke and capture runners.
 * The caller supplies only a locally generated, fixed-prefix path.
 */
export function ephemeralFeaExportCleanupScript(exportPath: string): string {
  if (
    !/^\/exports\/(?:gate-smoke-|fea-contract-golden-)[a-z0-9-]+\.step$/.test(
      exportPath,
    )
  ) {
    throw new Error("FEA cleanup path is not a locally generated ephemeral STEP path.");
  }
  return [
    "from build123d import Box",
    "import os",
    `path = ${JSON.stringify(exportPath)}`,
    "if os.path.exists(path):",
    "    os.remove(path)",
    "if os.path.exists(path):",
    "    raise RuntimeError('ephemeral FEA export still exists after cleanup')",
    // The result forces the provider through its normal OCCT execution and
    // metrics path. The validator below checks that response in full.
    "result = Box(1, 1, 1)",
  ].join("\n");
}

/**
 * Validates the complete provider-native `build123d_execute` response for the
 * cleanup script. A matching `schemaVersion` and `kind` alone are not proof of
 * a successful execution, so metrics and the zero-file invariant are required.
 */
export function validateEphemeralFeaExportCleanup(
  structuredContent: unknown,
): void {
  const root = record(structuredContent, "build123d cleanup structuredContent");
  exactKeys(
    root,
    ["files", "kind", "metrics", "schemaVersion"],
    "build123d cleanup structuredContent",
  );
  if (root.schemaVersion !== "1.0" || root.kind !== "execution") {
    throw new Error("build123d cleanup did not return an execution result.");
  }
  if (!Array.isArray(root.files) || root.files.length !== 0) {
    throw new Error("build123d cleanup execution returned unexpected files.");
  }

  const metrics = record(root.metrics, "build123d cleanup metrics");
  exactKeys(
    metrics,
    [
      "area_mm2",
      "bounding_box_mm",
      "center_of_mass_mm",
      "edges",
      "faces",
      "solids",
      "volume_mm3",
    ],
    "build123d cleanup metrics",
  );
  expectedNumber(metrics.volume_mm3, 1, "build123d cleanup metrics.volume_mm3");
  expectedNumber(metrics.area_mm2, 6, "build123d cleanup metrics.area_mm2");
  for (
    const [key, expected] of [
      ["solids", 1],
      ["faces", 6],
      ["edges", 12],
    ] as const
  ) {
    const value = finiteNumber(metrics[key], `build123d cleanup metrics.${key}`);
    if (!Number.isInteger(value) || value !== expected) {
      throw new Error(`build123d cleanup metrics.${key} must equal ${expected}.`);
    }
  }
  expectedVector(
    metrics.center_of_mass_mm,
    [0, 0, 0],
    "build123d cleanup metrics.center_of_mass_mm",
  );
  const boundingBox = record(
    metrics.bounding_box_mm,
    "build123d cleanup metrics.bounding_box_mm",
  );
  exactKeys(
    boundingBox,
    ["max", "min", "size"],
    "build123d cleanup metrics.bounding_box_mm",
  );
  expectedVector(
    boundingBox.min,
    [-0.5, -0.5, -0.5],
    "build123d cleanup metrics.bounding_box_mm.min",
  );
  expectedVector(
    boundingBox.max,
    [0.5, 0.5, 0.5],
    "build123d cleanup metrics.bounding_box_mm.max",
  );
  expectedVector(
    boundingBox.size,
    [1, 1, 1],
    "build123d cleanup metrics.bounding_box_mm.size",
  );
}
