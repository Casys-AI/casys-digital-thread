import { assertEquals } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { ARCHITECTURE_CAPTURE_URI_PREFIX } from "../../shared/cas/file-capture-store.ts";
import { CaptureProductStructureTraversal } from "./capture-product-structure-traversal.ts";
import { reopenVerifiedArchitectureCapture } from "./product-structure-catalog.ts";
import type { SysmlSourceAnalysisReader } from "./sysml-source-analysis-capture.ts";

const AT = "2026-08-08T00:00:00.000Z";
const SUBJECT_ID = "project:drone-v4-test";

export async function verifiedArchitectureNavigationFixture() {
  const capture = architectureCapture();
  const fingerprint = await sha256Fingerprint(capture);
  return {
    capture,
    fingerprint,
    snapshot: architectureSnapshot(fingerprint),
    reader: {
      read: (value: ContentFingerprint) =>
        Promise.resolve(
          value.digest === fingerprint.digest ? deterministicJson(capture) : undefined,
        ),
    },
    sourceAnalysis: passingSourceAnalysis(),
  };
}

Deno.test(
  "product structure traversal reuses catalog authority checks before indexing",
  async () => {
    const fixture = await verifiedArchitectureNavigationFixture();
    const opened = await new CaptureProductStructureTraversal(
      fixture.reader,
      fixture.sourceAnalysis,
    ).open(fixture.snapshot);
    assertEquals(
      opened?.architectureArtifactId,
      `architecture-${fixture.fingerprint.digest}`,
    );
    assertEquals(opened?.root()?.element.elementId, "sys-def-001");
    assertEquals(
      opened?.hasElement({
        elementId: "sys-def-001",
        elementKind: "PartDefinition",
      }),
      true,
    );
    assertEquals(
      opened?.hasElement({
        elementId: "alpha-use-001",
        elementKind: "PartUsage",
      }),
      true,
    );
    assertEquals(
      opened?.hasElement({
        elementId: "sys-def-001",
        elementKind: "PartUsage",
      }),
      false,
    );
    assertEquals(
      await new CaptureProductStructureTraversal(fixture.reader).open(
        fixture.snapshot,
      ),
      undefined,
    );
  },
);

Deno.test(
  "product structure traversal refuses a cyclic definition graph after capture reopen",
  async () => {
    const opened = await openCapture(cyclicArchitectureCapture());
    assertEquals(opened, undefined);
  },
);

Deno.test(
  "product structure traversal refuses an unreachable definition graph after capture reopen",
  async () => {
    const opened = await openCapture(unreachableArchitectureCapture());
    assertEquals(opened, undefined);
  },
);

Deno.test(
  "reopenVerifiedArchitectureCapture returns the capture without building a catalog",
  async () => {
    const fixture = await verifiedArchitectureNavigationFixture();
    const verified = await reopenVerifiedArchitectureCapture(
      fixture.snapshot,
      fixture.reader,
      fixture.sourceAnalysis,
    );
    assertEquals(verified.kind, "one");
    if (verified.kind === "one") {
      assertEquals("components" in verified, false);
      assertEquals(verified.capture.semanticRoot.id, "sys-def-001");
    }
  },
);

async function openCapture(capture: Record<string, unknown>) {
  const fingerprint = await sha256Fingerprint(capture);
  return await new CaptureProductStructureTraversal(
    {
      read: (value: ContentFingerprint) =>
        Promise.resolve(
          value.digest === fingerprint.digest ? deterministicJson(capture) : undefined,
        ),
    },
    passingSourceAnalysis(),
  ).open(architectureSnapshot(fingerprint));
}

function passingSourceAnalysis(): SysmlSourceAnalysisReader {
  return {
    reopen: (value) => Promise.resolve({ reference: structuredClone(value) } as never),
  };
}

function cyclicArchitectureCapture(): Record<string, unknown> {
  const capture = architectureCapture();
  const parts = capture.partDefinitions as Array<Record<string, unknown>>;
  const system = parts[0] as {
    usages: Array<Record<string, unknown>>;
  };
  system.usages = [{
    id: "cycle-use-a",
    kind: "PartUsage",
    label: "a",
    targetId: "cycle-def-a",
    targetKind: "PartDefinition",
    targetLabel: "CycleA",
  }];
  capture.partDefinitions = [parts[0], {
    id: "cycle-def-a",
    kind: "PartDefinition",
    label: "CycleA",
    usages: [{
      id: "cycle-use-b",
      kind: "PartUsage",
      label: "b",
      targetId: "cycle-def-b",
      targetKind: "PartDefinition",
      targetLabel: "CycleB",
    }],
  }, {
    id: "cycle-def-b",
    kind: "PartDefinition",
    label: "CycleB",
    usages: [{
      id: "cycle-use-back",
      kind: "PartUsage",
      label: "back",
      targetId: "cycle-def-a",
      targetKind: "PartDefinition",
      targetLabel: "CycleA",
    }],
  }];
  return capture;
}

function unreachableArchitectureCapture(): Record<string, unknown> {
  const capture = architectureCapture();
  const parts = capture.partDefinitions as Array<Record<string, unknown>>;
  capture.partDefinitions = [...parts, {
    id: "orphan-def-001",
    kind: "PartDefinition",
    label: "Orphan",
    usages: [],
  }];
  return capture;
}

function architectureCapture(): Record<string, unknown> {
  return {
    schemaVersion: "architecture-capture/4.0",
    operation: { id: "model.write-architecture", version: "1" },
    trustedRunId: "run:arch",
    packageName: "SystemV1",
    systemName: "SystemUnit",
    scopeRoot: { id: "pkg-001", kind: "Package", label: "SystemV1" },
    semanticRoot: {
      id: "sys-def-001",
      kind: "PartDefinition",
      label: "SystemUnit",
    },
    seed: {
      artifactId: "seed-artifact",
      fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      producerRunId: "run:seed",
    },
    partDefinitions: [{
      id: "sys-def-001",
      kind: "PartDefinition",
      label: "SystemUnit",
      usages: [{
        id: "alpha-use-001",
        kind: "PartUsage",
        label: "alpha",
        targetId: "alpha-def-001",
        targetKind: "PartDefinition",
        targetLabel: "AlphaModule",
      }],
    }, {
      id: "alpha-def-001",
      kind: "PartDefinition",
      label: "AlphaModule",
      usages: [],
    }],
    insertedAt: AT,
    sourceAnalyses: [{
      sourceId: "sysml-source:system-v1",
      selector: { kind: "full-package", packageName: "SystemV1" },
      runId: "run:arch",
      operation: { id: "model.write-architecture", version: "1" },
      sourceFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      sourceCaptureFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      analysisFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
    }],
  };
}

function architectureSnapshot(captureFp: ContentFingerprint) {
  const archId = `architecture-${captureFp.digest}`;
  const uri = `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${captureFp.digest}`;
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: `${SUBJECT_ID}:r1`,
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Generic project for projector test",
      kind: "system",
      version: captureFp.digest,
      modelArtifactId: "seed-artifact",
    },
    freshness: {
      status: "fresh",
      changedAt: AT,
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "changeset-r1",
      name: "initial architecture",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change-r1",
        kind: "created",
        target: { kind: "artifact", id: archId },
        summary: "Recorded initial architecture.",
        afterFingerprint: captureFp,
      }],
    },
    artifacts: [{
      id: "seed-artifact",
      name: "Seed",
      kind: "sysml-model",
      version: "1".repeat(64),
      fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      uri: "casys://syson-model-seed-capture/sha256/" + "1".repeat(64),
      producer: {
        serverId: "syson",
        tool: "syson_model_create",
        runId: "run:seed",
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: AT,
        invalidatedByChangeIds: [],
      },
    }, {
      id: archId,
      name: "Architecture: SystemV1",
      kind: "sysml-model",
      version: captureFp.digest,
      fingerprint: captureFp,
      uri,
      mediaType: "application/json",
      producer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:arch",
      },
      inputArtifactIds: ["seed-artifact"],
      freshness: {
        status: "fresh",
        changedAt: AT,
        invalidatedByChangeIds: [],
      },
    }],
    consumptions: [{
      id: "consume-seed",
      artifactId: "seed-artifact",
      consumer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:arch",
      },
      observedFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      verifiedAt: AT,
      status: "verified",
    }],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "change-to-arch",
      relation: "changes",
      from: { kind: "change", id: "change-r1" },
      to: { kind: "artifact", id: archId },
      rationale: "The architecture fixture change records the initial evidence.",
    }, {
      id: "uses-seed",
      relation: "uses",
      from: { kind: "consumption", id: "consume-seed" },
      to: { kind: "artifact", id: "seed-artifact" },
      rationale: "The architecture fixture verifies its exact seed.",
    }, {
      id: "derived-from-seed",
      relation: "derived_from",
      from: { kind: "artifact", id: archId },
      to: { kind: "artifact", id: "seed-artifact" },
      rationale: "The architecture fixture derives from its exact seed.",
    }],
    proposedActions: [],
  });
}
