import { assertEquals } from "@std/assert";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { ThreadArtifact, ThreadSnapshot } from "../../thread/thread-snapshot.ts";
import { buildArchitectureThreadExtension } from "./architecture-thread-extension.ts";

const CAPTURED_AT = "2026-08-08T12:15:00.000Z";
const DIGEST = "ab".repeat(32);
const SEED_DIGEST = "cd".repeat(32);
const PREV_DIGEST = "ef".repeat(32);

function fingerprint(digest: string) {
  return { algorithm: "sha256" as const, digest };
}

function seedArtifact(): ThreadArtifact {
  return {
    id: `syson-model-seed-${SEED_DIGEST}`,
    name: "SysON model seed",
    kind: "sysml-model",
    version: SEED_DIGEST,
    fingerprint: fingerprint(SEED_DIGEST),
    uri: `casys://syson-model-seed-capture/sha256/${SEED_DIGEST}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_model_create",
      runId: "run:seed",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: CAPTURED_AT,
      invalidatedByChangeIds: [],
    },
  };
}

function predecessorArtifact(): ThreadArtifact {
  return {
    id: `architecture-${PREV_DIGEST}`,
    name: "Architecture: DemoPackage",
    kind: "sysml-model",
    version: PREV_DIGEST,
    fingerprint: fingerprint(PREV_DIGEST),
    uri: `casys://architecture-capture/sha256/${PREV_DIGEST}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: "run:predecessor",
    },
    inputArtifactIds: [seedArtifact().id],
    freshness: {
      status: "fresh",
      changedAt: CAPTURED_AT,
      invalidatedByChangeIds: [],
    },
  };
}

function baseSnapshot(): ThreadSnapshot {
  return {
    schemaVersion: "1.0",
    id: "snapshot:base",
    revision: 2,
    generatedAt: CAPTURED_AT,
    subject: {
      id: "project:demo",
      name: "Demo",
      kind: "system",
      version: "1",
      modelArtifactId: seedArtifact().id,
    },
    freshness: {
      status: "fresh",
      changedAt: CAPTURED_AT,
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "change:base",
      name: "base",
      status: "applied",
      createdAt: CAPTURED_AT,
      changes: [],
    },
    artifacts: [seedArtifact()],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
}

const proposal = {
  packageName: "DemoPackage",
  system: { name: "DemoSystem" },
  components: [],
};

const verified = {
  packageId: "pkg-demo",
  packageLabel: "DemoPackage",
  partDefs: [{
    id: "def-system",
    kind: "PartDefinition",
    label: "DemoSystem",
    usages: [],
  }],
};

const INITIAL_GOLDEN = {
  id: `model-write-architecture-${DIGEST}`,
  name: "Generic architecture: DemoPackage",
  subjectId: "project:demo",
  capturedAt: CAPTURED_AT,
  artifacts: [{
    id: `architecture-${DIGEST}`,
    name: "Architecture: DemoPackage",
    kind: "sysml-model",
    version: DIGEST,
    fingerprint: fingerprint(DIGEST),
    uri: `casys://architecture-capture/sha256/${DIGEST}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: "run:architecture",
    },
    inputArtifactIds: [`syson-model-seed-${SEED_DIGEST}`],
    freshness: {
      status: "fresh",
      changedAt: CAPTURED_AT,
      invalidatedByChangeIds: [],
    },
  }],
  consumptions: [{
    id: `consume-syson-model-seed-${SEED_DIGEST}-by-architecture-${DIGEST}`,
    artifactId: `syson-model-seed-${SEED_DIGEST}`,
    consumer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: "run:architecture",
    },
    observedFingerprint: fingerprint(SEED_DIGEST),
    verifiedAt: CAPTURED_AT,
    status: "verified",
  }],
  observations: [],
  requirements: [],
  evaluations: [],
  violations: [],
  provenance: [{
    id: `derived-from-seed-${DIGEST}`,
    relation: "derived_from",
    from: { kind: "artifact", id: `architecture-${DIGEST}` },
    to: { kind: "artifact", id: `syson-model-seed-${SEED_DIGEST}` },
    rationale:
      "The architecture package was inserted into the SysON model container created by the seed run.",
  }, {
    id: `uses-consume-syson-model-seed-${SEED_DIGEST}-by-architecture-${DIGEST}`,
    relation: "uses",
    from: {
      kind: "consumption",
      id: `consume-syson-model-seed-${SEED_DIGEST}-by-architecture-${DIGEST}`,
    },
    to: { kind: "artifact", id: `syson-model-seed-${SEED_DIGEST}` },
    rationale:
      "The executor re-read the exact seed capture before inserting the architecture package.",
  }],
  proposedActions: [],
  bindingProofs: [{
    provider: "syson",
    kind: "package",
    id: "pkg-demo",
  }],
};

Deno.test("architecture Thread extension golden is bit-stable for an initial write", () => {
  const extension = buildArchitectureThreadExtension({
    base: baseSnapshot(),
    seedArtifact: seedArtifact(),
    previousArchitectureArtifact: undefined,
    seedVerifiedFingerprint: fingerprint(SEED_DIGEST),
    runId: "run:architecture",
    capturedAt: CAPTURED_AT,
    captureFp: fingerprint(DIGEST),
    captureUri: `casys://architecture-capture/sha256/${DIGEST}`,
    architectureProposal: proposal,
    verified,
  });
  assertEquals(extension.provenance.map((link) => link.id), [
    `derived-from-seed-${DIGEST}`,
    `uses-consume-syson-model-seed-${SEED_DIGEST}-by-architecture-${DIGEST}`,
  ]);
  assertEquals(deterministicJson(extension), deterministicJson(INITIAL_GOLDEN));
});

Deno.test("architecture Thread extension golden preserves enrichment predecessor order", () => {
  const previous = predecessorArtifact();
  const extension = buildArchitectureThreadExtension({
    base: baseSnapshot(),
    seedArtifact: seedArtifact(),
    previousArchitectureArtifact: previous,
    seedVerifiedFingerprint: fingerprint(SEED_DIGEST),
    runId: "run:architecture",
    capturedAt: CAPTURED_AT,
    captureFp: fingerprint(DIGEST),
    captureUri: `casys://architecture-capture/sha256/${DIGEST}`,
    architectureProposal: proposal,
    verified,
  });
  assertEquals(extension.artifacts[0]?.inputArtifactIds, [
    seedArtifact().id,
    previous.id,
  ]);
  assertEquals(extension.consumptions.map((consumption) => consumption.id), [
    `consume-${seedArtifact().id}-by-architecture-${DIGEST}`,
    `consume-${previous.id}-by-architecture-${DIGEST}`,
  ]);
  assertEquals(extension.provenance.map((link) => link.id), [
    `derived-from-seed-${DIGEST}`,
    `derived-from-architecture-${DIGEST}`,
    `uses-consume-${previous.id}-by-architecture-${DIGEST}`,
    `uses-consume-${seedArtifact().id}-by-architecture-${DIGEST}`,
  ]);
});
