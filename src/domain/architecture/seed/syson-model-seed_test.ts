import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import {
  materializeSysonModelSeed,
  parseSysonModelSeedCapture,
  SysonModelSeedMaterializationError,
} from "./syson-model-seed.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../thread/thread-snapshot-extension.ts";
import type { ThreadSnapshot } from "../../thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../thread/thread-snapshot-validation.ts";

const AT = "2026-08-02T12:10:00.000Z";
const DOCUMENT_DIGEST = "a".repeat(64);

Deno.test("SysON model seed records a closed identity capture and advances documentary r1 to r2", async () => {
  const base = documentaryBaseline();
  const result = await materializeSysonModelSeed(seedInput(base));
  const model = result.snapshot.artifacts.at(-1)!;

  assertEquals(result.capture.normalizedResults, {
    project: {
      id: "project-123",
      name: "Drone concept",
      editingContextId: "editing-context-456",
    },
    document: {
      id: "document-789",
      name: "Drone system model",
      kind: "Document",
    },
    rootPackage: {
      id: "root-package-012",
      kind: "Package",
      label: "Drone system model",
    },
  });
  assertEquals(result.text, deterministicJson(result.capture));
  assertEquals(new TextDecoder().decode(result.bytes), result.text);
  assertEquals(result.sha256, await sha256Fingerprint(result.capture));

  assertEquals(result.snapshot.revision, 2);
  assertEquals(result.snapshot.previous, { snapshotId: base.id, revision: 1 });
  assertEquals(result.snapshot.subject, base.subject);
  assertEquals(result.snapshot.subject.modelArtifactId, base.subject.modelArtifactId);
  assertEquals(result.snapshot.artifacts.length, 2);
  assertEquals(model.kind, "sysml-model");
  assertEquals(model.version, result.sha256.digest);
  assertEquals(model.fingerprint, result.sha256);
  assertEquals(model.inputArtifactIds, []);
  assertEquals(model.producer, {
    serverId: "syson",
    tool: "syson_model_create",
    runId: "run:seed-syson-model",
  });
  assertEquals(result.extension.bindingProofs, [{
    provider: "syson",
    kind: "project",
    id: "project-123",
  }]);
  assertEquals(
    result.snapshot.provenance.some((link) => link.relation === "derived_from"),
    false,
  );
  assertEquals(result.snapshot.consumptions, []);
  assertEquals(result.snapshot.observations, []);
  assertEquals(result.snapshot.requirements, []);
  assertEquals(result.snapshot.evaluations, []);
  assertEquals(result.snapshot.violations, []);
  assertEquals(result.snapshot.proposedActions, []);
});

Deno.test("SysON model seed is deterministic and an already attached extension does not mint r3", async () => {
  const base = documentaryBaseline();
  const first = await materializeSysonModelSeed(seedInput(base));
  const repeated = await materializeSysonModelSeed(seedInput(base));
  const withCaptureUri = await materializeSysonModelSeed(
    seedInput(base, {
      captureUri: `casys://syson-model-seed-capture/sha256/${first.sha256.digest}`,
    }),
  );
  const replay = applyThreadSnapshotExtensionIfNew(
    first.snapshot,
    first.extension,
    { appliedAt: AT },
  );

  assertEquals(repeated.capture, first.capture);
  assertEquals(repeated.sha256, first.sha256);
  assertEquals(repeated.extension, first.extension);
  assertEquals(repeated.snapshot, first.snapshot);
  assertEquals(withCaptureUri.text, first.text);
  assertEquals(withCaptureUri.sha256, first.sha256);
  assertEquals(
    withCaptureUri.snapshot.artifacts.at(-1)?.uri,
    `casys://syson-model-seed-capture/sha256/${first.sha256.digest}`,
  );
  assertEquals(replay.applied, false);
  assertEquals(replay.snapshot, first.snapshot);
});

Deno.test("SysON model seed rejects a root package identity that was not read back exactly", async () => {
  const rootRead = rootPackageGetResult();
  rootRead.id = "other-root-package";

  const error = await assertRejects(
    () =>
      materializeSysonModelSeed(
        seedInput(documentaryBaseline(), { rootPackageGetResult: rootRead }),
      ),
    SysonModelSeedMaterializationError,
  );

  assertEquals(error.code, "inconsistent_provider_result");
});

Deno.test("SysON model seed rejects a non-documentary or later base snapshot", async () => {
  const first = await materializeSysonModelSeed(seedInput(documentaryBaseline()));

  const error = await assertRejects(
    () => materializeSysonModelSeed(seedInput(first.snapshot)),
    SysonModelSeedMaterializationError,
  );

  assertEquals(error.code, "invalid_baseline");
});

Deno.test("SysON model seed capture parser rejects unreviewed fields", async () => {
  const result = await materializeSysonModelSeed(seedInput(documentaryBaseline()));
  const tampered = {
    ...result.capture,
    unreviewedProviderPayload: true,
  };

  assertThrows(
    () => parseSysonModelSeedCapture(tampered),
    SysonModelSeedMaterializationError,
    "must contain exactly",
  );
});

Deno.test("SysON model seed preserves exact MCP actor identities in its lineage", async () => {
  const base = documentaryBaseline();
  const lineage = seedLineage(base);
  lineage.plan.publishedBy.id = "mcp:codex-live-golden-path@1";
  lineage.projectChange.publishedBy.id = "mcp:codex-live-golden-path@1";

  const result = await materializeSysonModelSeed(seedInput(base, { lineage }));
  const parsed = parseSysonModelSeedCapture(result.capture);

  assertEquals(
    parsed.lineage.plan.publishedBy.id,
    "mcp:codex-live-golden-path@1",
  );
  assertEquals(
    parsed.lineage.projectChange.publishedBy.id,
    "mcp:codex-live-golden-path@1",
  );
});

Deno.test(
  "SysON model seed materializes a server-composed approved-brief baseline snapshot id longer than 128 characters",
  async () => {
    const projectId = "generic-industrial-product-with-long-stable-id";
    const base = documentaryBaseline({ projectId });
    assert(
      base.id.length > 128,
      `server-shaped baseline snapshot id must exceed 128 characters, got ${base.id.length}`,
    );
    assert(
      base.id.length <= 256,
      `server-shaped baseline snapshot id must stay within the shared safeId bound, got ${base.id.length}`,
    );
    assertEquals(
      base.id,
      `project:${projectId}:r1:approved-brief-baseline-${DOCUMENT_DIGEST}`,
    );

    const result = await materializeSysonModelSeed(seedInput(base));

    assertEquals(result.capture.lineage.baseSnapshot.snapshotId, base.id);
    assertEquals(result.snapshot.previous, {
      snapshotId: base.id,
      revision: 1,
    });
    assertEquals(result.snapshot.revision, 2);
  },
);

function seedInput(
  base: ThreadSnapshot,
  overrides: Partial<Parameters<typeof materializeSysonModelSeed>[0]> = {},
) {
  return {
    base,
    lineage: seedLineage(base),
    trustedRunId: "run:seed-syson-model",
    capturedAt: AT,
    projectCreateResult: projectCreateResult(),
    modelCreateResult: modelCreateResult(),
    rootPackageGetResult: rootPackageGetResult(),
    ...overrides,
  };
}

function seedLineage(base: ThreadSnapshot) {
  const document = base.artifacts[0]!;
  return {
    approvedBriefBasis: {
      kind: "approved-brief" as const,
      projectId: "drone-concept",
      projectSnapshotId: "drone-concept:project:r3:approve-brief",
      projectRevision: 3,
      briefId: "drone-brief",
      briefSnapshotId: "drone-brief:r1",
      briefRevision: 1,
      approvedBriefFingerprint: {
        algorithm: "sha256" as const,
        digest: "b".repeat(64),
      },
    },
    plan: {
      publishedAt: "2026-08-02T11:00:00.000Z",
      publishedBy: { id: "agent:engineering", origin: "agent" as const },
    },
    projectChange: {
      id: "change:append-syson-seed",
      commandId: "append-syson-seed",
      publishedAt: "2026-08-02T12:05:00.000Z",
      publishedBy: { id: "agent:engineering", origin: "agent" as const },
    },
    workItemId: "seed-syson-model",
    baseSnapshot: {
      snapshotId: base.id,
      revision: base.revision,
      subjectId: base.subject.id,
    },
    documentaryArtifact: {
      id: document.id,
      fingerprint: document.fingerprint,
      uri: document.uri!,
      producerRunId: document.producer.runId,
    },
  };
}

function projectCreateResult() {
  return {
    id: "project-123",
    name: "Drone concept",
    editingContextId: "editing-context-456",
  };
}

function modelCreateResult() {
  return {
    documentId: "document-789",
    documentName: "Drone system model",
    documentKind: "Document",
    rootPackageId: "root-package-012",
    rootPackageLabel: "Drone system model",
  };
}

function rootPackageGetResult() {
  return {
    id: "root-package-012",
    kind: "Package",
    label: "Drone system model",
  };
}

function documentaryBaseline(
  options: { readonly projectId?: string } = {},
): ThreadSnapshot {
  const projectId = options.projectId ?? "drone-concept";
  const subjectId = `project:${projectId}`;
  const artifactId = `approved-brief-document-${DOCUMENT_DIGEST}`;
  const changeSetId = `approved-brief-baseline-${DOCUMENT_DIGEST}`;
  const changeId = `${changeSetId}:record-document`;
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: `${subjectId}:r1:${changeSetId}`,
    revision: 1,
    generatedAt: "2026-08-02T12:00:00.000Z",
    subject: {
      id: subjectId,
      name: "Drone concept",
      kind: "system",
      version: DOCUMENT_DIGEST,
      modelArtifactId: artifactId,
    },
    freshness: {
      status: "fresh",
      changedAt: "2026-08-02T12:00:00.000Z",
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: changeSetId,
      name: "Record approved project brief documentary baseline",
      status: "applied",
      createdAt: "2026-08-02T12:00:00.000Z",
      appliedAt: "2026-08-02T12:00:00.000Z",
      changes: [{
        id: changeId,
        kind: "created",
        target: { kind: "artifact", id: artifactId },
        summary: "Recorded documentary baseline.",
        afterFingerprint: { algorithm: "sha256", digest: DOCUMENT_DIGEST },
      }],
    },
    artifacts: [{
      id: artifactId,
      name: "Approved project brief documentary baseline (pre-technical)",
      kind: "document",
      version: DOCUMENT_DIGEST,
      fingerprint: { algorithm: "sha256", digest: DOCUMENT_DIGEST },
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
        changedAt: "2026-08-02T12:00:00.000Z",
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
