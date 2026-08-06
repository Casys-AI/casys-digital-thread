import type {
  ThreadArtifact,
  ThreadProvenanceLink,
} from "../../domain/thread/thread-snapshot.ts";

/**
 * Immutable lineage helpers for the one CM-01 28 mm -> 30 mm successor.
 *
 * Provider captures intentionally do not mutate a ThreadSnapshot. An executor
 * calls these helpers when materializing its extension so stale V1 evidence
 * remains readable while each R2 artefact points to exactly one predecessor.
 */
export const CM01_DRIP_TRAY_HEIGHT_CORRECTION_ARTIFACT_ID =
  "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record" as const;

export interface Cm01R2CadPredecessors {
  readonly plan: ThreadArtifact;
  readonly script: ThreadArtifact;
  readonly step: ThreadArtifact;
}

export interface Cm01R2MechanicalPredecessors {
  readonly proof: ThreadArtifact;
  /** Always the isolated DripTray STEP, never the assembly export. */
  readonly step: ThreadArtifact;
  readonly solve: ThreadArtifact;
}

export function requireCm01R2CadPredecessors(
  artifacts: readonly ThreadArtifact[],
): Cm01R2CadPredecessors {
  return {
    plan: uniqueStale(
      artifacts,
      "CM-01 R2 predecessor CAD plan",
      (item) =>
        item.kind === "document" && item.name === "CM-01 semantic CAD plan" &&
        item.producer.tool === "compile_coffee_machine_cm01_semantic_cad_plan",
    ),
    script: uniqueStale(
      artifacts,
      "CM-01 R2 predecessor CAD script",
      (item) =>
        item.kind === "script" && item.name === "CM-01 deterministic build123d script",
    ),
    step: uniqueStale(
      artifacts,
      "CM-01 R2 predecessor assembly STEP",
      (item) =>
        item.kind === "step" && item.name === "CM-01 STEP export" &&
        item.producer.tool === "build123d_export",
    ),
  };
}

export function requireCm01R2MechanicalPredecessors(
  artifacts: readonly ThreadArtifact[],
): Cm01R2MechanicalPredecessors {
  return {
    proof: uniqueStale(
      artifacts,
      "CM-01 R2 predecessor mechanical proof",
      (item) =>
        item.kind === "document" &&
        item.name === "CM-01 V3 reviewed DripTray proof case",
    ),
    step: uniqueStale(
      artifacts,
      "CM-01 R2 predecessor isolated DripTray STEP",
      (item) => item.kind === "step" && item.name === "CM-01 V3 isolated DripTray STEP",
    ),
    solve: uniqueStale(
      artifacts,
      "CM-01 R2 predecessor CalculiX solve",
      (item) =>
        item.kind === "solver-result" &&
        item.name === "CM-01 V3 CalculiX static result",
    ),
  };
}

/** Fresh R2 artifacts supersede the stale V1 sibling of the same role. */
export function cm01R2CadSupersedesLinks(
  successor: {
    readonly planId: string;
    readonly scriptId: string;
    readonly stepId: string;
  },
  predecessor: Cm01R2CadPredecessors,
): readonly ThreadProvenanceLink[] {
  return Object.freeze([
    supersedes(
      successor.planId,
      predecessor.plan.id,
      "The 30 mm semantic CAD plan replaces the stale 28 mm plan.",
    ),
    supersedes(
      successor.scriptId,
      predecessor.script.id,
      "The deterministic 30 mm script replaces the stale 28 mm script.",
    ),
    supersedes(
      successor.stepId,
      predecessor.step.id,
      "The 30 mm assembly STEP replaces the stale 28 mm assembly STEP.",
    ),
  ]);
}

/**
 * The proof's `stepId` names an isolated DripTray successor. It never links
 * that STEP as a CalculiX consumption of an assembly STEP.
 */
export function cm01R2MechanicalSupersedesLinks(
  successor: {
    readonly proofId: string;
    readonly stepId: string;
    readonly solveId: string;
  },
  predecessor: Cm01R2MechanicalPredecessors,
): readonly ThreadProvenanceLink[] {
  return Object.freeze([
    supersedes(
      successor.proofId,
      predecessor.proof.id,
      "The reviewed 30 mm isolated proof replaces the stale 28 mm proof case.",
    ),
    supersedes(
      successor.stepId,
      predecessor.step.id,
      "The isolated 30 mm DripTray STEP replaces the stale 28 mm isolated STEP.",
    ),
    supersedes(
      successor.solveId,
      predecessor.solve.id,
      "The CalculiX result for the isolated 30 mm DripTray replaces the stale 28 mm result.",
    ),
  ]);
}

function uniqueStale(
  artifacts: readonly ThreadArtifact[],
  label: string,
  matches: (artifact: ThreadArtifact) => boolean,
): ThreadArtifact {
  const found = artifacts.filter((artifact) =>
    matches(artifact) && artifact.freshness.status === "stale"
  );
  if (found.length !== 1) {
    throw new Error(`${label} must resolve to exactly one stale artifact.`);
  }
  return found[0]!;
}

function supersedes(
  fromId: string,
  toId: string,
  rationale: string,
): ThreadProvenanceLink {
  return {
    id: `${fromId}:supersedes:${toId}`,
    relation: "supersedes",
    from: { kind: "artifact", id: fromId },
    to: { kind: "artifact", id: toId },
    rationale,
  };
}
