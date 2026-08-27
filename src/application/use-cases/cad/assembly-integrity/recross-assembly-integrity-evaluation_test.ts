import { assertEquals } from "@std/assert";
import {
  recrossExactL3ObservationCaptureBinding,
  reopenExactL3AssemblyIntegrityInput,
} from "./recross-assembly-integrity-evaluation.ts";
import {
  assemblyIntegrityObservationCaptureUri,
  createAssemblyIntegrityObservationCapture,
  fingerprintAssemblyIntegrityObservationCapture,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-observation-capture.ts";
import {
  ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-input-bundle.ts";
import {
  VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import type { EngineeringWorkItem } from "../../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import type {
  AssemblyIntegrityInputResolver,
  ResolvedAssemblyIntegrityInput,
} from "../../../ports/out/cad/assembly-integrity/exact-assembly-integrity-input-resolver.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const E = "e".repeat(64);
const AT = "2026-08-26T10:00:00.000Z";

Deno.test("L4 projects the L3 capture Thread basis before reopening exact inputs", async () => {
  const capture = await validCapture();
  const source = {
    id: capture.basis.snapshotId,
    revision: capture.basis.revision,
    subject: { id: capture.basis.subjectId },
  } as ThreadSnapshot;
  let received: unknown;
  const inputs: AssemblyIntegrityInputResolver = {
    resolve(request) {
      received = request;
      return Promise.resolve({} as ResolvedAssemblyIntegrityInput);
    },
  };

  await reopenExactL3AssemblyIntegrityInput(inputs, capture, source);

  assertEquals(capture.basis.kind, "thread-snapshot");
  assertEquals(received, {
    basis: {
      snapshotId: capture.basis.snapshotId,
      revision: capture.basis.revision,
      subjectId: capture.basis.subjectId,
    },
    snapshot: source,
    geometryModule: capture.geometryModule,
    observerProfile: {
      profile: {
        id: capture.profile.id,
        version: capture.profile.version,
      },
      fingerprint: capture.profile.fingerprint,
    },
  });
});

Deno.test(
  "L4 refuses a completed L3 evidence lookalike whose dynamic geometry binding diverges from its capture",
  async () => {
    const capture = await validCapture();
    const fingerprint = await fingerprintAssemblyIntegrityObservationCapture(capture);
    const artifact: ThreadArtifact = {
      id: `assembly-integrity-observation-${fingerprint.digest}`,
      name: "Assembly integrity observation",
      kind: "evidence",
      version: fingerprint.digest,
      fingerprint,
      uri: assemblyIntegrityObservationCaptureUri(fingerprint.digest),
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "verify.observe-assembly-integrity@1",
        runId: capture.trustedRunId,
      },
      inputArtifactIds: [
        capture.geometryModule.artifactId,
        capture.assemblyStep.artifactId,
      ],
      freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    };
    const issue = await recrossExactL3ObservationCaptureBinding({
      capture,
      artifact,
      producerRun: {
        id: capture.trustedRunId,
        startedAt: AT,
        basis: capture.basis,
      },
      resultSnapshot: {
        id: "thread-assembly-r2",
        revision: 2,
        previous: { snapshotId: capture.basis.snapshotId, revision: 1 },
        subject: { id: capture.basis.subjectId },
      } as ThreadSnapshot,
      dependencyWork: {
        id: "work-observe-assembly",
        operation: {
          id: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id,
          version: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version,
          bindings: [{
            name: "geometryModule",
            source: {
              kind: "thread-entity",
              reference: {
                snapshotId: capture.basis.snapshotId,
                snapshotRevision: capture.basis.revision,
                kind: "artifact",
                // Same snapshot and shape, but not the capture's exact primary.
                id: `geometry-${E}`,
              },
            },
          }],
        },
      } as unknown as EngineeringWorkItem,
    });

    assertEquals(
      issue,
      "The completed L3 work is not bound to the exact geometry module named by its capture.",
    );
  },
);

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
    trustedRunId: "run-observe-assembly",
    observedAt: AT,
    basis: {
      kind: "thread-snapshot",
      snapshotId: "thread-assembly-r1",
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
