import { assertEquals, assertRejects } from "@std/assert";
import type { TechnicalCompilationBasisResolutionRequest } from "../../../application/ports/out/compile/admission/technical-compilation-basis-resolver.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../../domain/project/engineering-project-validation.ts";
import { materializeSysonModelSeed } from "../../../domain/architecture/seed/syson-model-seed.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtension } from "../../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { ARCHITECTURE_CAPTURE_SCHEMA } from "../../architecture/renderer/architecture-capture.ts";
import { REQUIREMENTS_CAPTURE_SCHEMA } from "../../architecture/requirements/requirements-capture.ts";
import {
  CaptureBackedTechnicalCompilationBasisResolver,
  TechnicalCompilationBasisResolutionError,
} from "./technical-compilation-basis-resolver.ts";

const PROJECT_ID = "basis-test";
const SUBJECT_ID = `project:${PROJECT_ID}`;
const SEED_AT = "2026-08-12T09:00:00.000Z";
const ARCHITECTURE_AT = "2026-08-12T09:05:00.000Z";
const REQUIREMENTS_AT = "2026-08-12T09:10:00.000Z";
const DOCUMENT_DIGEST = "a".repeat(64);

Deno.test("technical basis resolver reopens exact project Thread and canonical SysML identities", async () => {
  const fixture = await exactFixture();
  const resolved = await fixture.resolver.resolve(fixture.request);

  assertEquals(resolved?.thread.projectId, PROJECT_ID);
  assertEquals(resolved?.thread.snapshotId, fixture.snapshot.id);
  assertEquals(
    resolved?.thread.snapshotFingerprint,
    await sha256Fingerprint(fixture.snapshot),
  );
  assertEquals(
    resolved?.sysmlAnchor.artifactId,
    fixture.architectureArtifactId,
  );
  assertEquals(
    resolved?.sysmlAnchor.artifactFingerprint.digest,
    fixture.architectureDigest,
  );
  assertEquals(resolved?.sysmlAnchor.captureId, fixture.architectureDigest);
  assertEquals(
    resolved?.sysmlAnchor.editingContextId,
    "editing-context-basis-test",
  );
  assertEquals(resolved?.sysmlAnchor.rootElementId, "package-basis-test");
  assertEquals(resolved?.sysmlAnchor.rootElementKind, "Package");
  const architectureProvenance = {
    artifactId: fixture.architectureArtifactId,
    artifactFingerprint: {
      algorithm: "sha256" as const,
      digest: fixture.architectureDigest,
    },
    captureId: fixture.architectureDigest,
  };
  assertEquals(resolved?.sysmlAnchor.elements, [{
    id: "package-basis-test",
    kind: "Package",
    name: "BasisPackage",
    provenance: architectureProvenance,
  }, {
    id: "part-definition-frame",
    kind: "PartDefinition",
    name: "Frame",
    provenance: architectureProvenance,
  }, {
    id: "part-definition-system",
    kind: "PartDefinition",
    name: "BasisSystem",
    provenance: architectureProvenance,
  }, {
    id: "part-usage-frame",
    kind: "PartUsage",
    name: "frame",
    provenance: architectureProvenance,
  }]);
});

Deno.test(
  "technical basis resolver carries the exact owning PartDefinition for captured AttributeUsage",
  async () => {
    const fixture = await exactFixture({ frameAttribute: true });
    const resolved = await fixture.resolver.resolve(fixture.request);
    const attribute = resolved?.sysmlAnchor.elements.find((element) =>
      element.id === "attribute-usage-frame-thickness"
    );
    assertEquals(attribute, {
      id: "attribute-usage-frame-thickness",
      kind: "AttributeUsage",
      name: "thickness",
      parentElementId: "part-definition-frame",
      provenance: {
        artifactId: fixture.architectureArtifactId,
        artifactFingerprint: {
          algorithm: "sha256",
          digest: fixture.architectureDigest,
        },
        captureId: fixture.architectureDigest,
      },
    });
  },
);

Deno.test("technical basis resolver rejects a foreign project attachment", async () => {
  const fixture = await exactFixture({ declareBasisInProject: false });
  await assertRejects(
    () => fixture.resolver.resolve(fixture.request),
    TechnicalCompilationBasisResolutionError,
    "not declared exactly once",
  );
});

Deno.test("technical basis resolver rejects stale or foreign snapshot readback", async () => {
  const fixture = await exactFixture();
  fixture.snapshots.set(fixture.snapshot.id, fixture.seedSnapshot);
  await assertRejects(
    () => fixture.resolver.resolve(fixture.request),
    TechnicalCompilationBasisResolutionError,
    "stale or foreign Thread identity",
  );
});

Deno.test("technical basis resolver rejects stale architecture evidence", async () => {
  const fixture = await exactFixture({ staleArchitecture: true });
  await assertRejects(
    () => fixture.resolver.resolve(fixture.request),
    TechnicalCompilationBasisResolutionError,
    "architecture tip is stale",
  );
});

Deno.test("technical basis resolver rejects an archived architecture tip", async () => {
  const fixture = await exactFixture({ archiveArchitecture: true });
  await assertRejects(
    () => fixture.resolver.resolve(fixture.request),
    TechnicalCompilationBasisResolutionError,
    "architecture tip is archived",
  );
});

Deno.test("technical basis resolver rejects tampered raw CAS bytes", async () => {
  const fixture = await exactFixture();
  fixture.architectureCaptures.set(
    fixture.architectureDigest,
    `${fixture.architectureCaptures.get(fixture.architectureDigest)} `,
  );
  await assertRejects(
    () => fixture.resolver.resolve(fixture.request),
    TechnicalCompilationBasisResolutionError,
    "CAS bytes do not match",
  );
});

Deno.test("technical basis resolver rejects duplicate native SysML identities", async () => {
  const fixture = await exactFixture({ duplicateSysmlId: true });
  await assertRejects(
    () => fixture.resolver.resolve(fixture.request),
    TechnicalCompilationBasisResolutionError,
    "architecture capture is invalid",
  );
});

Deno.test("technical basis resolver rejects a latest alias before any store read", async () => {
  const fixture = await exactFixture();
  const latest = {
    ...fixture.request,
    basis: { ...fixture.request.basis, snapshotId: "latest" },
  };
  await assertRejects(
    () => fixture.resolver.resolve(latest),
    TypeError,
    "must not be a latest alias",
  );
});

Deno.test("technical basis resolver admits V3 native requirement identities with capture provenance", async () => {
  const fixture = await exactFixture({ requirementsCaptureVersion: "v3" });
  const resolved = await fixture.resolver.resolve(fixture.request);
  const requirementUsage = resolved?.sysmlAnchor.elements.find((element) =>
    element.id === "requirement-usage-frame"
  );
  const constraintUsage = resolved?.sysmlAnchor.elements.find((element) =>
    element.id === "constraint-usage-frame-displacement"
  );

  assertEquals(requirementUsage?.kind, "RequirementUsage");
  assertEquals(constraintUsage?.kind, "ConstraintUsage");
  assertEquals(requirementUsage?.provenance, {
    artifactId: fixture.requirementsArtifactId,
    artifactFingerprint: {
      algorithm: "sha256",
      digest: fixture.requirementsDigest,
    },
    captureId: fixture.requirementsDigest,
  });
  assertEquals(constraintUsage?.provenance, requirementUsage?.provenance);
});

Deno.test("technical basis resolver rejects an active requirements-capture/2.0 artifact", async () => {
  const fixture = await exactFixture({ requirementsCaptureVersion: "v2" });
  await assertRejects(
    () => fixture.resolver.resolve(fixture.request),
    TechnicalCompilationBasisResolutionError,
    "schema is not exact",
  );
});

Deno.test(
  "technical basis resolver rejects an active requirements-capture/2.0 after a successor architecture tip",
  async () => {
    const fixture = await exactFixture({
      requirementsCaptureVersion: "v2",
      successorArchitecture: true,
    });
    await assertRejects(
      () => fixture.resolver.resolve(fixture.request),
      TechnicalCompilationBasisResolutionError,
      "schema is not exact",
    );
  },
);

Deno.test("technical basis resolver rejects divergent V3 provider identities", async () => {
  const fixture = await exactFixture({
    requirementsCaptureVersion: "v3",
    divergentConstraintSourceId: true,
  });
  await assertRejects(
    () => fixture.resolver.resolve(fixture.request),
    TechnicalCompilationBasisResolutionError,
    "id and sourceId must be identical",
  );
});

Deno.test("technical basis resolver never joins a requirements target by label", async () => {
  const fixture = await exactFixture({
    requirementsCaptureVersion: "v3",
    foreignRequirementsTargetId: true,
  });
  await assertRejects(
    () => fixture.resolver.resolve(fixture.request),
    TechnicalCompilationBasisResolutionError,
    "targets no exact active PartDefinition",
  );
});

Deno.test("archived V3 requirements identities cannot authorize compilation bindings", async () => {
  const fixture = await exactFixture({
    requirementsCaptureVersion: "v3",
    archiveRequirements: true,
  });
  const resolved = await fixture.resolver.resolve(fixture.request);
  assertEquals(
    resolved?.sysmlAnchor.elements.some((element) =>
      element.kind === "RequirementUsage" || element.kind === "ConstraintUsage"
    ),
    false,
  );
});

interface FixtureOptions {
  readonly declareBasisInProject?: boolean;
  readonly staleArchitecture?: boolean;
  readonly archiveArchitecture?: boolean;
  readonly duplicateSysmlId?: boolean;
  readonly frameAttribute?: boolean;
  readonly requirementsCaptureVersion?: "v2" | "v3";
  readonly divergentConstraintSourceId?: boolean;
  readonly foreignRequirementsTargetId?: boolean;
  readonly staleRequirements?: boolean;
  readonly archiveRequirements?: boolean;
  readonly successorArchitecture?: boolean;
}

async function exactFixture(options: FixtureOptions = {}) {
  const documentary = documentaryBaseline();
  const seedInput = {
    base: documentary,
    lineage: seedLineage(documentary),
    trustedRunId: "run:seed-basis-test",
    capturedAt: SEED_AT,
    projectCreateResult: {
      id: "syson-project-basis-test",
      name: "Basis test",
      editingContextId: "editing-context-basis-test",
    },
    modelCreateResult: {
      documentId: "document-basis-test",
      documentName: "Basis test model",
      documentKind: "Document",
      rootPackageId: "root-package-basis-test",
      rootPackageLabel: "Basis test model",
    },
    rootPackageGetResult: {
      id: "root-package-basis-test",
      kind: "Package",
      label: "Basis test model",
    },
  };
  const initialSeed = await materializeSysonModelSeed(seedInput);
  const seed = await materializeSysonModelSeed({
    ...seedInput,
    captureUri: `casys://syson-model-seed-capture/sha256/${initialSeed.sha256.digest}`,
  });
  const seedArtifact = seed.snapshot.artifacts.find((artifact) =>
    artifact.kind === "sysml-model"
  )!;

  const architectureCapture = {
    schemaVersion: ARCHITECTURE_CAPTURE_SCHEMA,
    operation: { id: "model.write-architecture", version: "1" },
    trustedRunId: "run:architecture-basis-test",
    packageName: "BasisPackage",
    systemName: "BasisSystem",
    scopeRoot: {
      id: "package-basis-test",
      kind: "Package",
      label: "BasisPackage",
    },
    semanticRoot: {
      id: "part-definition-system",
      kind: "PartDefinition",
      label: "BasisSystem",
    },
    seed: {
      artifactId: seedArtifact.id,
      fingerprint: seedArtifact.fingerprint,
      producerRunId: seedArtifact.producer.runId,
    },
    partDefinitions: [{
      id: "part-definition-system",
      kind: "PartDefinition",
      label: "BasisSystem",
      usages: [{
        id: "part-usage-frame",
        kind: "PartUsage",
        label: "frame",
        targetId: "part-definition-frame",
        targetKind: "PartDefinition",
        targetLabel: "Frame",
      }],
    }, {
      id: options.duplicateSysmlId ? "part-definition-system" : "part-definition-frame",
      kind: "PartDefinition",
      label: "Frame",
      usages: [],
      ...(options.frameAttribute
        ? {
          attributes: [{
            id: "attribute-usage-frame-thickness",
            kind: "AttributeUsage",
            label: "thickness",
          }],
        }
        : {}),
    }],
    insertedAt: ARCHITECTURE_AT,
    sourceAnalyses: [{
      sourceId: "sysml-source:basis-test",
      selector: { kind: "full-package", packageName: "BasisPackage" },
      runId: "run:architecture-basis-test",
      operation: { id: "model.write-architecture", version: "1" },
      sourceFingerprint: fingerprint("b"),
      sourceCaptureFingerprint: fingerprint("c"),
      analysisFingerprint: fingerprint("d"),
    }],
  } as const;
  let architectureFingerprint = await sha256Fingerprint(architectureCapture);
  const originalArchitectureDigest = architectureFingerprint.digest;
  let architectureArtifactId = `architecture-${architectureFingerprint.digest}`;
  const extraArchitectureCaptures: Array<readonly [string, string]> = [];
  const architectureChangeId =
    `architecture-basis-test:created:${architectureArtifactId}`;
  const architectureArtifact = {
    id: architectureArtifactId,
    name: "Architecture: BasisPackage",
    kind: "sysml-model" as const,
    version: architectureFingerprint.digest,
    fingerprint: architectureFingerprint,
    uri: `casys://architecture-capture/sha256/${architectureFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: "run:architecture-basis-test",
    },
    inputArtifactIds: [seedArtifact.id],
    freshness: options.staleArchitecture
      ? {
        status: "stale" as const,
        changedAt: ARCHITECTURE_AT,
        reason: "Explicit stale-evidence test.",
        invalidatedByChangeIds: [architectureChangeId],
      }
      : {
        status: "fresh" as const,
        changedAt: ARCHITECTURE_AT,
        invalidatedByChangeIds: [],
      },
  };
  let snapshot = applyThreadSnapshotExtension(seed.snapshot, {
    id: "architecture-basis-test",
    name: "Capture exact architecture",
    subjectId: SUBJECT_ID,
    capturedAt: ARCHITECTURE_AT,
    artifacts: [architectureArtifact],
    consumptions: [{
      id: "consumption:architecture-basis-test:seed",
      artifactId: seedArtifact.id,
      consumer: architectureArtifact.producer,
      observedFingerprint: seedArtifact.fingerprint,
      verifiedAt: ARCHITECTURE_AT,
      status: "verified",
    }],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "derived:architecture-basis-test:seed",
      relation: "derived_from",
      from: { kind: "artifact", id: architectureArtifact.id },
      to: { kind: "artifact", id: seedArtifact.id },
      rationale: "The exact architecture consumed the exact SysON seed.",
    }, {
      id: "uses:architecture-basis-test:seed",
      relation: "uses",
      from: {
        kind: "consumption",
        id: "consumption:architecture-basis-test:seed",
      },
      to: { kind: "artifact", id: seedArtifact.id },
      rationale: "The consumption attests the exact SysON seed bytes.",
    }],
    proposedActions: [],
  }, { appliedAt: ARCHITECTURE_AT });
  const architectureSnapshot = snapshot;
  const successorSnapshots: ThreadSnapshot[] = [architectureSnapshot];
  const requirementsCaptures = new Map<string, string>();
  let requirementsArtifactId: string | undefined;
  let requirementsDigest: string | undefined;
  if (options.requirementsCaptureVersion) {
    const requirementsCapture: Record<string, unknown> = {
      schemaVersion: options.requirementsCaptureVersion === "v3"
        ? REQUIREMENTS_CAPTURE_SCHEMA
        : "requirements-capture/2.0",
      operation: { id: "model.write-requirements", version: "1" },
      trustedRunId: "run:requirements-basis-test",
      containerComponent: "Frame",
      partDefName: "FrameRequirements",
      target: {
        kind: "part-definition",
        label: "Frame",
        elementId: options.foreignRequirementsTargetId
          ? "part-definition-homonym"
          : "part-definition-frame",
      },
      architectureBasis: {
        snapshotId: architectureSnapshot.id,
        revision: architectureSnapshot.revision,
        fingerprint: architectureFingerprint.digest,
      },
      requirements: [{
        id: "maximum-frame-displacement",
        name: "Maximum frame displacement",
        metric: "frameDisplacement",
        operator: "<=",
        limit: { value: 3, unit: "mm" },
      }],
      seed: {
        artifactId: seedArtifact.id,
        fingerprint: seedArtifact.fingerprint,
        producerRunId: seedArtifact.producer.runId,
      },
      architecture: {
        artifactId: architectureArtifact.id,
        fingerprint: architectureArtifact.fingerprint,
        producerRunId: architectureArtifact.producer.runId,
      },
      requirementsElementId: "requirement-usage-frame",
      insertedAt: REQUIREMENTS_AT,
      ...(options.requirementsCaptureVersion === "v3"
        ? {
          requirementUsage: {
            id: "requirement-usage-frame",
            kind: "RequirementUsage",
          },
          constraintUsages: [{
            requirementId: "maximum-frame-displacement",
            id: "constraint-usage-frame-displacement",
            kind: "ConstraintUsage",
            sourceId: options.divergentConstraintSourceId
              ? "constraint-usage-foreign"
              : "constraint-usage-frame-displacement",
          }],
        }
        : {}),
    };
    const requirementsFingerprint = await sha256Fingerprint(
      requirementsCapture,
    );
    requirementsDigest = requirementsFingerprint.digest;
    requirementsArtifactId = `requirements-Frame-${requirementsFingerprint.digest}`;
    const requirementsArtifact = {
      id: requirementsArtifactId,
      name: "Requirements: Frame",
      kind: "sysml-model" as const,
      version: requirementsFingerprint.digest,
      fingerprint: requirementsFingerprint,
      uri:
        `casys://requirements-capture/Frame/sha256/${requirementsFingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:requirements-basis-test",
      },
      inputArtifactIds: [architectureArtifact.id],
      freshness: options.staleRequirements
        ? {
          status: "stale" as const,
          changedAt: REQUIREMENTS_AT,
          reason: "Explicit stale requirements evidence test.",
          invalidatedByChangeIds: [
            `requirements-basis-test:created:${requirementsArtifactId}`,
          ],
        }
        : {
          status: "fresh" as const,
          changedAt: REQUIREMENTS_AT,
          invalidatedByChangeIds: [],
        },
    };
    snapshot = applyThreadSnapshotExtension(snapshot, {
      id: "requirements-basis-test",
      name: "Capture exact requirements",
      subjectId: SUBJECT_ID,
      capturedAt: REQUIREMENTS_AT,
      artifacts: [requirementsArtifact],
      consumptions: [{
        id: "consumption:requirements-basis-test:architecture",
        artifactId: architectureArtifact.id,
        consumer: requirementsArtifact.producer,
        observedFingerprint: architectureArtifact.fingerprint,
        verifiedAt: REQUIREMENTS_AT,
        status: "verified",
      }],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [{
        id: "derived:requirements-basis-test:architecture",
        relation: "derived_from",
        from: { kind: "artifact", id: requirementsArtifact.id },
        to: { kind: "artifact", id: architectureArtifact.id },
        rationale: "The exact requirements consumed the exact architecture.",
      }, {
        id: "uses:requirements-basis-test:architecture",
        relation: "uses",
        from: {
          kind: "consumption",
          id: "consumption:requirements-basis-test:architecture",
        },
        to: { kind: "artifact", id: architectureArtifact.id },
        rationale: "The consumption attests the exact architecture bytes.",
      }],
      proposedActions: [],
    }, { appliedAt: REQUIREMENTS_AT });
    successorSnapshots.push(snapshot);
    requirementsCaptures.set(
      requirementsFingerprint.digest,
      deterministicJson(requirementsCapture),
    );
    if (options.archiveRequirements) {
      snapshot = applyThreadSnapshotExtension(snapshot, {
        id: "archive-requirements-basis-test",
        name: "Archive exact requirements",
        subjectId: SUBJECT_ID,
        capturedAt: "2026-08-12T09:11:00.000Z",
        artifacts: [],
        consumptions: [],
        observations: [],
        requirements: [],
        evaluations: [],
        violations: [],
        provenance: [],
        proposedActions: [],
        archived: [{
          target: { kind: "artifact", id: requirementsArtifact.id },
          summary: "Retired by explicit requirements fixture.",
        }],
      });
      successorSnapshots.push(snapshot);
    }
  }
  if (options.successorArchitecture) {
    const successorAt = "2026-08-12T09:12:00.000Z";
    const successorCapture = {
      ...architectureCapture,
      trustedRunId: "run:architecture-successor-basis-test",
      insertedAt: successorAt,
      predecessor: {
        artifactId: architectureArtifact.id,
        fingerprint: architectureArtifact.fingerprint,
        producerRunId: architectureArtifact.producer.runId,
      },
      sourceAnalyses: [{
        ...architectureCapture.sourceAnalyses[0],
        runId: "run:architecture-successor-basis-test",
        sourceId: "sysml-source:basis-test-successor",
      }],
    };
    const successorFingerprint = await sha256Fingerprint(successorCapture);
    const successorArtifactId = `architecture-${successorFingerprint.digest}`;
    const successorArtifact = {
      ...architectureArtifact,
      id: successorArtifactId,
      version: successorFingerprint.digest,
      fingerprint: successorFingerprint,
      uri: `casys://architecture-capture/sha256/${successorFingerprint.digest}`,
      producer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:architecture-successor-basis-test",
      },
      inputArtifactIds: [seedArtifact.id, architectureArtifact.id],
      freshness: {
        status: "fresh" as const,
        changedAt: successorAt,
        invalidatedByChangeIds: [],
      },
    };
    snapshot = applyThreadSnapshotExtension(snapshot, {
      id: "architecture-successor-basis-test",
      name: "Capture successor architecture",
      subjectId: SUBJECT_ID,
      capturedAt: successorAt,
      artifacts: [successorArtifact],
      consumptions: [{
        id: "consumption:architecture-successor-basis-test:seed",
        artifactId: seedArtifact.id,
        consumer: successorArtifact.producer,
        observedFingerprint: seedArtifact.fingerprint,
        verifiedAt: successorAt,
        status: "verified",
      }, {
        id: "consumption:architecture-successor-basis-test:predecessor",
        artifactId: architectureArtifact.id,
        consumer: successorArtifact.producer,
        observedFingerprint: architectureArtifact.fingerprint,
        verifiedAt: successorAt,
        status: "verified",
      }],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [{
        id: "derived:architecture-successor-basis-test:seed",
        relation: "derived_from",
        from: { kind: "artifact", id: successorArtifact.id },
        to: { kind: "artifact", id: seedArtifact.id },
        rationale: "The successor architecture consumed the exact SysON seed.",
      }, {
        id: "derived:architecture-successor-basis-test:predecessor",
        relation: "derived_from",
        from: { kind: "artifact", id: successorArtifact.id },
        to: { kind: "artifact", id: architectureArtifact.id },
        rationale: "The successor architecture consumed the exact predecessor.",
      }, {
        id: "uses:architecture-successor-basis-test:seed",
        relation: "uses",
        from: {
          kind: "consumption",
          id: "consumption:architecture-successor-basis-test:seed",
        },
        to: { kind: "artifact", id: seedArtifact.id },
        rationale: "The consumption attests the exact SysON seed bytes.",
      }, {
        id: "uses:architecture-successor-basis-test:predecessor",
        relation: "uses",
        from: {
          kind: "consumption",
          id: "consumption:architecture-successor-basis-test:predecessor",
        },
        to: { kind: "artifact", id: architectureArtifact.id },
        rationale: "The consumption attests the exact predecessor bytes.",
      }],
      proposedActions: [],
    }, { appliedAt: successorAt });
    successorSnapshots.push(snapshot);
    extraArchitectureCaptures.push([
      successorFingerprint.digest,
      deterministicJson(successorCapture),
    ]);
    architectureArtifactId = successorArtifactId;
    architectureFingerprint = successorFingerprint;
  }

  if (options.archiveArchitecture) {
    snapshot = applyThreadSnapshotExtension(snapshot, {
      id: "archive-architecture-basis-test",
      name: "Archive exact architecture",
      subjectId: SUBJECT_ID,
      capturedAt: "2026-08-12T09:06:00.000Z",
      artifacts: [],
      consumptions: [],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [],
      proposedActions: [],
      archived: [{
        target: { kind: "artifact", id: architectureArtifactId },
        summary: "Retired by explicit test fixture.",
      }],
    });
    successorSnapshots.push(snapshot);
  }

  const project = projectSnapshot(
    [
      documentary,
      seed.snapshot,
      ...successorSnapshots,
    ],
    options.declareBasisInProject !== false,
  );
  const snapshots = new Map<string, ThreadSnapshot>([
    [documentary.id, documentary],
    [seed.snapshot.id, seed.snapshot],
    ...successorSnapshots.map((candidate) => [candidate.id, candidate] as const),
  ]);
  const architectureCaptures = new Map([
    [originalArchitectureDigest, deterministicJson(architectureCapture)],
    ...extraArchitectureCaptures,
  ]);
  const seedCaptures = new Map([
    [seed.sha256.digest, seed.text],
  ]);
  const resolver = new CaptureBackedTechnicalCompilationBasisResolver({
    projects: { get: () => Promise.resolve(project) },
    snapshots: {
      get: (snapshotId) => Promise.resolve(snapshots.get(snapshotId)),
    },
    architectureCaptures: {
      read: (expected) => Promise.resolve(architectureCaptures.get(expected.digest)),
    },
    seedCaptures: {
      read: (expected) => Promise.resolve(seedCaptures.get(expected.digest)),
    },
    requirementsCaptures: {
      read: (expected) => Promise.resolve(requirementsCaptures.get(expected.digest)),
    },
  });
  const request: TechnicalCompilationBasisResolutionRequest = {
    projectId: PROJECT_ID,
    basis: threadBasis(snapshot),
  };
  return {
    resolver,
    request,
    project,
    snapshot,
    seedSnapshot: seed.snapshot,
    snapshots,
    architectureCaptures,
    seedCaptures,
    requirementsCaptures,
    architectureArtifactId,
    architectureDigest: architectureFingerprint.digest,
    requirementsArtifactId,
    requirementsDigest,
  };
}

function projectSnapshot(
  snapshots: readonly ThreadSnapshot[],
  declareBasis: boolean,
): EngineeringProjectSnapshot {
  const snapshot = snapshots.at(-1)!;
  const generatedAt = snapshot.generatedAt;
  const objective = "Resolve an exact technical basis without a provider call.";
  const briefId = `${PROJECT_ID}:brief`;
  const briefSnapshotId = `${PROJECT_ID}:brief:r1:fixture`;
  const briefFingerprint = {
    algorithm: "sha256" as const,
    digest: "e".repeat(64),
  };
  return validateEngineeringProjectSnapshot({
    schemaVersion: "4.0",
    id: "basis-test:project:r2",
    revision: 2,
    previous: { snapshotId: "basis-test:project:r1", revision: 1 },
    generatedAt,
    project: {
      id: PROJECT_ID,
      name: "Technical basis test",
      subjectId: SUBJECT_ID,
      objective: { title: objective, statement: objective },
    },
    framing: {
      intent: {
        statement: objective,
        source: { kind: "human", reference: "paired-conversation" },
        capturedAt: generatedAt,
        capturedBy: { id: "human:owner", origin: "human" },
      },
      questions: [],
      answers: [],
      currentBrief: {
        briefId,
        id: briefSnapshotId,
        revision: 1,
        items: [{
          id: "objective",
          kind: "objective",
          statement: objective,
          sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
        }, {
          id: "mission",
          kind: "mission-scenario",
          statement:
            "Review the technical compilation basis against recorded evidence.",
          sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
        }, {
          id: "success",
          kind: "success-criterion",
          statement:
            "The basis reopens exact current architecture and requirements captures.",
          sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
        }],
        proposedAt: generatedAt,
        proposedBy: { id: "agent:planner", origin: "agent" },
      },
      currentBriefApproval: {
        briefSnapshotId,
        briefRevision: 1,
        status: "approved",
        inputFingerprint: briefFingerprint,
        requestedAt: generatedAt,
        decidedAt: generatedAt,
        decidedBy: { id: "human:owner", origin: "human" },
        rationale: "Confirmed for the technical-basis fixture.",
      },
    },
    threadSnapshots: declareBasis ? snapshots.map(threadRef) : [{
      snapshotId: "foreign-snapshot",
      revision: 1,
      subjectId: SUBJECT_ID,
    }],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "project-start",
      type: "project.start",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: generatedAt,
      appliedAt: generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      resultingSnapshot: { snapshotId: "basis-test:project:r1", revision: 1 },
    }, {
      commandId: "project-brief-approve",
      type: "project.brief-approve",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: generatedAt,
      appliedAt: generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      resultingSnapshot: { snapshotId: "basis-test:project:r2", revision: 2 },
      approvedBriefBasis: {
        kind: "approved-brief",
        projectId: PROJECT_ID,
        projectSnapshotId: "basis-test:project:r2",
        projectRevision: 2,
        briefId,
        briefSnapshotId,
        briefRevision: 1,
        approvedBriefFingerprint: briefFingerprint,
      },
    }],
  });
}

function threadRef(snapshot: ThreadSnapshot) {
  return {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
}

function threadBasis(snapshot: ThreadSnapshot): EngineeringThreadSnapshotBasis {
  return {
    kind: "thread-snapshot",
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
}

function seedLineage(base: ThreadSnapshot) {
  const documentary = base.artifacts[0]!;
  return {
    approvedBriefBasis: {
      kind: "approved-brief" as const,
      projectId: PROJECT_ID,
      projectSnapshotId: "basis-test:project:r1",
      projectRevision: 1,
      briefId: "basis-test:brief",
      briefSnapshotId: "basis-test:brief:r1",
      briefRevision: 1,
      approvedBriefFingerprint: fingerprint("e"),
    },
    plan: {
      publishedAt: "2026-08-12T08:55:00.000Z",
      publishedBy: {
        id: "agent:technical-basis-test",
        origin: "agent" as const,
      },
    },
    projectChange: {
      id: "change:append-syson-seed",
      commandId: "append-syson-seed",
      publishedAt: "2026-08-12T08:56:00.000Z",
      publishedBy: {
        id: "agent:technical-basis-test",
        origin: "agent" as const,
      },
    },
    workItemId: "seed-syson-model",
    baseSnapshot: {
      snapshotId: base.id,
      revision: base.revision,
      subjectId: base.subject.id,
    },
    documentaryArtifact: {
      id: documentary.id,
      fingerprint: documentary.fingerprint,
      uri: documentary.uri!,
      producerRunId: documentary.producer.runId,
    },
  };
}

function documentaryBaseline(): ThreadSnapshot {
  const artifactId = `approved-brief-document-${DOCUMENT_DIGEST}`;
  const changeSetId = `approved-brief-baseline-${DOCUMENT_DIGEST}`;
  const changeId = `${changeSetId}:record-document`;
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: `${SUBJECT_ID}:r1:${changeSetId}`,
    revision: 1,
    generatedAt: "2026-08-12T08:50:00.000Z",
    subject: {
      id: SUBJECT_ID,
      name: "Technical basis test",
      kind: "system",
      version: DOCUMENT_DIGEST,
      modelArtifactId: artifactId,
    },
    freshness: {
      status: "fresh",
      changedAt: "2026-08-12T08:50:00.000Z",
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: changeSetId,
      name: "Record approved brief documentary baseline",
      status: "applied",
      createdAt: "2026-08-12T08:50:00.000Z",
      appliedAt: "2026-08-12T08:50:00.000Z",
      changes: [{
        id: changeId,
        kind: "created",
        target: { kind: "artifact", id: artifactId },
        summary: "Recorded documentary baseline.",
        afterFingerprint: fingerprint("a"),
      }],
    },
    artifacts: [{
      id: artifactId,
      name: "Approved project brief documentary baseline (pre-technical)",
      kind: "document",
      version: DOCUMENT_DIGEST,
      fingerprint: fingerprint("a"),
      uri: `casys://approved-brief-capture/sha256/${DOCUMENT_DIGEST}`,
      mediaType: "application/json",
      producer: {
        serverId: "casys-digital-thread",
        tool: "baseline_from_approved_brief",
        runId: "run:approved-brief-baseline",
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: "2026-08-12T08:50:00.000Z",
        invalidatedByChangeIds: [],
      },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `${changeSetId}:changes:${artifactId}`,
      relation: "changes",
      from: { kind: "change", id: changeId },
      to: { kind: "artifact", id: artifactId },
      rationale: "This records the documentary pre-technical baseline.",
    }],
    proposedActions: [],
  });
}

function fingerprint(digit: string) {
  return { algorithm: "sha256" as const, digest: digit.repeat(64) };
}
