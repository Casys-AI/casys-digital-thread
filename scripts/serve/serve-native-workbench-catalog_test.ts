/**
 * Tests for `resolveSnapshotComponentCatalog` — the couture that chains the
 * CM-01 projector (subject-ID gated) with the generic architecture projector
 * (URI-prefix gated) inside serve-native-workbench.
 *
 * Invariants proved:
 *  - A non-CM01 subject whose snapshot carries a generic architecture artifact
 *    (URI prefix "casys://architecture-capture/") receives its component catalog
 *    from the generic projector.
 *  - A snapshot with no matching architecture artifact returns `undefined` from
 *    both projectors; the caller must fall through to the static catalog.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../src/domain/kernel/deterministic-json.ts";
import { validateThreadSnapshot } from "../../src/domain/thread/thread-snapshot-validation.ts";
import { ARCHITECTURE_CAPTURE_URI_PREFIX } from "../../src/adapters/captures/file-capture-store.ts";
import type { ContentFingerprint } from "../../src/domain/thread/thread-snapshot.ts";
import { resolveSnapshotComponentCatalog } from "./serve-native-workbench.ts";

// ── Shared constants ─────────────────────────────────────────────────────────

const AT = "2026-08-08T12:00:00.000Z";
const GENERIC_SUBJECT_ID = "project:inspection-drone-v4";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fingerprint(char: string): ContentFingerprint {
  return { algorithm: "sha256", digest: char.repeat(64) };
}

function freshness() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
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
    schemaVersion: "architecture-capture/2.0",
    operation: { id: "model.write-architecture", version: "1" },
    trustedRunId: "run:arch",
    packageName: "DroneV4",
    systemName: "DroneSystem",
    package: { id: "pkg-drone-001", label: "DroneV4" },
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
      producer: { serverId: "syson", tool: "syson_model_create", runId: "run:seed" },
      inputArtifactIds: [],
      freshness: freshness(),
    }, {
      id: archId,
      name: "DroneV4 architecture",
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
  "resolveSnapshotComponentCatalog returns a generic catalog for a non-CM01 subject with architecture artifact",
  async () => {
    const { snapshot, captureFp, captureRecord } = await snapshotWithGenericArch();
    const captureText = deterministicJson(captureRecord);

    // CM-01 readers are never called for a non-CM01 subject.
    const neverRead = {
      read: (_fp: ContentFingerprint) =>
        Promise.resolve(undefined as string | undefined),
    };
    const cm01Captures = {
      architecture: neverRead,
      partDefinitions: neverRead,
    };
    // Generic reader returns the capture text for this exact fingerprint.
    const archCaptures = {
      read: (fp: ContentFingerprint) =>
        fp.digest === captureFp.digest
          ? Promise.resolve(captureText)
          : Promise.resolve(undefined as string | undefined),
    };

    const catalog = await resolveSnapshotComponentCatalog(
      snapshot,
      cm01Captures,
      archCaptures,
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

    // Both readers never match — no architecture artifact in the snapshot.
    const neverRead = {
      read: (_fp: ContentFingerprint) =>
        Promise.resolve(undefined as string | undefined),
    };

    const catalog = await resolveSnapshotComponentCatalog(
      snapshot,
      { architecture: neverRead, partDefinitions: neverRead },
      neverRead,
    );

    assertEquals(
      catalog,
      undefined,
      "no architecture artifact → both projectors return undefined",
    );
  },
);
