import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { ARCHITECTURE_CAPTURE_URI_PREFIX } from "../captures/file-capture-store.ts";
import type {
  SysmlSourceAnalysisReader,
  VerifiedSysmlSourceAnalysis,
} from "../captures/sysml-source-analysis-capture.ts";
import type { GenericArchitectureCaptureReader } from "./product-structure-catalog.ts";
import { resolveGenericProductStructureCatalog } from "./product-structure-catalog.ts";

const AT = "2026-08-08T00:00:00.000Z";
const SUBJECT_ID = "project:drone-v4-test";
// Generic subject — no product name in the module under test.

// ── Minimal fixture helper ────────────────────────────────────────────────────

/** Capture record shape produced by model.write-architecture@1. */
function makeCaptureRecord(
  overrides?: Partial<{
    systemName: string;
    declarations: {
      id: string;
      label: string;
      usages?: { id: string; label: string; targetId: string; targetLabel: string }[];
    }[];
  }>,
): Record<string, unknown> {
  return {
    schemaVersion: "architecture-capture/2.0",
    operation: { id: "model.write-architecture", version: "1" },
    trustedRunId: "run:arch",
    packageName: "SystemV1",
    systemName: overrides?.systemName ?? "SystemUnit",
    package: { id: "pkg-001", label: "SystemV1" },
    seed: {
      artifactId: "seed-artifact",
      fingerprint: fingerprint("1"),
      producerRunId: "run:seed",
    },
    partDefinitions: (overrides?.declarations ?? [
      {
        id: "sys-def-001",
        label: "SystemUnit",
        usages: [
          {
            id: "alpha-use-001",
            label: "alpha",
            targetId: "alpha-def-001",
            targetLabel: "AlphaModule",
          },
          {
            id: "beta-use-001",
            label: "beta",
            targetId: "beta-def-001",
            targetLabel: "BetaModule",
          },
        ],
      },
      { id: "alpha-def-001", label: "AlphaModule" },
      { id: "beta-def-001", label: "BetaModule" },
    ]).map((declaration) => ({
      id: declaration.id,
      kind: "PartDefinition",
      label: declaration.label,
      usages: (declaration.usages ?? []).map((usage) => ({
        ...usage,
        kind: "PartUsage",
        targetKind: "PartDefinition",
      })),
    })),
    insertedAt: AT,
  };
}

function makeCurrentCaptureRecord(): Record<string, unknown> {
  return {
    ...makeCaptureRecord(),
    schemaVersion: "architecture-capture/3.0",
    sourceAnalyses: [{
      sourceId: "sysml-source:system-v1",
      selector: { kind: "full-package", packageName: "SystemV1" },
      runId: "run:arch",
      operation: { id: "model.write-architecture", version: "1" },
      sourceFingerprint: fingerprint("a"),
      sourceCaptureFingerprint: fingerprint("b"),
      analysisFingerprint: fingerprint("c"),
    }],
  };
}

function fingerprint(char: string): ContentFingerprint {
  return { algorithm: "sha256", digest: char.repeat(64) };
}

function fresh() {
  return {
    status: "fresh" as const,
    changedAt: AT,
    invalidatedByChangeIds: [],
  };
}

/**
 * Build a minimal valid `ThreadSnapshot` carrying one architecture artifact
 * identified by the generic URI prefix, with the given content fingerprint.
 */
function snapshotWithArchArtifact(captureFp: ContentFingerprint) {
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
    freshness: fresh(),
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
      fingerprint: fingerprint("1"),
      uri: "casys://syson-model-seed-capture/sha256/" + "1".repeat(64),
      producer: { serverId: "syson", tool: "syson_model_create", runId: "run:seed" },
      inputArtifactIds: [],
      freshness: fresh(),
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
      freshness: fresh(),
    }],
    consumptions: [{
      id: "consume-seed",
      artifactId: "seed-artifact",
      consumer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:arch",
      },
      observedFingerprint: fingerprint("1"),
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

/**
 * Build a reader that serves `deterministicJson(captureRecord)` for the given
 * fingerprint (and nothing else).
 *
 * This mirrors the exact text + fingerprint the executor produces after the
 * executor-side fix: captureFp = sha256Fingerprint(captureRecord).
 */
function makeReader(
  captureFp: ContentFingerprint,
  captureRecord: Record<string, unknown>,
): GenericArchitectureCaptureReader {
  const text = deterministicJson(captureRecord);
  return {
    read: (fp) =>
      fp.digest === captureFp.digest
        ? Promise.resolve(text)
        : Promise.resolve(undefined),
  };
}

function architectureArtifact(
  fingerprint: ContentFingerprint,
  runId: string,
  insertedAt: string,
  inputArtifactIds: readonly string[],
): ThreadArtifact {
  return {
    id: `architecture-${fingerprint.digest}`,
    name: "Architecture: SystemV1",
    kind: "sysml-model",
    version: fingerprint.digest,
    fingerprint,
    uri: `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${fingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId,
    },
    inputArtifactIds: [...inputArtifactIds],
    freshness: {
      status: "fresh",
      changedAt: insertedAt,
      invalidatedByChangeIds: [],
    },
  };
}

function consumption(
  artifactId: string,
  fingerprint: ContentFingerprint,
  runId: string,
  insertedAt: string,
): ThreadArtifactConsumption {
  return {
    id: `consume-${artifactId}-by-${runId}`,
    artifactId,
    consumer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId,
    },
    observedFingerprint: fingerprint,
    verifiedAt: insertedAt,
    status: "verified",
  };
}

async function appendEnrichment(
  snapshot: ThreadSnapshot,
  predecessor: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly runId: string;
  },
  runId: string,
  insertedAt: string,
): Promise<{
  readonly snapshot: ThreadSnapshot;
  readonly capture: Record<string, unknown>;
  readonly fingerprint: ContentFingerprint;
  readonly artifact: ThreadArtifact;
}> {
  const capture = {
    ...makeCaptureRecord(),
    trustedRunId: runId,
    predecessor: {
      artifactId: predecessor.id,
      fingerprint: predecessor.fingerprint,
      producerRunId: predecessor.runId,
    },
    insertedAt,
  };
  const captureFingerprint = await sha256Fingerprint(capture);
  const artifact = architectureArtifact(captureFingerprint, runId, insertedAt, [
    "seed-artifact",
    predecessor.id,
  ]);
  return {
    snapshot: {
      ...snapshot,
      artifacts: [...snapshot.artifacts, artifact],
      consumptions: [
        ...snapshot.consumptions,
        consumption("seed-artifact", fingerprint("1"), runId, insertedAt),
        consumption(
          predecessor.id,
          predecessor.fingerprint,
          runId,
          insertedAt,
        ),
      ],
    },
    capture,
    fingerprint: captureFingerprint,
    artifact,
  };
}

function readerFor(
  records: readonly {
    readonly fingerprint: ContentFingerprint;
    readonly capture: Record<string, unknown>;
  }[],
): GenericArchitectureCaptureReader {
  const textByDigest = new Map(
    records.map(({ fingerprint, capture }) => [
      fingerprint.digest,
      deterministicJson(capture),
    ]),
  );
  return {
    read: (fingerprint) => Promise.resolve(textByDigest.get(fingerprint.digest)),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test(
  "resolveGenericProductStructureCatalog returns undefined when the snapshot has no architecture artifact",
  async () => {
    // Snapshot with a sysml-model artifact whose URI does NOT start with the
    // generic prefix (e.g., it uses a GEN-01-specific prefix).
    const aFp = fingerprint("a");
    const snapshot = validateThreadSnapshot({
      schemaVersion: "1.0",
      id: `${SUBJECT_ID}:r1`,
      revision: 1,
      generatedAt: AT,
      subject: {
        id: SUBJECT_ID,
        name: "Project with non-matching artifact",
        kind: "system",
        version: aFp.digest,
        modelArtifactId: "other-model-artifact",
      },
      freshness: fresh(),
      changeSet: {
        id: "cs-r1",
        name: "other architecture",
        status: "applied",
        createdAt: AT,
        appliedAt: AT,
        changes: [{
          id: "change-other",
          kind: "created",
          target: { kind: "artifact", id: "other-model-artifact" },
          summary: "Some other architecture.",
          afterFingerprint: aFp,
        }],
      },
      artifacts: [{
        id: "other-model-artifact",
        name: "Other architecture",
        kind: "sysml-model",
        version: aFp.digest,
        fingerprint: aFp,
        // URI does NOT start with ARCHITECTURE_CAPTURE_URI_PREFIX
        uri: "casys://generic-product-v3-architecture/sha256/" + aFp.digest,
        producer: {
          serverId: "syson",
          tool: "syson_element_insert_sysml",
          runId: "run:other",
        },
        inputArtifactIds: [],
        freshness: fresh(),
      }],
      consumptions: [],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [{
        id: "prov-other",
        relation: "changes",
        from: { kind: "change", id: "change-other" },
        to: { kind: "artifact", id: "other-model-artifact" },
        rationale: "The fixture change records a non-generic architecture artifact.",
      }],
      proposedActions: [],
    });

    const emptyReader: GenericArchitectureCaptureReader = {
      read: () => Promise.resolve(undefined),
    };

    assertEquals(
      await resolveGenericProductStructureCatalog(snapshot, emptyReader),
      undefined,
    );
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog resolves an assembly and its parts from a valid capture",
  async () => {
    const captureRecord = makeCaptureRecord();
    const captureFp = await sha256Fingerprint(captureRecord);
    const snapshot = snapshotWithArchArtifact(captureFp);
    const reader = makeReader(captureFp, captureRecord);

    const catalog = await resolveGenericProductStructureCatalog(snapshot, reader);

    const archId = `architecture-${captureFp.digest}`;
    assertEquals(catalog?.subjectId, SUBJECT_ID);
    assertEquals(catalog?.components.length, 3);

    // Assembly = the system declaration
    const assembly = catalog?.components.find((c) => c.kind === "assembly");
    assertEquals(assembly?.id, `${SUBJECT_ID}:system`);
    assertEquals(assembly?.label, "SystemUnit");
    assertEquals(assembly?.quantity, 1);
    assertEquals(assembly?.bindings, [{
      provider: "syson",
      kind: "part-definition",
      id: "sys-def-001",
      label: "SystemUnit",
      evidenceArtifactId: archId,
    }]);

    // Part components are explicit PartUsage occurrences.
    const parts = catalog?.components.filter((c) => c.kind === "part");
    assertEquals(parts?.length, 2);
    const alpha = parts?.find((c) => c.label === "AlphaModule");
    assertEquals(alpha?.id, `${SUBJECT_ID}:usage:alpha-use-001`);
    assertEquals(alpha?.parentId, `${SUBJECT_ID}:system`);
    assertEquals(alpha?.bindings[0]?.id, "alpha-def-001");

    const beta = parts?.find((c) => c.label === "BetaModule");
    assertEquals(beta?.id, `${SUBJECT_ID}:usage:beta-use-001`);
    assertEquals(beta?.parentId, `${SUBJECT_ID}:system`);
    assertEquals(beta?.bindings[0]?.id, "beta-def-001");
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog returns unavailable when an architecture artifact name is tampered",
  async () => {
    const captureRecord = makeCaptureRecord();
    const captureFp = await sha256Fingerprint(captureRecord);
    const validSnapshot = snapshotWithArchArtifact(captureFp);
    const snapshot = {
      ...validSnapshot,
      artifacts: validSnapshot.artifacts.map((artifact) =>
        artifact.id === `architecture-${captureFp.digest}`
          ? { ...artifact, name: "Architecture: tampered display name" }
          : artifact
      ),
    };

    const catalog = await resolveGenericProductStructureCatalog(
      snapshot,
      makeReader(captureFp, captureRecord),
    );

    assertEquals(catalog?.components, []);
    assertStringIncludes(catalog?.rationale ?? "", "could not be verified");
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog returns unavailable when the capture is not readable",
  async () => {
    const captureRecord = makeCaptureRecord();
    const captureFp = await sha256Fingerprint(captureRecord);
    const snapshot = snapshotWithArchArtifact(captureFp);
    const emptyReader: GenericArchitectureCaptureReader = {
      read: () => Promise.resolve(undefined),
    };

    const catalog = await resolveGenericProductStructureCatalog(
      snapshot,
      emptyReader,
    );

    assertEquals(catalog?.components, []);
    assertStringIncludes(catalog?.rationale ?? "", "not readable");
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog returns unavailable when the capture fingerprint is tampered",
  async () => {
    const captureRecord = makeCaptureRecord();
    const captureFp = await sha256Fingerprint(captureRecord);
    const snapshot = snapshotWithArchArtifact(captureFp);

    // Tampered capture: modify a field so the fingerprint no longer matches.
    const tampered = { ...captureRecord, systemName: "TamperedSystem" };
    const reader: GenericArchitectureCaptureReader = {
      read: () => Promise.resolve(deterministicJson(tampered)),
    };

    const catalog = await resolveGenericProductStructureCatalog(
      snapshot,
      reader,
    );

    assertEquals(catalog?.components, []);
    assertStringIncludes(catalog?.rationale ?? "", "could not be verified");
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog rejects current captures with absent malformed or foreign source analyses",
  async () => {
    const mutations: ReadonlyArray<
      (
        capture: Record<string, unknown>,
      ) => void
    > = [
      (capture) => {
        delete capture.sourceAnalyses;
      },
      (capture) => {
        capture.sourceAnalyses = [{ malformed: true }];
      },
      (capture) => {
        const [reference] = capture.sourceAnalyses as Array<
          Record<string, unknown>
        >;
        reference!.runId = "run:foreign";
      },
      (capture) => {
        const [reference] = capture.sourceAnalyses as Array<
          Record<string, unknown>
        >;
        reference!.operation = { id: "model.write-requirements", version: "1" };
      },
      (capture) => {
        const [reference] = capture.sourceAnalyses as Array<
          Record<string, unknown>
        >;
        reference!.selector = {
          kind: "full-package",
          packageName: "ForeignPackage",
        };
      },
    ];

    for (const mutate of mutations) {
      const capture = makeCurrentCaptureRecord();
      mutate(capture);
      const captureFp = await sha256Fingerprint(capture);
      const catalog = await resolveGenericProductStructureCatalog(
        snapshotWithArchArtifact(captureFp),
        makeReader(captureFp, capture),
      );
      assertEquals(catalog?.components, []);
      assertStringIncludes(catalog?.rationale ?? "", "could not be verified");
    }
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog reopens every current SysML source analysis before projecting",
  async () => {
    const capture = makeCurrentCaptureRecord();
    const captureFp = await sha256Fingerprint(capture);
    let reopenCalls = 0;
    const sourceAnalysis: SysmlSourceAnalysisReader = {
      reopen(value) {
        reopenCalls++;
        return Promise.resolve(
          {
            reference: structuredClone(value),
          } as unknown as VerifiedSysmlSourceAnalysis,
        );
      },
    };
    const catalog = await resolveGenericProductStructureCatalog(
      snapshotWithArchArtifact(captureFp),
      makeReader(captureFp, capture),
      undefined,
      sourceAnalysis,
    );
    assertEquals(reopenCalls, 1);
    assertEquals(catalog?.components.length, 3);
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog makes a current source-analysis read failure unavailable",
  async () => {
    const capture = makeCurrentCaptureRecord();
    const captureFp = await sha256Fingerprint(capture);
    const catalog = await resolveGenericProductStructureCatalog(
      snapshotWithArchArtifact(captureFp),
      makeReader(captureFp, capture),
      undefined,
      { reopen: () => Promise.reject(new Error("CAS source absent")) },
    );
    assertEquals(catalog?.components, []);
    assertStringIncludes(catalog?.rationale ?? "", "could not be verified");
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog returns unavailable when the capture has no system declaration",
  async () => {
    // systemName = "SystemUnit" but declarations only contain "AlphaModule" and
    // "BetaModule" — the system label is absent.
    const captureRecord = makeCaptureRecord({
      systemName: "SystemUnit",
      declarations: [
        { id: "alpha-def-001", label: "AlphaModule" },
        { id: "beta-def-001", label: "BetaModule" },
      ],
    });
    const captureFp = await sha256Fingerprint(captureRecord);
    const snapshot = snapshotWithArchArtifact(captureFp);
    const reader = makeReader(captureFp, captureRecord);

    const catalog = await resolveGenericProductStructureCatalog(
      snapshot,
      reader,
    );

    assertEquals(catalog?.components, []);
    assertStringIncludes(
      catalog?.rationale ?? "",
      "could not be verified",
    );
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog rejects duplicate PartDefinition labels before catalog projection",
  async () => {
    const captureRecord = makeCaptureRecord({
      declarations: [
        {
          id: "sys-def-001",
          label: "SystemUnit",
          usages: [{
            id: "alpha-use-001",
            label: "alpha",
            targetId: "alpha-def-001",
            targetLabel: "AlphaModule",
          }],
        },
        { id: "alpha-def-001", label: "AlphaModule" },
        { id: "alpha-def-002", label: "AlphaModule" },
      ],
    });
    const captureFp = await sha256Fingerprint(captureRecord);
    const snapshot = snapshotWithArchArtifact(captureFp);
    const reader = makeReader(captureFp, captureRecord);

    const catalog = await resolveGenericProductStructureCatalog(
      snapshot,
      reader,
    );

    assertEquals(catalog?.components, []);
    assertStringIncludes(catalog?.rationale ?? "", "could not be verified");
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog rejects ambiguous duplicate PartUsage occurrences",
  async () => {
    const captureRecord = makeCaptureRecord({
      declarations: [
        {
          id: "sys-def-001",
          label: "SystemUnit",
          usages: [{
            id: "alpha-use-001",
            label: "alpha",
            targetId: "alpha-def-001",
            targetLabel: "AlphaModule",
          }, {
            id: "alpha-use-002",
            label: "alpha",
            targetId: "alpha-def-001",
            targetLabel: "AlphaModule",
          }],
        },
        { id: "alpha-def-001", label: "AlphaModule" },
      ],
    });
    const captureFp = await sha256Fingerprint(captureRecord);
    const catalog = await resolveGenericProductStructureCatalog(
      snapshotWithArchArtifact(captureFp),
      makeReader(captureFp, captureRecord),
    );

    assertEquals(catalog?.components, []);
    assertStringIncludes(catalog?.rationale ?? "", "could not be verified");
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog returns undefined when two fresh architecture artifacts are ambiguous",
  async () => {
    // Two artifacts both match the URI prefix — the projector must return
    // undefined rather than guess which one to use.
    const captureRecord = makeCaptureRecord();
    const captureFp = await sha256Fingerprint(captureRecord);
    const baseSnapshot = snapshotWithArchArtifact(captureFp);
    const secondFp = fingerprint("b");

    const snapshot = validateThreadSnapshot({
      ...baseSnapshot,
      artifacts: [
        ...baseSnapshot.artifacts,
        {
          id: `generic-arch-${secondFp.digest}`,
          name: "A second generic architecture artifact",
          kind: "sysml-model",
          version: secondFp.digest,
          fingerprint: secondFp,
          uri: `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${secondFp.digest}`,
          producer: {
            serverId: "syson",
            tool: "syson_element_insert_sysml",
            runId: "run:arch-2",
          },
          inputArtifactIds: [],
          freshness: fresh(),
        },
      ],
    });
    const reader = makeReader(captureFp, captureRecord);

    assertStringIncludes(
      (await resolveGenericProductStructureCatalog(snapshot, reader))?.rationale ?? "",
      "multiple current tips",
    );
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog keeps an archived predecessor historical and reports an archived latest tip unavailable",
  async () => {
    const firstCapture = makeCaptureRecord();
    const firstFp = await sha256Fingerprint(firstCapture);
    const base = snapshotWithArchArtifact(firstFp);
    const firstId = `architecture-${firstFp.digest}`;
    const secondCapture = {
      ...firstCapture,
      trustedRunId: "run:arch-2",
      predecessor: {
        artifactId: firstId,
        fingerprint: firstFp,
        producerRunId: "run:arch",
      },
      insertedAt: "2026-08-08T00:01:00.000Z",
    };
    const secondFp = await sha256Fingerprint(secondCapture);
    const secondId = `architecture-${secondFp.digest}`;
    const snapshot = {
      ...base,
      artifacts: [...base.artifacts, {
        id: secondId,
        name: "Architecture: SystemV1",
        kind: "sysml-model" as const,
        version: secondFp.digest,
        fingerprint: secondFp,
        uri: `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${secondFp.digest}`,
        mediaType: "application/json",
        producer: {
          serverId: "syson" as const,
          tool: "syson_element_insert_sysml",
          runId: "run:arch-2",
        },
        inputArtifactIds: ["seed-artifact", firstId],
        freshness: { ...fresh(), changedAt: "2026-08-08T00:01:00.000Z" },
      }],
      changeSet: {
        ...base.changeSet,
        changes: [...base.changeSet.changes, {
          id: "archive-current-tip",
          kind: "archived" as const,
          target: { kind: "artifact" as const, id: secondId },
          summary: "Explicitly retired current architecture.",
        }],
      },
    };
    const reader: GenericArchitectureCaptureReader = {
      read: (fingerprint) =>
        fingerprint.digest === firstFp.digest
          ? Promise.resolve(deterministicJson(firstCapture))
          : fingerprint.digest === secondFp.digest
          ? Promise.resolve(deterministicJson(secondCapture))
          : Promise.resolve(undefined),
    };

    const catalog = await resolveGenericProductStructureCatalog(snapshot, reader);
    assertEquals(catalog?.components, []);
    assertStringIncludes(catalog?.rationale ?? "", "explicitly archived");
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog returns unavailable for only-system capture (no components)",
  async () => {
    // A capture with a single declaration (just the system) has no components.
    const captureRecord = makeCaptureRecord({
      declarations: [{ id: "sys-def-001", label: "SystemUnit" }],
    });
    const captureFp = await sha256Fingerprint(captureRecord);
    const snapshot = snapshotWithArchArtifact(captureFp);
    const reader = makeReader(captureFp, captureRecord);

    const catalog = await resolveGenericProductStructureCatalog(
      snapshot,
      reader,
    );

    assertEquals(catalog?.components, []);
    assertStringIncludes(catalog?.rationale ?? "", "no component declarations");
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog verifies every capture in a multi-enrichment lineage",
  async () => {
    const rootCapture = makeCaptureRecord();
    const rootFingerprint = await sha256Fingerprint(rootCapture);
    const rootSnapshot = snapshotWithArchArtifact(rootFingerprint);
    const rootArtifact = rootSnapshot.artifacts.find((artifact) =>
      artifact.id === `architecture-${rootFingerprint.digest}`
    )!;
    const second = await appendEnrichment(
      rootSnapshot,
      {
        id: rootArtifact.id,
        fingerprint: rootFingerprint,
        runId: "run:arch",
      },
      "run:arch-2",
      "2026-08-08T00:01:00.000Z",
    );
    const third = await appendEnrichment(
      second.snapshot,
      {
        id: second.artifact.id,
        fingerprint: second.fingerprint,
        runId: "run:arch-2",
      },
      "run:arch-3",
      "2026-08-08T00:02:00.000Z",
    );

    const catalog = await resolveGenericProductStructureCatalog(
      third.snapshot,
      readerFor([
        { fingerprint: rootFingerprint, capture: rootCapture },
        { fingerprint: second.fingerprint, capture: second.capture },
        { fingerprint: third.fingerprint, capture: third.capture },
      ]),
    );

    assertEquals(catalog?.components.length, 3);
    assertEquals(
      catalog?.components[0]?.bindings[0]?.evidenceArtifactId,
      third.artifact.id,
    );
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog rejects an unreadable N-1 predecessor capture",
  async () => {
    const rootCapture = makeCaptureRecord();
    const rootFingerprint = await sha256Fingerprint(rootCapture);
    const rootSnapshot = snapshotWithArchArtifact(rootFingerprint);
    const rootArtifact = rootSnapshot.artifacts.find((artifact) =>
      artifact.id === `architecture-${rootFingerprint.digest}`
    )!;
    const second = await appendEnrichment(
      rootSnapshot,
      { id: rootArtifact.id, fingerprint: rootFingerprint, runId: "run:arch" },
      "run:arch-2",
      "2026-08-08T00:01:00.000Z",
    );
    const third = await appendEnrichment(
      second.snapshot,
      { id: second.artifact.id, fingerprint: second.fingerprint, runId: "run:arch-2" },
      "run:arch-3",
      "2026-08-08T00:02:00.000Z",
    );

    const catalog = await resolveGenericProductStructureCatalog(
      third.snapshot,
      readerFor([
        { fingerprint: rootFingerprint, capture: rootCapture },
        { fingerprint: third.fingerprint, capture: third.capture },
      ]),
    );

    assertEquals(catalog?.components, []);
    assertStringIncludes(catalog?.rationale ?? "", "not readable");
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog rejects a tampered N-1 predecessor capture",
  async () => {
    const rootCapture = makeCaptureRecord();
    const rootFingerprint = await sha256Fingerprint(rootCapture);
    const rootSnapshot = snapshotWithArchArtifact(rootFingerprint);
    const rootArtifact = rootSnapshot.artifacts.find((artifact) =>
      artifact.id === `architecture-${rootFingerprint.digest}`
    )!;
    const second = await appendEnrichment(
      rootSnapshot,
      { id: rootArtifact.id, fingerprint: rootFingerprint, runId: "run:arch" },
      "run:arch-2",
      "2026-08-08T00:01:00.000Z",
    );
    const third = await appendEnrichment(
      second.snapshot,
      { id: second.artifact.id, fingerprint: second.fingerprint, runId: "run:arch-2" },
      "run:arch-3",
      "2026-08-08T00:02:00.000Z",
    );
    const tamperedSecond = { ...second.capture, packageName: "TamperedPackage" };

    const catalog = await resolveGenericProductStructureCatalog(
      third.snapshot,
      readerFor([
        { fingerprint: rootFingerprint, capture: rootCapture },
        { fingerprint: second.fingerprint, capture: tamperedSecond },
        { fingerprint: third.fingerprint, capture: third.capture },
      ]),
    );

    assertEquals(catalog?.components, []);
    assertStringIncludes(catalog?.rationale ?? "", "could not be verified");
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog rejects a disconnected generic cycle even with a valid tip",
  async () => {
    const rootCapture = makeCaptureRecord();
    const rootFingerprint = await sha256Fingerprint(rootCapture);
    const rootSnapshot = snapshotWithArchArtifact(rootFingerprint);
    const cycleA = architectureArtifact(
      fingerprint("a"),
      "run:cycle-a",
      "2026-08-08T00:01:00.000Z",
      ["seed-artifact", `architecture-${fingerprint("b").digest}`],
    );
    const cycleB = architectureArtifact(
      fingerprint("b"),
      "run:cycle-b",
      "2026-08-08T00:02:00.000Z",
      ["seed-artifact", cycleA.id],
    );
    const snapshot: ThreadSnapshot = {
      ...rootSnapshot,
      artifacts: [...rootSnapshot.artifacts, cycleA, cycleB],
    };

    const catalog = await resolveGenericProductStructureCatalog(
      snapshot,
      readerFor([{ fingerprint: rootFingerprint, capture: rootCapture }]),
    );

    assertEquals(catalog?.components, []);
    assertStringIncludes(catalog?.rationale ?? "", "could not be verified");
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog rejects an archived generic orphan instead of falling back",
  async () => {
    const rootCapture = makeCaptureRecord();
    const rootFingerprint = await sha256Fingerprint(rootCapture);
    const rootSnapshot = snapshotWithArchArtifact(rootFingerprint);
    const orphanCapture = {
      ...makeCaptureRecord(),
      trustedRunId: "run:orphan",
      insertedAt: "2026-08-08T00:01:00.000Z",
    };
    const orphanFingerprint = await sha256Fingerprint(orphanCapture);
    const orphan = architectureArtifact(
      orphanFingerprint,
      "run:orphan",
      "2026-08-08T00:01:00.000Z",
      ["seed-artifact"],
    );
    const snapshot: ThreadSnapshot = {
      ...rootSnapshot,
      artifacts: [...rootSnapshot.artifacts, orphan],
      changeSet: {
        ...rootSnapshot.changeSet,
        changes: [...rootSnapshot.changeSet.changes, {
          id: "archive-orphan",
          kind: "archived",
          target: { kind: "artifact", id: orphan.id },
          summary: "The unrelated generic root is historical only.",
        }],
      },
    };

    const catalog = await resolveGenericProductStructureCatalog(
      snapshot,
      readerFor([
        { fingerprint: rootFingerprint, capture: rootCapture },
        { fingerprint: orphanFingerprint, capture: orphanCapture },
      ]),
    );

    assertEquals(catalog?.components, []);
    assertStringIncludes(catalog?.rationale ?? "", "could not be verified");
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog rejects a capture whose predecessor artifact is missing",
  async () => {
    const unusedRoot = makeCaptureRecord();
    const unusedRootFingerprint = await sha256Fingerprint(unusedRoot);
    const base = snapshotWithArchArtifact(unusedRootFingerprint);
    const missingFingerprint = fingerprint("m");
    const missingId = `architecture-${missingFingerprint.digest}`;
    const capture = {
      ...makeCaptureRecord(),
      trustedRunId: "run:broken",
      predecessor: {
        artifactId: missingId,
        fingerprint: missingFingerprint,
        producerRunId: "run:missing",
      },
      insertedAt: "2026-08-08T00:01:00.000Z",
    };
    const captureFingerprint = await sha256Fingerprint(capture);
    const broken = architectureArtifact(
      captureFingerprint,
      "run:broken",
      "2026-08-08T00:01:00.000Z",
      ["seed-artifact", missingId],
    );
    const snapshot: ThreadSnapshot = {
      ...base,
      artifacts: [base.artifacts[0]!, broken],
      consumptions: [
        consumption(
          "seed-artifact",
          fingerprint("1"),
          "run:broken",
          "2026-08-08T00:01:00.000Z",
        ),
        consumption(
          missingId,
          missingFingerprint,
          "run:broken",
          "2026-08-08T00:01:00.000Z",
        ),
      ],
    };

    const catalog = await resolveGenericProductStructureCatalog(
      snapshot,
      readerFor([{ fingerprint: captureFingerprint, capture }]),
    );

    assertEquals(catalog?.components, []);
    assertStringIncludes(catalog?.rationale ?? "", "could not be verified");
  },
);
