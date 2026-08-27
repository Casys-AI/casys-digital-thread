import { assertEquals, assertThrows } from "@std/assert";
import type {
  ThreadProviderBindingProof,
  ThreadSnapshotExtension,
} from "./thread-snapshot-extension.ts";
import {
  bindThreadSnapshotExtension,
  type ThreadSubjectManifest,
  validateThreadSubjectManifest,
} from "./thread-subject-manifest.ts";

Deno.test("subject manifest joins provider identities only through an exact declaration", () => {
  const manifest = subjectManifest();
  const bound = bindThreadSnapshotExtension(
    extensionWithProof("erpnext-item-CASYS-CM01", {
      provider: "erpnext",
      kind: "item",
      id: "CASYS-CM01",
    }),
    manifest,
    { provider: "erpnext", kind: "item", id: "CASYS-CM01" },
  );
  assertEquals(bound.subjectId, "coffee-machine-cm01");
});

Deno.test("subject manifest requires evidence of the declared ERPNext item identity", () => {
  assertThrows(
    () =>
      bindThreadSnapshotExtension(
        emptyExtension("unrelated"),
        subjectManifest(),
        { provider: "erpnext", kind: "item", id: "CASYS-CM01" },
      ),
    Error,
    "does not structurally prove erpnext:item:CASYS-CM01",
  );
});

Deno.test("subject manifest accepts Modelica run and build123d path only from matching artifacts", () => {
  const manifest = subjectManifest();
  const modelica = bindThreadSnapshotExtension(
    extensionWithArtifact("unrelated", {
      serverId: "modelica",
      runId: "run-thermal-1",
    }),
    manifest,
    { provider: "modelica", kind: "run", id: "run-thermal-1" },
  );
  const build = bindThreadSnapshotExtension(
    extensionWithArtifact("unrelated", {
      serverId: "build123d",
      uri: "/exports/coffee-machine.step",
    }),
    manifest,
    {
      provider: "build123d",
      kind: "artifact-path",
      id: "/exports/coffee-machine.step",
    },
  );

  assertEquals(modelica.subjectId, "coffee-machine-cm01");
  assertEquals(build.subjectId, "coffee-machine-cm01");
});

Deno.test("subject manifest rejects a provider artifact that does not prove the requested binding", () => {
  assertThrows(
    () =>
      bindThreadSnapshotExtension(
        extensionWithArtifact("unrelated", {
          serverId: "build123d",
          uri: "/exports/another.step",
        }),
        subjectManifest(),
        {
          provider: "build123d",
          kind: "artifact-path",
          id: "/exports/coffee-machine.step",
        },
      ),
    Error,
    "does not structurally prove build123d:artifact-path:/exports/coffee-machine.step",
  );
});

Deno.test("matching product names never substitute for an explicit subject binding", () => {
  assertThrows(
    () =>
      bindThreadSnapshotExtension(
        emptyExtension("Coffee Machine CM-01"),
        subjectManifest(),
        { provider: "erpnext", kind: "item", id: "COFFEE-MACHINE" },
      ),
    Error,
    "No declared subject binding",
  );
});

Deno.test("subject manifest rejects duplicate provider identities", () => {
  const manifest = subjectManifest();
  manifest.bindings.push(structuredClone(manifest.bindings[0]));
  assertThrows(
    () => validateThreadSubjectManifest(manifest),
    Error,
    "duplicate provider identities",
  );
});

function subjectManifest(): ThreadSubjectManifest {
  return {
    schemaVersion: "1.0",
    authority: "workspace-declared",
    rationale: "The workspace explicitly maps the provider identities.",
    subject: {
      id: "coffee-machine-cm01",
      name: "CoffeeMachine CM-01",
      kind: "system",
    },
    bindings: [
      { provider: "erpnext", kind: "item", id: "CASYS-CM01" },
      { provider: "modelica", kind: "run", id: "run-thermal-1" },
      {
        provider: "build123d",
        kind: "artifact-path",
        id: "/exports/coffee-machine.step",
      },
    ],
  };
}

function extensionWithProof(
  subjectId: string,
  proof: ThreadProviderBindingProof,
): ThreadSnapshotExtension {
  return { ...emptyExtension(subjectId), bindingProofs: [proof] };
}

function extensionWithArtifact(
  subjectId: string,
  source: { serverId: string; runId?: string; uri?: string },
): ThreadSnapshotExtension {
  const extension = emptyExtension(subjectId);
  extension.artifacts.push({
    id: `artifact-${source.serverId}`,
    name: "Provider artifact",
    kind: "evidence",
    version: "1",
    fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    ...(source.uri ? { uri: source.uri } : {}),
    producer: {
      serverId: source.serverId,
      tool: "read",
      runId: source.runId ?? "observed",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: "2026-08-01T04:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  });
  return extension;
}

function emptyExtension(subjectId: string): ThreadSnapshotExtension {
  return {
    id: "erp-capture",
    name: "ERP capture",
    subjectId,
    capturedAt: "2026-08-01T04:00:00.000Z",
    artifacts: [],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
}
