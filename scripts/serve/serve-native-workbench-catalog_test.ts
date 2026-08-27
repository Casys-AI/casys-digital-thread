/**
 * Tests for `resolveSnapshotComponentCatalog` — the generic architecture
 * projector (URI-prefix gated) inside serve-native-workbench.
 *
 * Invariants proved:
 *  - A subject whose snapshot carries a generic architecture artifact
 *    (URI prefix "casys://architecture-capture/") receives its component catalog
 *    from the generic projector.
 *  - A snapshot with no matching architecture artifact returns `undefined`;
 *    the caller must fall through to the static catalog.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../src/domain/kernel/deterministic-json.ts";
import { validateThreadSnapshot } from "../../src/domain/thread/thread-snapshot-validation.ts";
import {
  ARCHITECTURE_CAPTURE_URI_PREFIX,
  GEOMETRY_CAPTURE_URI_PREFIX,
} from "../../src/adapters/shared/cas/file-capture-store.ts";
import type { ContentFingerprint } from "../../src/domain/thread/thread-snapshot.ts";
import type {
  SysmlSourceAnalysisReader,
  VerifiedSysmlSourceAnalysis,
} from "../../src/adapters/architecture/renderer/sysml-source-analysis-capture.ts";
import { resolveSnapshotComponentCatalog } from "./serve-native-workbench.ts";

// ── Shared constants ─────────────────────────────────────────────────────────

const AT = "2026-08-08T12:00:00.000Z";
const GENERIC_SUBJECT_ID = "project:inspection-drone-v4";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fingerprint(char: string): ContentFingerprint {
  return { algorithm: "sha256", digest: char.repeat(64) };
}

function freshness() {
  return {
    status: "fresh" as const,
    changedAt: AT,
    invalidatedByChangeIds: [],
  };
}

function passingSourceAnalysis(): SysmlSourceAnalysisReader {
  return {
    reopen(value) {
      return Promise.resolve(
        {
          reference: structuredClone(value),
        } as unknown as VerifiedSysmlSourceAnalysis,
      );
    },
  };
}

/** Minimal snapshot carrying a generic architecture artifact. */
async function snapshotWithGenericArch(): Promise<
  {
    snapshot: ReturnType<typeof validateThreadSnapshot>;
    captureFp: ContentFingerprint;
    captureRecord: Record<string, unknown>;
  }
> {
  const captureRecord = {
    schemaVersion: "architecture-capture/4.0",
    operation: { id: "model.write-architecture", version: "1" },
    trustedRunId: "run:arch",
    packageName: "DroneV4",
    systemName: "DroneSystem",
    scopeRoot: { id: "pkg-drone-001", kind: "Package", label: "DroneV4" },
    semanticRoot: {
      id: "sys-def-001",
      kind: "PartDefinition",
      label: "DroneSystem",
    },
    seed: {
      artifactId: "seed-artifact",
      fingerprint: fingerprint("a"),
      producerRunId: "run:seed",
    },
    partDefinitions: [
      {
        id: "sys-def-001",
        kind: "PartDefinition",
        label: "DroneSystem",
        usages: [{
          id: "wing-use-001",
          kind: "PartUsage",
          label: "wing",
          targetId: "wing-def-001",
          targetKind: "PartDefinition",
          targetLabel: "Wing",
        }],
      },
      { id: "wing-def-001", kind: "PartDefinition", label: "Wing", usages: [] },
    ],
    insertedAt: AT,
    sourceAnalyses: [{
      sourceId: "sysml-source:drone-v4",
      selector: { kind: "full-package", packageName: "DroneV4" },
      runId: "run:arch",
      operation: { id: "model.write-architecture", version: "1" },
      sourceFingerprint: fingerprint("c"),
      sourceCaptureFingerprint: fingerprint("d"),
      analysisFingerprint: fingerprint("e"),
    }],
  };
  const captureFp = await sha256Fingerprint(captureRecord);
  const archId = `architecture-${captureFp.digest}`;
  const uri = `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${captureFp.digest}`;

  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: `${GENERIC_SUBJECT_ID}:r1`,
    revision: 1,
    generatedAt: AT,
    subject: {
      id: GENERIC_SUBJECT_ID,
      name: "Inspection Drone V4",
      kind: "system",
      version: captureFp.digest,
      modelArtifactId: "seed-artifact",
    },
    freshness: freshness(),
    changeSet: {
      id: "cs-r1",
      name: "architecture",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change-r1",
        kind: "created",
        target: { kind: "artifact", id: archId },
        summary: "Recorded drone architecture.",
        afterFingerprint: captureFp,
      }],
    },
    artifacts: [{
      id: "seed-artifact",
      name: "Seed",
      kind: "sysml-model",
      version: "a".repeat(64),
      fingerprint: fingerprint("a"),
      uri: "casys://syson-model-seed-capture/sha256/" + "a".repeat(64),
      mediaType: "application/json",
      producer: {
        serverId: "syson",
        tool: "syson_model_create",
        runId: "run:seed",
      },
      inputArtifactIds: [],
      freshness: freshness(),
    }, {
      id: archId,
      name: "Architecture: DroneV4",
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
      freshness: freshness(),
    }],
    consumptions: [{
      id: "consume-seed",
      artifactId: "seed-artifact",
      consumer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:arch",
      },
      observedFingerprint: fingerprint("a"),
      verifiedAt: AT,
      status: "verified",
    }],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "prov-arch",
      relation: "changes",
      from: { kind: "change", id: "change-r1" },
      to: { kind: "artifact", id: archId },
      rationale: "Change records the architecture artifact.",
    }, {
      id: "uses-seed",
      relation: "uses",
      from: { kind: "consumption", id: "consume-seed" },
      to: { kind: "artifact", id: "seed-artifact" },
      rationale: "Architecture uses exact seed.",
    }, {
      id: "derived-seed",
      relation: "derived_from",
      from: { kind: "artifact", id: archId },
      to: { kind: "artifact", id: "seed-artifact" },
      rationale: "Architecture derives from exact seed.",
    }],
    proposedActions: [],
  });

  return { snapshot, captureFp, captureRecord };
}

/** Minimal snapshot with no architecture artifact (seed-only). */
function snapshotWithoutArch(): ReturnType<typeof validateThreadSnapshot> {
  const seedFp = fingerprint("b");
  const seedId = "syson-model-seed-bbb";
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: `${GENERIC_SUBJECT_ID}:r1`,
    revision: 1,
    generatedAt: AT,
    subject: {
      id: GENERIC_SUBJECT_ID,
      name: "Inspection Drone V4",
      kind: "system",
      version: seedFp.digest,
      modelArtifactId: seedId,
    },
    freshness: freshness(),
    changeSet: {
      id: "cs-r1",
      name: "seed",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change-seed",
        kind: "created",
        target: { kind: "artifact", id: seedId },
        summary: "Created SysON model container.",
        afterFingerprint: seedFp,
      }],
    },
    artifacts: [{
      id: seedId,
      name: "DroneV4 SysON container",
      kind: "sysml-model",
      // URI does NOT match ARCHITECTURE_CAPTURE_URI_PREFIX
      uri: "casys://syson-model-seed/sha256/" + seedFp.digest,
      version: seedFp.digest,
      fingerprint: seedFp,
      producer: {
        serverId: "syson",
        tool: "syson_project_create",
        runId: "run:seed",
      },
      inputArtifactIds: [],
      freshness: freshness(),
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "prov-seed",
      relation: "changes",
      from: { kind: "change", id: "change-seed" },
      to: { kind: "artifact", id: seedId },
      rationale: "Change records the seed artifact.",
    }],
    proposedActions: [],
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test(
  "resolveSnapshotComponentCatalog returns a generic catalog for an architecture artifact",
  async () => {
    const { snapshot, captureFp, captureRecord } = await snapshotWithGenericArch();
    const captureText = deterministicJson(captureRecord);

    // Generic reader returns the capture text for this exact fingerprint.
    const archCaptures = {
      read: (fp: ContentFingerprint) =>
        fp.digest === captureFp.digest
          ? Promise.resolve(captureText)
          : Promise.resolve(undefined as string | undefined),
    };

    const catalog = await resolveSnapshotComponentCatalog(
      snapshot,
      archCaptures,
      undefined,
      passingSourceAnalysis(),
    );

    assertExists(catalog, "catalog must be resolved for a generic subject");
    assertEquals(catalog.subjectId, GENERIC_SUBJECT_ID);
    assertEquals(catalog.components.length, 2, "assembly + one part");

    const assembly = catalog.components.find((c) => c.kind === "assembly");
    assertExists(assembly, "assembly component must be present");
    assertEquals(assembly.label, "DroneSystem");

    const part = catalog.components.find((c) => c.kind === "part");
    assertExists(part, "part component must be present");
    assertEquals(part.label, "Wing");
  },
);

Deno.test(
  "resolveSnapshotComponentCatalog returns undefined for a snapshot with no architecture artifact",
  async () => {
    const snapshot = snapshotWithoutArch();

    // The generic reader never matches — no architecture artifact in the snapshot.
    const neverRead = {
      read: (_fp: ContentFingerprint) =>
        Promise.resolve(undefined as string | undefined),
    };

    const catalog = await resolveSnapshotComponentCatalog(
      snapshot,
      neverRead,
    );

    assertEquals(
      catalog,
      undefined,
      "no architecture artifact → generic projector returns undefined",
    );
  },
);

Deno.test(
  "resolveSnapshotComponentCatalog forwards the canonical geometry reader to the generic Product projector",
  async () => {
    const { snapshot, captureFp, captureRecord } = await snapshotWithGenericArch();
    const withGeometry = mutableClone(snapshot);
    const geometryFp = fingerprint("c");
    withGeometry.artifacts.push({
      id: `geometry-${geometryFp.digest}`,
      name: "Geometry: wing",
      kind: "cad-model",
      version: geometryFp.digest,
      fingerprint: geometryFp,
      uri: `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${geometryFp.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "design.write-geometry@1",
        runId: "run:geometry",
      },
      inputArtifactIds: [`architecture-${captureFp.digest}`],
      freshness: freshness(),
    });
    let geometryReads = 0;
    const catalog = await resolveSnapshotComponentCatalog(
      withGeometry,
      {
        read: (fp: ContentFingerprint) =>
          fp.digest === captureFp.digest
            ? Promise.resolve(deterministicJson(captureRecord))
            : Promise.resolve(undefined),
      },
      {
        read: (_fp: ContentFingerprint) => {
          geometryReads += 1;
          return Promise.resolve(undefined);
        },
      },
      passingSourceAnalysis(),
    );

    assertExists(catalog);
    assertEquals(geometryReads, 1);
    assertEquals(catalog.components.length, 2);
    assertStringIncludes(catalog.rationale, "not durably readable");
  },
);

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;

function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}
