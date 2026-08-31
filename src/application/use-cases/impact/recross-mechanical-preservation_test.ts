import { assertEquals } from "@std/assert";
import {
  GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
  GEOMETRY_BINARY_TRACE_RATIONALE,
} from "../../../domain/cad/canonical/geometry-bundle.ts";
import {
  DESIGN_PREVIEW_GEOMETRY_OPERATION,
  DESIGN_WRITE_GEOMETRY_OPERATION,
} from "../../../domain/cad/canonical/geometry-proposal.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "../../../domain/cad/isolated/build123d-execution-proposal.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { recrossCanonicalGeometryStep } from "./recross-mechanical-preservation.ts";

const AT = "2026-08-22T09:00:00.000Z";
const GEOMETRY_DIGEST = "a".repeat(64);
const STEP_DIGEST = "b".repeat(64);
const DECOY_DIGEST = "c".repeat(64);
const GEOMETRY_ID = `geometry-${GEOMETRY_DIGEST}`;
const STEP_ID = `cad-asset-${GEOMETRY_DIGEST}-definition-0-0-${STEP_DIGEST}`;
const TARGET_STEP_ID = `cad-asset-${GEOMETRY_DIGEST}-target-0-${STEP_DIGEST}`;
const EXPORT_RUN = "run-build123d-export";
const GEOMETRY_RUN = "run-write-geometry";
const GEOMETRY_WORK = "work-write-geometry";

Deno.test("canonical STEP recrosses as the cad-asset sibling of the write-geometry cad-model", () => {
  const world = canonicalWorld();
  assertEquals(
    recrossCanonicalGeometryStep(
      world.project,
      world.snapshot,
      world.step,
      EXPORT_RUN,
    ),
    true,
  );
});

Deno.test("canonical target STEP recrosses through the same owning cad-model join", () => {
  const world = canonicalWorld({ stepId: TARGET_STEP_ID });
  assertEquals(
    recrossCanonicalGeometryStep(
      world.project,
      world.snapshot,
      world.step,
      EXPORT_RUN,
    ),
    true,
  );
});

Deno.test("isolated, preview, or arbitrary STEP publication never recrosses as canonical", () => {
  const isolated = canonicalWorld();
  isolated.step = withProducer(isolated.step, {
    serverId: "digital-thread",
    tool:
      `${DESIGN_EXECUTE_BUILD123D_OPERATION.id}@${DESIGN_EXECUTE_BUILD123D_OPERATION.version}`,
    runId: EXPORT_RUN,
  });
  isolated.snapshot = replaceArtifact(isolated.snapshot, isolated.step);
  assertEquals(
    recrossCanonicalGeometryStep(
      isolated.project,
      isolated.snapshot,
      isolated.step,
      EXPORT_RUN,
    ),
    false,
  );

  const preview = canonicalWorld();
  preview.step = withProducer(preview.step, {
    serverId: "digital-thread",
    tool:
      `${DESIGN_PREVIEW_GEOMETRY_OPERATION.id}@${DESIGN_PREVIEW_GEOMETRY_OPERATION.version}`,
    runId: EXPORT_RUN,
  });
  preview.snapshot = replaceArtifact(preview.snapshot, preview.step);
  assertEquals(
    recrossCanonicalGeometryStep(
      preview.project,
      preview.snapshot,
      preview.step,
      EXPORT_RUN,
    ),
    false,
  );

  const arbitrary = canonicalWorld({
    stepId: `cad-asset-${GEOMETRY_DIGEST}-assembly-0-${STEP_DIGEST}`,
  });
  assertEquals(
    recrossCanonicalGeometryStep(
      arbitrary.project,
      arbitrary.snapshot,
      arbitrary.step,
      EXPORT_RUN,
    ),
    false,
  );
});

Deno.test("ambiguous or tampered STEP ownership never recrosses as canonical", () => {
  const ambiguous = canonicalWorld();
  ambiguous.snapshot = validateThreadSnapshot({
    ...ambiguous.snapshot,
    provenance: [
      ...ambiguous.snapshot.provenance,
      {
        id: `traces-${ambiguous.step.id}-from-decoy`,
        relation: "traces_to",
        from: { kind: "artifact", id: ambiguous.step.id },
        to: { kind: "artifact", id: ambiguous.geometry.id },
        rationale: GEOMETRY_BINARY_TRACE_RATIONALE,
      },
    ],
  });
  assertEquals(
    recrossCanonicalGeometryStep(
      ambiguous.project,
      ambiguous.snapshot,
      ambiguous.step,
      EXPORT_RUN,
    ),
    false,
  );

  const tampered = canonicalWorld();
  const decoy = geometryArtifact(DECOY_DIGEST);
  tampered.snapshot = validateThreadSnapshot({
    ...tampered.snapshot,
    artifacts: [...tampered.snapshot.artifacts, decoy],
    provenance: tampered.snapshot.provenance.map((link) =>
      link.id === `traces-${tampered.step.id}-from-${tampered.geometry.id}`
        ? {
          ...link,
          id: `traces-${tampered.step.id}-from-${decoy.id}`,
          to: { kind: "artifact" as const, id: decoy.id },
        }
        : link
    ),
  });
  assertEquals(
    recrossCanonicalGeometryStep(
      tampered.project,
      tampered.snapshot,
      tampered.step,
      EXPORT_RUN,
    ),
    false,
  );
});

Deno.test("a write-geometry run that attaches the STEP instead of the cad-model never recrosses", () => {
  const world = canonicalWorld({ evidenceId: STEP_ID });
  assertEquals(
    recrossCanonicalGeometryStep(
      world.project,
      world.snapshot,
      world.step,
      EXPORT_RUN,
    ),
    false,
  );
});

Deno.test("foreign, absent, or wrong-operation geometry runs never recross the sibling STEP", () => {
  const missing = canonicalWorld();
  missing.project = {
    ...missing.project,
    agentRuns: [],
  };
  assertEquals(
    recrossCanonicalGeometryStep(
      missing.project,
      missing.snapshot,
      missing.step,
      EXPORT_RUN,
    ),
    false,
  );

  const wrong = canonicalWorld();
  const work = wrong.project.workItems[0]!;
  wrong.project = {
    ...wrong.project,
    workItems: [{
      ...work,
      operation: {
        ...work.operation!,
        id: DESIGN_EXECUTE_BUILD123D_OPERATION.id,
        version: DESIGN_EXECUTE_BUILD123D_OPERATION.version,
      },
    }],
  };
  assertEquals(
    recrossCanonicalGeometryStep(
      wrong.project,
      wrong.snapshot,
      wrong.step,
      EXPORT_RUN,
    ),
    false,
  );
});

Deno.test("stale or archived geometry ownership never recrosses as canonical", () => {
  const stale = canonicalWorld();
  const staleFreshness = {
    status: "stale" as const,
    changedAt: AT,
    reason: "Superseded capture.",
    invalidatedByChangeIds: ["change-geometry"],
  };
  stale.snapshot = validateThreadSnapshot({
    ...stale.snapshot,
    freshness: staleFreshness,
    artifacts: stale.snapshot.artifacts.map((artifact) =>
      artifact.id === GEOMETRY_ID
        ? { ...artifact, freshness: staleFreshness }
        : artifact
    ),
  });
  assertEquals(
    recrossCanonicalGeometryStep(
      stale.project,
      stale.snapshot,
      stale.step,
      EXPORT_RUN,
    ),
    false,
  );

  const archived = canonicalWorld();
  archived.snapshot = {
    ...archived.snapshot,
    changeSet: {
      ...archived.snapshot.changeSet,
      changes: [
        ...archived.snapshot.changeSet.changes,
        {
          id: "change-archive-geometry",
          kind: "archived",
          target: { kind: "artifact", id: GEOMETRY_ID },
          summary: "Retired geometry capture.",
        },
      ],
    },
  };
  assertEquals(
    recrossCanonicalGeometryStep(
      archived.project,
      archived.snapshot,
      archived.step,
      EXPORT_RUN,
    ),
    false,
  );
});

function canonicalWorld(options?: {
  readonly stepId?: string;
  readonly evidenceId?: string;
}): {
  project: EngineeringProjectSnapshot;
  snapshot: ThreadSnapshot;
  step: ThreadArtifact;
  geometry: ThreadArtifact;
} {
  const geometry = geometryArtifact(GEOMETRY_DIGEST);
  const stepId = options?.stepId ?? STEP_ID;
  const step = stepArtifact(stepId);
  const consumptionId = `consume-${geometry.id}-by-${step.id}`;
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "thread-canonical-step",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: "subject-canonical-step",
      name: "Canonical STEP subject",
      kind: "system",
      version: "r1",
      modelArtifactId: geometry.id,
    },
    freshness: fresh(),
    changeSet: {
      id: "changes-canonical-step",
      name: "Canonical geometry publication",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change-geometry",
        kind: "created",
        target: { kind: "artifact", id: geometry.id },
        summary: "Canonical geometry capture.",
        afterFingerprint: geometry.fingerprint,
      }],
    },
    artifacts: [geometry, step],
    consumptions: [{
      id: consumptionId,
      artifactId: geometry.id,
      consumer: geometry.producer,
      observedFingerprint: geometry.fingerprint,
      verifiedAt: AT,
      status: "verified",
    }],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      {
        id: "provenance-change-geometry",
        relation: "changes",
        from: { kind: "change", id: "change-geometry" },
        to: { kind: "artifact", id: geometry.id },
        rationale: "Canonical geometry capture.",
      },
      {
        id: `traces-${step.id}-from-${geometry.id}`,
        relation: "traces_to",
        from: { kind: "artifact", id: step.id },
        to: { kind: "artifact", id: geometry.id },
        rationale: GEOMETRY_BINARY_TRACE_RATIONALE,
      },
      {
        id: `uses-${consumptionId}`,
        relation: "uses",
        from: { kind: "consumption", id: consumptionId },
        to: { kind: "artifact", id: geometry.id },
        rationale: GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
      },
    ],
    proposedActions: [],
  });
  const evidenceId = options?.evidenceId ?? geometry.id;
  const evidenceRef = {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact" as const,
    id: evidenceId,
  };
  const project = {
    threadSnapshots: [{
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: snapshot.subject.id,
    }],
    workItems: [{
      id: GEOMETRY_WORK,
      status: "completed",
      operation: {
        id: DESIGN_WRITE_GEOMETRY_OPERATION.id,
        version: DESIGN_WRITE_GEOMETRY_OPERATION.version,
      },
      evidenceRefs: [evidenceRef],
    }],
    agentRuns: [{
      id: GEOMETRY_RUN,
      workItemId: GEOMETRY_WORK,
      status: "completed",
      resultSnapshot: {
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        subjectId: snapshot.subject.id,
      },
      evidenceRefs: [evidenceRef],
    }],
  } as unknown as EngineeringProjectSnapshot;
  return { project, snapshot, step, geometry };
}

function geometryArtifact(digest: string): ThreadArtifact {
  return {
    id: `geometry-${digest}`,
    name: "Canonical geometry capture",
    kind: "cad-model",
    version: digest,
    fingerprint: { algorithm: "sha256", digest },
    uri: `casys://geometry-capture/sha256/${digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool:
        `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}`,
      runId: GEOMETRY_RUN,
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
}

function stepArtifact(id: string): ThreadArtifact {
  return {
    id,
    name: "Authoritative STEP",
    kind: "step",
    version: STEP_DIGEST,
    fingerprint: { algorithm: "sha256", digest: STEP_DIGEST },
    uri: `/api/thread/assets/${STEP_DIGEST}.step`,
    mediaType: "model/step",
    producer: {
      serverId: "build123d-sandbox",
      tool: "build123d_export",
      runId: EXPORT_RUN,
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
}

function withProducer(
  artifact: ThreadArtifact,
  producer: ThreadArtifact["producer"],
): ThreadArtifact {
  return { ...artifact, producer };
}

function replaceArtifact(
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): ThreadSnapshot {
  return validateThreadSnapshot({
    ...snapshot,
    artifacts: snapshot.artifacts.map((item) =>
      item.id === artifact.id ? artifact : item
    ),
  });
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}
