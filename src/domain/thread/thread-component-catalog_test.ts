import { assertEquals, assertThrows } from "@std/assert";
import type { ThreadSnapshot } from "./thread-snapshot.ts";
import {
  resolveThreadComponentCatalog,
  validateThreadComponentCatalog,
} from "./thread-component-catalog.ts";

const AT = "2026-08-01T08:00:00.000Z";

function sampleThreadSnapshot(): ThreadSnapshot {
  return {
    schemaVersion: "1.0",
    id: "thread-snapshot-component-test",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: "subject",
      name: "Subject",
      kind: "system",
      version: "1",
      modelArtifactId: "artifact",
    },
    freshness: {
      status: "fresh",
      changedAt: AT,
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "change-set",
      name: "Initial component evidence",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change",
        kind: "created",
        target: { kind: "artifact", id: "artifact" },
        summary: "Created the component evidence artifact.",
        afterFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      }],
    },
    artifacts: [{
      id: "artifact",
      name: "Support bracket STEP",
      kind: "step",
      version: "1",
      fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      uri: "/exports/support.step",
      producer: {
        serverId: "build123d",
        tool: "build123d_export",
        runId: "build-run",
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: AT,
        invalidatedByChangeIds: [],
      },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "change-artifact",
      relation: "changes",
      from: { kind: "change", id: "change" },
      to: { kind: "artifact", id: "artifact" },
      rationale: "The change created this exact artifact.",
    }],
    proposedActions: [],
  };
}

Deno.test("component catalog resolves only evidence-backed provider identities", () => {
  const snapshot = sampleThreadSnapshot();
  const artifact = snapshot.artifacts[0];
  const catalog = validateThreadComponentCatalog({
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId: snapshot.subject.id,
    rationale: "Reviewed exact identities.",
    systemViews: {},
    components: [{
      id: "support",
      label: "Support",
      kind: "part",
      quantity: 1,
      bindings: [{
        provider: artifact.producer.serverId,
        kind: "artifact",
        id: artifact.uri ?? artifact.id,
        label: artifact.name,
        evidenceArtifactId: artifact.id,
      }],
    }],
  });
  const resolved = resolveThreadComponentCatalog(snapshot, catalog);
  assertEquals(resolved.components[0].bindings[0].status, "verified");
});

Deno.test("component catalog keeps absent evidence visibly unverified", () => {
  const snapshot = sampleThreadSnapshot();
  const catalog = validateThreadComponentCatalog({
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId: snapshot.subject.id,
    rationale: "Reviewed exact identities.",
    systemViews: {},
    components: [{
      id: "support",
      label: "Support",
      kind: "part",
      quantity: 1,
      bindings: [{
        provider: "erpnext",
        kind: "item",
        id: "ITEM-001",
        label: "Support",
        evidenceArtifactId: "missing-artifact",
      }],
    }],
  });
  const resolved = resolveThreadComponentCatalog(snapshot, catalog);
  assertEquals(resolved.components[0].bindings[0].status, "unverified");
});

Deno.test("component catalog accepts an exact GLB presentation beside authoritative CAD", () => {
  const snapshot = sampleThreadSnapshot();
  const catalog = validateThreadComponentCatalog({
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId: snapshot.subject.id,
    rationale: "Reviewed exact STEP identity and GLB presentation bytes.",
    systemViews: {},
    components: [{
      id: "support",
      label: "Support",
      kind: "part",
      quantity: 1,
      bindings: [{
        provider: "build123d",
        kind: "artifact",
        id: "artifact",
        label: "Authoritative support STEP",
        evidenceArtifactId: "artifact",
      }],
      preview: {
        provider: "build123d",
        artifactId: "support-glb",
        mediaType: "model/gltf-binary",
        url: `/api/thread/assets/${"b".repeat(64)}.glb`,
        sha256: "b".repeat(64),
      },
    }],
  });

  assertEquals(catalog.components[0]?.preview, {
    provider: "build123d",
    artifactId: "support-glb",
    mediaType: "model/gltf-binary",
    url: `/api/thread/assets/${"b".repeat(64)}.glb`,
    sha256: "b".repeat(64),
  });
});

Deno.test("component catalog keeps optional AttributeUsage rows without a new binding kind", () => {
  const catalog = validateThreadComponentCatalog({
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId: "subject",
    rationale: "Reviewed exact identities.",
    systemViews: {},
    components: [{
      id: "arm",
      label: "CantileverArm",
      kind: "assembly",
      quantity: 1,
      bindings: [{
        provider: "syson",
        kind: "part-definition",
        id: "part-def-arm",
        label: "CantileverArm",
        evidenceArtifactId: "architecture-1",
      }],
      attributes: [{
        id: "attr-thickness",
        kind: "AttributeUsage",
        label: "thickness",
      }],
    }],
  });

  assertEquals(catalog.components[0]?.attributes, [{
    id: "attr-thickness",
    kind: "AttributeUsage",
    label: "thickness",
  }]);
});

Deno.test("component catalog without attributes remains thread-components/1.0", () => {
  const catalog = validateThreadComponentCatalog({
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId: "subject",
    rationale: "Reviewed exact identities.",
    systemViews: {},
    components: [{
      id: "arm",
      label: "CantileverArm",
      kind: "assembly",
      quantity: 1,
      bindings: [],
    }],
  });

  assertEquals(catalog.components[0]?.attributes, undefined);
});

Deno.test("component catalog rejects an AttributeUsage row that is not exact", () => {
  assertThrows(
    () =>
      validateThreadComponentCatalog({
        schemaVersion: "thread-components/1.0",
        authority: "workspace-declared",
        subjectId: "subject",
        rationale: "Reviewed exact identities.",
        systemViews: {},
        components: [{
          id: "arm",
          label: "CantileverArm",
          kind: "assembly",
          quantity: 1,
          bindings: [],
          attributes: [{
            id: "attr-thickness",
            kind: "PartUsage",
            label: "thickness",
          }],
        }],
      }),
    Error,
    "AttributeUsage",
  );
});

Deno.test("component catalog rejects ambiguous and cyclic identities", () => {
  assertThrows(
    () =>
      validateThreadComponentCatalog({
        schemaVersion: "thread-components/1.0",
        authority: "workspace-declared",
        subjectId: "subject",
        rationale: "Reviewed exact identities.",
        systemViews: {},
        components: [
          {
            id: "a",
            label: "A",
            kind: "part",
            quantity: 1,
            parentId: "b",
            bindings: [],
          },
          {
            id: "b",
            label: "B",
            kind: "part",
            quantity: 1,
            parentId: "a",
            bindings: [],
          },
        ],
      }),
    Error,
    "parent cycle",
  );
});
