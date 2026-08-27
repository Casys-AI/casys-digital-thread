import { assertEquals } from "@std/assert";
import { validateMechanicalProofCase } from "../../fea/seal-case/mechanical-proof-case.ts";
import { compileSensitivityCatalogOffer } from "./sensitivity-catalog-from-proof.ts";
import {
  bindSignedCatalogOffer,
  joinProofCaptureForOfferDigest,
  namedOfferCaseMismatch,
  selectUniqueSignedCatalogOffer,
  shouldOpenSignedCatalogOffer,
} from "./sensitivity-catalog-offer-join.ts";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";

function artifact(id: string) {
  return { id };
}

Deno.test("a resolved or unavailable catalog blocks the signed-offer path", () => {
  assertEquals(
    shouldOpenSignedCatalogOffer({ catalogStatus: "ok" }),
    false,
  );
  assertEquals(
    shouldOpenSignedCatalogOffer({ catalogStatus: "catalog_unavailable" }),
    false,
  );
  assertEquals(
    shouldOpenSignedCatalogOffer({ catalogStatus: "catalog_integrity_failed" }),
    false,
  );
});

Deno.test(
  "catalog-absent and catalog-ambiguous fall through to a signed offer",
  () => {
    assertEquals(
      shouldOpenSignedCatalogOffer({ catalogStatus: "unresolved" }),
      true,
    );
  },
);

Deno.test(
  "proof join accepts several captures of the same digest and ignores an invalid sibling",
  () => {
    const capture = { proofDigest: "b".repeat(64) };
    const joined = joinProofCaptureForOfferDigest([
      { status: "invalid", artifact: artifact("proof-garbage") },
      { status: "matched", artifact: artifact("proof-a"), proofCapture: capture },
      { status: "matched", artifact: artifact("proof-b"), proofCapture: capture },
      { status: "unread", artifact: artifact("proof-unread") },
    ]);
    assertEquals(joined.status, "ok");
    if (joined.status !== "ok") return;
    assertEquals(joined.artifact.id, "proof-a");
  },
);

Deno.test(
  "proof join is unavailable when no digest match exists and a sibling is unread",
  () => {
    const joined = joinProofCaptureForOfferDigest([
      { status: "unread", artifact: artifact("proof-unread") },
      { status: "other", artifact: artifact("proof-other") },
    ]);
    assertEquals(joined.status, "unavailable");
    if (joined.status !== "unavailable") return;
    assertEquals(joined.diagnostic.code, "catalog-offer-unavailable");
  },
);

Deno.test("named compiled-id mismatch is catalog-offer-case-mismatch", () => {
  const diagnostic = namedOfferCaseMismatch(
    "invented-dl06-case",
    "desk-lamp-dl06-arm-cantilever-arm_thickness",
    "offer-1",
  );
  assertEquals(diagnostic?.code, "catalog-offer-case-mismatch");
  assertEquals(
    namedOfferCaseMismatch(
      "desk-lamp-dl06-arm-cantilever-arm_thickness",
      "desk-lamp-dl06-arm-cantilever-arm_thickness",
      "offer-1",
    ),
    undefined,
  );
});

Deno.test("selectUniqueSignedCatalogOffer is absent, unique, or ambiguous", () => {
  assertEquals(selectUniqueSignedCatalogOffer([]).status, "absent");
  const unique = selectUniqueSignedCatalogOffer([artifact("offer-1")]);
  assertEquals(unique.status, "ok");
  if (unique.status !== "ok") return;
  assertEquals(unique.artifact.id, "offer-1");
  const ambiguous = selectUniqueSignedCatalogOffer([
    artifact("offer-1"),
    artifact("offer-2"),
  ]);
  assertEquals(ambiguous.status, "ambiguous");
});

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
const ARM_THICKNESS = {
  semanticKey: "arm_thickness",
  value: 10,
  sourceId: "source.arm",
  sourceSymbolId: "parameter.arm-thickness",
  parameterBindingId: "binding.arm-thickness",
  parameterSysmlElementId: "sysml.arm-thickness",
  resultSymbolId: "artifact.result",
} as const;
const AUTHORITY = {
  proofDigest: "a".repeat(64),
  admissionArtifact: {
    id: "technical-compilation-admission-a",
    fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
  },
  source: {
    id: "source.arm",
    fingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
  },
  resultBinding: {
    id: "binding.result",
    sourceSymbolId: "artifact.result",
    modelElementId: DL06_PROOF.target.modelElementId,
  },
} as const;

function readyOffer() {
  const offer = compileSensitivityCatalogOffer(
    DL06_PROOF,
    [ARM_THICKNESS],
    AUTHORITY,
  );
  if (offer.status !== "ready-for-opt-in") {
    throw new Error(`Expected a ready offer, got ${offer.status}.`);
  }
  return offer;
}

async function bindReady(options: {
  readonly version?: string;
  readonly offerDigest?: string;
  readonly recompiled?: ReturnType<typeof compileSensitivityCatalogOffer>;
  readonly namedCaseId?: string;
} = {}) {
  const offer = readyOffer();
  const offerDigest = options.offerDigest ?? (await sha256Fingerprint(offer)).digest;
  return await bindSignedCatalogOffer({
    offerArtifact: {
      id: "offer-1",
      version: options.version ?? offerDigest,
    },
    offerDigest,
    recompiled: options.recompiled ?? offer,
    proofCase: DL06_PROOF,
    proofDigest: AUTHORITY.proofDigest,
    admissionArtifact: AUTHORITY.admissionArtifact,
    namedCaseId: options.namedCaseId,
    projectId: "desk-lamp-dl06",
    subjectId: "project:desk-lamp-dl06",
  });
}

Deno.test("bindSignedCatalogOffer compiles cadSource and the mesh-sized template", async () => {
  const bound = await bindReady();
  assertEquals(bound.status, "ok");
  if (bound.status !== "ok") return;
  assertEquals(bound.caseId, "desk-lamp-dl06-arm-cantilever-arm_thickness");
  assertEquals(bound.template.step, { value: 3, unit: "mm" });
  assertEquals(
    bound.cadSource.artifactUri,
    "thread-artifact://desk-lamp-dl06/technical-compilation-admission-a",
  );
});

Deno.test("bindSignedCatalogOffer refuses a Thread version that is not the offer digest", async () => {
  const bound = await bindReady({ version: "f".repeat(64) });
  assertEquals(bound.status, "unresolved");
  if (bound.status !== "unresolved") return;
  assertEquals(bound.diagnostic.code, "catalog-offer-integrity-failed");
});

Deno.test("bindSignedCatalogOffer refuses a recompiled offer that is no longer ready", async () => {
  const bound = await bindReady({
    recompiled: compileSensitivityCatalogOffer(DL06_PROOF, [], AUTHORITY),
  });
  assertEquals(bound.status, "unresolved");
  if (bound.status !== "unresolved") return;
  assertEquals(bound.diagnostic.code, "catalog-offer-admission-unlinked");
});

Deno.test("bindSignedCatalogOffer refuses a digest that is not the recompiled offer", async () => {
  const bound = await bindReady({
    version: "e".repeat(64),
    offerDigest: "e".repeat(64),
  });
  assertEquals(bound.status, "unresolved");
  if (bound.status !== "unresolved") return;
  assertEquals(bound.diagnostic.code, "catalog-offer-integrity-failed");
});

Deno.test("bindSignedCatalogOffer names a compiled-id mismatch", async () => {
  const bound = await bindReady({ namedCaseId: "invented-dl06-case" });
  assertEquals(bound.status, "unresolved");
  if (bound.status !== "unresolved") return;
  assertEquals(bound.diagnostic.code, "catalog-offer-case-mismatch");
});
