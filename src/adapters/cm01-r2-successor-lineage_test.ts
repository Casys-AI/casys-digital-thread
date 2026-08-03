import { assertEquals, assertThrows } from "@std/assert";
import type { ThreadArtifact } from "../domain/thread-snapshot.ts";
import {
  cm01R2CadSupersedesLinks,
  cm01R2MechanicalSupersedesLinks,
  requireCm01R2CadPredecessors,
  requireCm01R2MechanicalPredecessors,
} from "./cm01-r2-successor-lineage.ts";

Deno.test("CM-01 R2 successor lineage binds each replacement to one stale V1 sibling", () => {
  const artifacts = [
    artifact(
      "old-plan",
      "CM-01 semantic CAD plan",
      "document",
      "compile_coffee_machine_cm01_semantic_cad_plan",
    ),
    artifact(
      "old-script",
      "CM-01 deterministic build123d script",
      "script",
      "build123d_export",
    ),
    artifact("old-assembly-step", "CM-01 STEP export", "step", "build123d_export"),
    artifact(
      "old-proof",
      "CM-01 V3 reviewed DripTray proof case",
      "document",
      "evaluate_cm01_drip_tray_limits",
    ),
    artifact(
      "old-isolated-step",
      "CM-01 V3 isolated DripTray STEP",
      "step",
      "build123d_export",
    ),
    artifact(
      "old-solve",
      "CM-01 V3 CalculiX static result",
      "solver-result",
      "calculix_solve_static",
    ),
  ];
  const cad = cm01R2CadSupersedesLinks(
    { planId: "new-plan", scriptId: "new-script", stepId: "new-assembly-step" },
    requireCm01R2CadPredecessors(artifacts),
  );
  const mechanical = cm01R2MechanicalSupersedesLinks(
    { proofId: "new-proof", stepId: "new-isolated-step", solveId: "new-solve" },
    requireCm01R2MechanicalPredecessors(artifacts),
  );
  assertEquals(cad.map((link) => [link.from.id, link.to.id]), [
    ["new-plan", "old-plan"],
    ["new-script", "old-script"],
    ["new-assembly-step", "old-assembly-step"],
  ]);
  assertEquals(mechanical.map((link) => [link.from.id, link.to.id]), [
    ["new-proof", "old-proof"],
    ["new-isolated-step", "old-isolated-step"],
    ["new-solve", "old-solve"],
  ]);
});

Deno.test("CM-01 R2 successor lineage refuses ambiguous stale predecessors", () => {
  const duplicate = [
    artifact("first", "CM-01 STEP export", "step", "build123d_export"),
    artifact("second", "CM-01 STEP export", "step", "build123d_export"),
  ];
  assertThrows(
    () => requireCm01R2CadPredecessors(duplicate),
    Error,
    "exactly one stale artifact",
  );
});

function artifact(
  id: string,
  name: string,
  kind: ThreadArtifact["kind"],
  tool: string,
): ThreadArtifact {
  return {
    id,
    name,
    kind,
    version: "1",
    fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    producer: { serverId: "test", tool, runId: "run" },
    inputArtifactIds: [],
    freshness: {
      status: "stale",
      changedAt: "2026-08-03T18:00:00.000Z",
      reason: "replacement required",
      invalidatedByChangeIds: ["correction"],
    },
  };
}
