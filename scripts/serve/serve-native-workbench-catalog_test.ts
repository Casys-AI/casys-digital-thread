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
  { snapshot: ReturnType<typeof validateThreadSnapshot>; captureFp: ContentFingerprint }
> {
  const captureRecord = {
    schemaVersion: "architecture-capture/1.0",
    packageName: "DroneV4",
    systemName: "DroneSystem",
    packageId: "pkg-drone-001",
    seedFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    declarations: [
      { id: "sys-def-001", label: "DroneSystem" },
      { id: "wing-def-001", label: "Wing" },
    ],
    insertedAt: AT,
  };
  const captureFp = await sha256Fingerprint(captureRecord);
  const archId = `generic-arch-${captureFp.digest}`;
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
      modelArtifactId: archId,
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
      inputArtifactIds: [],
      freshness: freshness(),
    }],
    consumptions: [],
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
    }],
    proposedActions: [],
  });

  return { snapshot, captureFp };
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
    const { snapshot, captureFp } = await snapshotWithGenericArch();
    const captureText = deterministicJson({
      schemaVersion: "architecture-capture/1.0",
      packageName: "DroneV4",
      systemName: "DroneSystem",
      packageId: "pkg-drone-001",
      seedFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      declarations: [
        { id: "sys-def-001", label: "DroneSystem" },
        { id: "wing-def-001", label: "Wing" },
      ],
      insertedAt: AT,
    });

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
