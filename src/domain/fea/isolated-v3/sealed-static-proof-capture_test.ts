import { assertEquals, assertRejects } from "@std/assert";
import { canonicalProofText } from "../seal-case/fea-proof-proposal.ts";
import { validateMechanicalProofCase } from "../seal-case/mechanical-proof-case.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import {
  parseSealedStaticProofCapture,
  SEALED_STATIC_PROOF_CAPTURE_SCHEMA,
} from "./sealed-static-proof-capture.ts";

const AT = "2026-08-16T00:00:00.000Z";
const GEOMETRY = {
  id: "geometry-bbbb",
  fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
  producerRunId: "run-geom",
};
const REQUIREMENTS = {
  id: "req-arm",
  fingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
  producerRunId: "run-req",
};

async function catalogProof() {
  return validateMechanicalProofCase(JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl04-arm-cantilever.json",
        import.meta.url,
      ),
    ),
  ));
}

async function captureRecord(
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const proofCase = await catalogProof();
  return {
    schemaVersion: SEALED_STATIC_PROOF_CAPTURE_SCHEMA,
    operation: { id: "verify.seal-proof-case", version: "1" },
    trustedRunId: "run-seal",
    proofDigest: (await sha256Fingerprint(proofCase)).digest,
    canonicalProofText: canonicalProofText(proofCase),
    geometryArtifact: GEOMETRY,
    stepArtifact: {
      id: "step-eeee",
      fingerprint: {
        algorithm: "sha256",
        digest: proofCase.expectedCadArtifact.sha256,
      },
      producerRunId: "run-geom",
      bytes: proofCase.expectedCadArtifact.bytes,
    },
    requirementsArtifact: REQUIREMENTS,
    requirementsElementId: proofCase.requirementsSource.elementId,
    seedIdentity: {
      editingContextId: proofCase.requirementsSource.editingContextId,
      elementId: proofCase.requirementsSource.elementId,
    },
    sealedAt: AT,
    ...overrides,
  };
}

function bytesOf(value: unknown): Uint8Array {
  return new TextEncoder().encode(deterministicJson(value));
}

Deno.test("sealed static proof capture returns exact STEP and requirements identities", async () => {
  const record = await captureRecord();
  const parsed = await parseSealedStaticProofCapture(bytesOf(record));
  const proofCase = await catalogProof();
  assertEquals(parsed.trustedRunId, "run-seal");
  assertEquals(parsed.case.id, proofCase.id);
  assertEquals(parsed.geometry, GEOMETRY);
  assertEquals(parsed.requirements, REQUIREMENTS);
  assertEquals(parsed.step.id, "step-eeee");
  assertEquals(parsed.step.bytes, proofCase.expectedCadArtifact.bytes);
  assertEquals(parsed.step.fingerprint.digest, proofCase.expectedCadArtifact.sha256);
});

Deno.test("sealed static proof capture refuses noncanonical bytes", async () => {
  const record = await captureRecord();
  await assertRejects(
    () =>
      parseSealedStaticProofCapture(
        new TextEncoder().encode(`${deterministicJson(record)}\n`),
      ),
    TypeError,
    "not a canonical supported seal",
  );
});

Deno.test("sealed static proof capture refuses a wrong seal operation", async () => {
  const record = await captureRecord({
    operation: { id: "verify.run-fea-static-proof", version: "3" },
  });
  await assertRejects(
    () => parseSealedStaticProofCapture(bytesOf(record)),
    TypeError,
    "not produced by the proof-seal operation",
  );
});

Deno.test("sealed static proof capture refuses a wrong proof digest", async () => {
  const record = await captureRecord({ proofDigest: "d".repeat(64) });
  await assertRejects(
    () => parseSealedStaticProofCapture(bytesOf(record)),
    TypeError,
    "does not bind canonical proof bytes",
  );
});

Deno.test("sealed static proof capture refuses a malformed STEP identity", async () => {
  const record = await captureRecord();
  record.stepArtifact = {
    ...(record.stepArtifact as Record<string, unknown>),
    bytes: 0,
  };
  await assertRejects(
    () => parseSealedStaticProofCapture(bytesOf(record)),
    TypeError,
    "stepArtifact.bytes must be a positive integer",
  );
});

Deno.test("sealed static proof capture refuses a malformed requirements identity", async () => {
  const record = await captureRecord();
  record.requirementsArtifact = {
    id: "req-arm",
    fingerprint: REQUIREMENTS.fingerprint,
  };
  await assertRejects(
    () => parseSealedStaticProofCapture(bytesOf(record)),
    TypeError,
    "requirementsArtifact has unexpected fields",
  );
});
