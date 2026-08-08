import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { ARCHITECTURE_CAPTURE_URI_PREFIX } from "../captures/file-capture-store.ts";
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
    declarations: { id: string; label: string }[];
  }>,
): Record<string, unknown> {
  return {
    schemaVersion: "architecture-capture/1.0",
    packageName: "SystemV1",
    systemName: overrides?.systemName ?? "SystemUnit",
    packageId: "pkg-001",
    seedFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    declarations: overrides?.declarations ?? [
      { id: "sys-def-001", label: "SystemUnit" },
      { id: "alpha-def-001", label: "AlphaModule" },
      { id: "beta-def-001", label: "BetaModule" },
    ],
    insertedAt: AT,
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
  const archId = `generic-arch-${captureFp.digest}`;
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
      modelArtifactId: archId,
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
      id: archId,
      name: "SystemV1 architecture",
      kind: "sysml-model",
      version: captureFp.digest,
      fingerprint: captureFp,
      uri,
      producer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:arch",
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
      id: "change-to-arch",
      relation: "changes",
      from: { kind: "change", id: "change-r1" },
      to: { kind: "artifact", id: archId },
      rationale: "The architecture fixture change records the initial evidence.",
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

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test(
  "resolveGenericProductStructureCatalog returns undefined when the snapshot has no architecture artifact",
  async () => {
    // Snapshot with a sysml-model artifact whose URI does NOT start with the
    // generic prefix (e.g., it uses a CM-01-specific prefix).
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
        uri: "casys://coffee-machine-cm01-v3-architecture/sha256/" + aFp.digest,
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

    const archId = `generic-arch-${captureFp.digest}`;
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

    // Part components — IDs are kebab-case from labels
    const parts = catalog?.components.filter((c) => c.kind === "part");
    assertEquals(parts?.length, 2);
    const alpha = parts?.find((c) => c.label === "AlphaModule");
    assertEquals(alpha?.id, `${SUBJECT_ID}:alpha-module`);
    assertEquals(alpha?.parentId, `${SUBJECT_ID}:system`);
    assertEquals(alpha?.bindings[0]?.id, "alpha-def-001");

    const beta = parts?.find((c) => c.label === "BetaModule");
    assertEquals(beta?.id, `${SUBJECT_ID}:beta-module`);
    assertEquals(beta?.parentId, `${SUBJECT_ID}:system`);
    assertEquals(beta?.bindings[0]?.id, "beta-def-001");
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
      "no declaration with that label",
    );
  },
);

Deno.test(
  "resolveGenericProductStructureCatalog returns unavailable when declarations have duplicate kebab labels",
  async () => {
    // "AlphaModule" and "Alpha Module" both kebab to "alpha-module".
    const captureRecord = makeCaptureRecord({
      declarations: [
        { id: "sys-def-001", label: "SystemUnit" },
        { id: "alpha-def-001", label: "AlphaModule" },
        { id: "alpha-def-002", label: "Alpha Module" }, // same kebab: "alpha-module"
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
    assertStringIncludes(catalog?.rationale ?? "", "duplicate component labels");
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

    assertEquals(
      await resolveGenericProductStructureCatalog(snapshot, reader),
      undefined,
    );
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
