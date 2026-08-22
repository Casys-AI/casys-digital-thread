import { assertEquals, assertRejects } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import { validateMechanicalProofCase } from "../../fea/seal-case/mechanical-proof-case.ts";
import {
  compileSensitivityCatalogOffer,
  SENSITIVITY_CATALOG_OFFER_CAPTURE_SCHEMA,
} from "./sensitivity-catalog-from-proof.ts";
import { parseSensitivityCatalogOfferCapture } from "./sensitivity-catalog-offer-capture.ts";

const DL06_PROOF = validateMechanicalProofCase(
  JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl06-arm-cantilever.json",
        import.meta.url,
      ),
    ),
  ),
);

async function readyCaptureText() {
  const offer = compileSensitivityCatalogOffer(
    DL06_PROOF,
    [{
      semanticKey: "arm_thickness",
      value: 10,
      sourceId: "source.arm",
      sourceSymbolId: "parameter.arm-thickness",
      parameterBindingId: "binding.arm-thickness",
      parameterSysmlElementId: "sysml.arm-thickness",
      resultSymbolId: "artifact.result",
    }],
    {
      proofDigest: "a".repeat(64),
      admissionArtifact: {
        id: "technical-compilation-admission-a",
        fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      },
      source: {
        id: "source.arm",
        fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
      },
      resultBinding: {
        id: "binding.result",
        sourceSymbolId: "artifact.result",
        modelElementId: DL06_PROOF.target.modelElementId,
      },
    },
  );
  if (offer.status !== "ready-for-opt-in") {
    throw new Error(`Expected a ready offer, got ${offer.status}.`);
  }
  const record = {
    schemaVersion: SENSITIVITY_CATALOG_OFFER_CAPTURE_SCHEMA,
    operation: { id: "verify.seal-proof-case", version: "1" },
    trustedRunId: "run-seal",
    sealedAt: "2026-08-16T00:00:00.000Z",
    offerDigest: (await sha256Fingerprint(offer)).digest,
    offer,
  };
  return { text: deterministicJson(record), offer };
}

Deno.test(
  "catalog offer capture parser reopens the sealed envelope and keeps step not-compiled",
  async () => {
    const { text, offer } = await readyCaptureText();
    const capture = await parseSensitivityCatalogOfferCapture(text);
    assertEquals(capture.schemaVersion, SENSITIVITY_CATALOG_OFFER_CAPTURE_SCHEMA);
    assertEquals(capture.offerDigest, (await sha256Fingerprint(offer)).digest);
    assertEquals(capture.offer.status, "ready-for-opt-in");
    assertEquals(capture.offer.step, { status: "not-compiled" });
    assertEquals(capture.offer.lever, { semanticKey: "arm_thickness", value: 10 });
  },
);

Deno.test(
  "catalog offer capture parser refuses a truncated offer without authority",
  async () => {
    const { text } = await readyCaptureText();
    const parsed = JSON.parse(text) as {
      offer: Record<string, unknown>;
      offerDigest: string;
    };
    delete parsed.offer.authority;
    parsed.offerDigest = (await sha256Fingerprint(parsed.offer)).digest;
    await assertRejects(
      () => parseSensitivityCatalogOfferCapture(deterministicJson(parsed)),
      TypeError,
      "authority is required",
    );
  },
);

Deno.test(
  "catalog offer capture parser refuses a drifted offer digest",
  async () => {
    const { text } = await readyCaptureText();
    const parsed = JSON.parse(text) as { offerDigest: string };
    parsed.offerDigest = "f".repeat(64);
    await assertRejects(
      () => parseSensitivityCatalogOfferCapture(deterministicJson(parsed)),
      TypeError,
      "does not bind canonical offer bytes",
    );
  },
);
