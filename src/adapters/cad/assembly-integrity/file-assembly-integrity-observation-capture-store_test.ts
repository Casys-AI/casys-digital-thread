import { assertEquals, assertRejects } from "@std/assert";
import {
  FileAssemblyIntegrityObservationCaptureStore,
} from "./file-assembly-integrity-observation-capture-store.ts";
import {
  assemblyIntegrityObservationCaptureUri,
  createAssemblyIntegrityObservationCapture,
  validateAssemblyIntegrityObservationCapture,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-observation-capture.ts";
import {
  ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-input-bundle.ts";
import {
  VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const E = "e".repeat(64);

Deno.test("assembly-integrity observation captures bind facts, provenance, and literal L3 limits", async () => {
  const capture = await validCapture();
  assertEquals(
    capture.observationFingerprint,
    await sha256Fingerprint(capture.observation),
  );
  assertEquals(
    assemblyIntegrityObservationCaptureUri(A),
    `casys://assembly-integrity-observation-capture/sha256/${A}`,
  );
  assertEquals(capture.limits, {
    verdict: "none",
    fitness: "none",
    safety: "none",
    motion: "none",
    strength: "none",
  });

  await assertRejects(
    () =>
      validateAssemblyIntegrityObservationCapture({
        ...capture,
        observationFingerprint: fp(A),
      }),
    TypeError,
    "does not bind the normalized observation",
  );
  await assertRejects(
    () =>
      validateAssemblyIntegrityObservationCapture({
        ...capture,
        basis: { ...capture.basis, kind: "project-tip" },
      }),
    TypeError,
    "basis.kind",
  );
  await assertRejects(
    () =>
      validateAssemblyIntegrityObservationCapture({
        ...capture,
        assemblyStep: {
          ...capture.assemblyStep,
          artifactId: "cad-asset-unbound-step",
        },
      }),
    TypeError,
    "must bind the exact geometry-module and STEP fingerprints",
  );
  await assertRejects(
    () =>
      validateAssemblyIntegrityObservationCapture({
        ...capture,
        verdict: "pass",
      }),
    TypeError,
  );
});

Deno.test("assembly-integrity observation capture store rereads canonical bytes and rejects tampering", async () => {
  const directory = await Deno.makeTempDir({ prefix: "assembly-integrity-capture-" });
  try {
    const raw = new FileCaptureStore({
      kind: "assembly-integrity-observation" as const,
      directory,
      uriNamespace: "assembly-integrity-observation-capture",
      label: "Test assembly-integrity observation",
    });
    const store = new FileAssemblyIntegrityObservationCaptureStore(raw);
    const capture = await validCapture();
    const persisted = await store.save(capture);
    assertEquals(persisted.capture, capture);
    assertEquals(
      persisted.uri,
      `casys://assembly-integrity-observation-capture/sha256/${persisted.fingerprint.digest}`,
    );
    assertEquals(await store.read(persisted.fingerprint), capture);

    await Deno.writeTextFile(raw.pathFor(persisted.fingerprint), "{}");
    await assertRejects(() => store.read(persisted.fingerprint), Error);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function validCapture() {
  const observation = {
    schemaVersion: "assembly-integrity-observation/1.0" as const,
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    inputBundle: {
      schemaVersion: ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
      fingerprint: fp(A),
      byteCount: 1,
    },
    method: {
      id: "assembly-integrity-factual-v1",
      version: "1.0.0",
      linearToleranceMm: 0.000001,
    },
    importability: { status: "observed" as const, value: "imported" as const },
    importFacts: {
      unitSystem: { status: "observed" as const, value: "mm" as const },
      solidCount: { status: "observed" as const, value: 0 },
    },
    topology: {
      brepValidity: { status: "observed" as const, value: "valid" as const },
      degenerateEdgeCount: { status: "observed" as const, value: 0 },
      freeEdgeCount: { status: "observed" as const, value: 0 },
      shellCount: { status: "observed" as const, value: 0 },
    },
    occurrences: [],
    pairs: [],
  };
  return await createAssemblyIntegrityObservationCapture({
    schemaVersion: "assembly-integrity-observation-capture/1.0",
    kind: "assembly-integrity-observation",
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    trustedRunId: "run-assembly-integrity",
    observedAt: "2026-08-26T10:00:00.000Z",
    basis: {
      kind: "thread-snapshot",
      snapshotId: "thread-assembly",
      revision: 1,
      subjectId: "subject-assembly",
    },
    geometryModule: {
      schemaVersion: "geometry-module-capture/1.0",
      artifactId: `geometry-${A}`,
      fingerprint: fp(A),
    },
    assemblyStep: {
      artifactId: `cad-asset-${A}-module-step-${B}`,
      fingerprint: fp(B),
    },
    inputBundle: observation.inputBundle,
    profile: {
      id: "assembly-integrity-observer",
      version: "1.0.0",
      fingerprint: fp(C),
      configuredRuntime: { kind: "image-digest", imageDigest: fp(D) },
    },
    execution: {
      profile: {
        id: "assembly-integrity-observer",
        version: "1.0.0",
        fingerprint: fp(C),
      },
      configuredRuntime: { kind: "image-digest", imageDigest: fp(D) },
      raw: {
        schemaVersion: "factual-observation/1.0",
        producer: {
          service: "provider-service",
          packageVersion: "1.0.0",
          tool: "observe-facts",
          engine: { id: "provider-engine", version: "1.0.0" },
        },
        requestFingerprint: fp(E),
        responseFingerprint: fp(B),
      },
    },
    observation,
    limits: {
      verdict: "none",
      fitness: "none",
      safety: "none",
      motion: "none",
      strength: "none",
    },
  });
}

function fp(digest: string) {
  return { algorithm: "sha256" as const, digest };
}
