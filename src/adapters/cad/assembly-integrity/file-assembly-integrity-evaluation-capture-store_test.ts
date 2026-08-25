import { assertEquals, assertRejects } from "@std/assert";
import {
  FileAssemblyIntegrityEvaluationCaptureStore,
} from "./file-assembly-integrity-evaluation-capture-store.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA,
  assemblyIntegrityEvaluationCaptureUri,
  assemblyIntegrityEvaluationMethod,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import {
  VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);

Deno.test("L4 evaluation capture store preserves canonical content-addressed bytes", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "assembly-integrity-evaluation-",
  });
  try {
    const raw = new FileCaptureStore({
      kind: "assembly-integrity-evaluation-capture" as const,
      directory,
      uriNamespace: "assembly-integrity-evaluation-capture",
      label: "Test assembly-integrity evaluation",
    });
    const store = new FileAssemblyIntegrityEvaluationCaptureStore(raw);
    const capture = await validCapture();
    const receipt = await store.save(capture);

    assertEquals(
      receipt.uri,
      assemblyIntegrityEvaluationCaptureUri(receipt.fingerprint.digest),
    );
    assertEquals(await store.read(receipt.fingerprint), capture);

    await Deno.writeTextFile(raw.pathFor(receipt.fingerprint), "{}");
    await assertRejects(() => store.read(receipt.fingerprint), Error);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function validCapture() {
  const method = await assemblyIntegrityEvaluationMethod();
  return {
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA,
    kind: "assembly-integrity-evaluation" as const,
    operation: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
    trustedRunId: "run-evaluate",
    evaluatedAt: "2026-08-26T10:00:00.000Z",
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: "assembly:r7",
      revision: 7,
      subjectId: "assembly",
    },
    geometryModule: {
      schemaVersion: "geometry-module-capture/1.0" as const,
      artifactId: `geometry-${A}`,
      fingerprint: fp(A),
    },
    assemblyStep: {
      artifactId: `cad-asset-${A}-module-step-${B}`,
      fingerprint: fp(B),
    },
    observation: {
      schemaVersion: "assembly-integrity-observation-capture/1.0" as const,
      artifactId: `assembly-integrity-observation-${C}`,
      fingerprint: fp(C),
      observationFingerprint: fp(D),
    },
    inputBundle: {
      schemaVersion: "assembly-integrity-input-bundle/1.0" as const,
      fingerprint: fp(A),
      byteCount: 1024,
    },
    method,
    evaluation: {
      method,
      criteria: [
        { id: "assembly-import" as const, verdict: "pass" as const },
        { id: "occurrence-coverage" as const, verdict: "pass" as const },
        { id: "placement-recross" as const, verdict: "pass" as const },
        { id: "brep-validity" as const, verdict: "pass" as const },
        { id: "pairwise-intersection" as const, verdict: "pass" as const },
      ],
      verdict: "pass" as const,
      measurementDiagnostics: { pairwiseLinearToleranceMm: [] },
    },
  };
}

function fp(digest: string) {
  return { algorithm: "sha256" as const, digest };
}
