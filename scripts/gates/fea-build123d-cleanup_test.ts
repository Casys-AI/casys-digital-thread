import { assertThrows } from "@std/assert";
import {
  ephemeralFeaExportCleanupScript,
  validateEphemeralFeaExportCleanup,
} from "./fea-build123d-cleanup.ts";

const cleanExecution = {
  schemaVersion: "1.0",
  kind: "execution",
  metrics: {
    volume_mm3: 1,
    area_mm2: 6,
    center_of_mass_mm: [0, 0, 0],
    bounding_box_mm: {
      min: [-0.5, -0.5, -0.5],
      max: [0.5, 0.5, 0.5],
      size: [1, 1, 1],
    },
    solids: 1,
    faces: 6,
    edges: 12,
  },
  files: [],
};

Deno.test("FEA ephemeral cleanup script asserts the export disappeared after removal", () => {
  const script = ephemeralFeaExportCleanupScript(
    "/exports/gate-smoke-a1b2c3d4-minimal.step",
  );
  if (
    !script.includes(
      "raise RuntimeError('ephemeral FEA export still exists after cleanup')",
    )
  ) {
    throw new Error("cleanup script does not verify the deletion result");
  }
  assertThrows(
    () => ephemeralFeaExportCleanupScript("/exports/operator-owned.step"),
    Error,
    "locally generated ephemeral",
  );
});

Deno.test("FEA ephemeral cleanup accepts only a complete build123d execution proof", () => {
  validateEphemeralFeaExportCleanup(cleanExecution);
  validateEphemeralFeaExportCleanup({
    ...cleanExecution,
    metrics: {
      ...cleanExecution.metrics,
      volume_mm3: 1 + 5e-10,
      area_mm2: 6 - 5e-10,
      center_of_mass_mm: [5e-10, 0, 0],
      bounding_box_mm: {
        min: [-0.5 + 5e-10, -0.5, -0.5],
        max: [0.5 - 5e-10, 0.5, 0.5],
        size: [1 + 5e-10, 1, 1],
      },
    },
  });
  assertThrows(
    () =>
      validateEphemeralFeaExportCleanup({ schemaVersion: "1.0", kind: "execution" }),
    Error,
    "does not match",
  );
  assertThrows(
    () =>
      validateEphemeralFeaExportCleanup({
        ...cleanExecution,
        files: [{ path: "unexpected" }],
      }),
    Error,
    "unexpected files",
  );
  assertThrows(
    () =>
      validateEphemeralFeaExportCleanup({
        ...cleanExecution,
        metrics: { ...cleanExecution.metrics, volume_mm3: 0 },
      }),
    Error,
    "cleanup-proof tolerance",
  );
  assertThrows(
    () =>
      validateEphemeralFeaExportCleanup({
        ...cleanExecution,
        metrics: { ...cleanExecution.metrics, faces: 5 },
      }),
    Error,
    "faces must equal 6",
  );
});
