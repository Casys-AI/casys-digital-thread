import { assertEquals, assertThrows } from "@std/assert";
import {
  CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_ADMISSION_SCHEMA,
  crossDomainImpactManifestUri,
  encodeCrossDomainImpactManifestSealAdmission,
  parseCrossDomainImpactManifestSealParameters,
} from "./cross-domain-impact-manifest-proposal.ts";
import {
  CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_CAPTURE_SCHEMA,
  validateCrossDomainImpactManifestSealCapture,
} from "./cross-domain-impact-manifest-seal-capture.ts";
import { deterministicJson, sha256Fingerprint } from "../kernel/deterministic-json.ts";
import { createCrossDomainImpactManifest } from "./cross-domain-impact-manifest.ts";
import {
  documentDefinedCrossDomainImpactManifestBody,
  validCrossDomainImpactManifest,
} from "../../testing/cross-domain-impact-fixtures.ts";

Deno.test("cross-domain impact manifest seal MRTR grammar is closed, canonical, and replayable", async () => {
  const admission = await admissionFixture();
  const parameters = encodeCrossDomainImpactManifestSealAdmission(admission);
  const parsed = parseCrossDomainImpactManifestSealParameters(parameters);
  assertEquals(deterministicJson(parsed), deterministicJson(admission));
  assertEquals(
    deterministicJson(encodeCrossDomainImpactManifestSealAdmission(parsed)),
    deterministicJson(parameters),
  );
  assertThrows(() =>
    parseCrossDomainImpactManifestSealParameters([
      ...parameters,
      { key: "provider", label: "Provider", value: "forbidden" },
    ])
  );
  assertThrows(() =>
    parseCrossDomainImpactManifestSealParameters([
      parameters[1]!,
      parameters[0]!,
      ...parameters.slice(2),
    ])
  );
});

Deno.test("cross-domain impact manifest seal capture retains only exact documentary admission", async () => {
  const admission = await admissionFixture();
  const capture = validateCrossDomainImpactManifestSealCapture({
    schemaVersion: CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_CAPTURE_SCHEMA,
    kind: "cross-domain-impact-manifest-seal",
    operation: { id: "verify.seal-cross-domain-impact-manifest", version: "2" },
    trustedRunId: "run.impact.seal",
    decisionId: "decision.impact.seal",
    sealedAt: "2026-08-22T09:00:00.000Z",
    admission,
  });
  assertEquals(capture.admission.manifest.reference, admission.manifest.reference);
  assertThrows(() =>
    validateCrossDomainImpactManifestSealCapture({
      ...capture,
      operation: { id: "verify.run-solver", version: "1" },
    })
  );
  assertThrows(() =>
    validateCrossDomainImpactManifestSealCapture({
      ...capture,
      branchOutcomes: [{ branchId: "mechanical", status: "carried-forward" }],
    })
  );
  assertThrows(() =>
    validateCrossDomainImpactManifestSealCapture({
      ...capture,
      gateClaimTransitions: [{
        gateItemId: "gate.mechanical",
        status: "carried-forward",
      }],
    })
  );
});

Deno.test("cross-domain impact seal proposal accepts a document-defined non-lamp change kind", async () => {
  const admission = await admissionFixtureFrom(
    await createCrossDomainImpactManifest(
      documentDefinedCrossDomainImpactManifestBody(),
    ),
  );
  const parsed = parseCrossDomainImpactManifestSealParameters(
    encodeCrossDomainImpactManifestSealAdmission(admission),
  );
  assertEquals(
    parsed.sourceAnchors.map((anchor) => anchor.changeKind).toSorted(),
    ["geometry-change", "mass-change"],
  );
});

Deno.test("cross-domain impact seal proposal rejects an empty or unsafe change kind", async () => {
  const admission = await admissionFixture();
  for (const changeKind of ["", " ", "mass change", "mass/change"]) {
    const forged = {
      ...structuredClone(admission),
      sourceAnchors: [
        { ...admission.sourceAnchors[0]!, changeKind },
        ...admission.sourceAnchors.slice(1),
      ],
    };
    assertThrows(
      () =>
        parseCrossDomainImpactManifestSealParameters(
          encodeCrossDomainImpactManifestSealAdmission(forged),
        ),
      TypeError,
    );
  }
});

async function admissionFixture() {
  return await admissionFixtureFrom(await validCrossDomainImpactManifest());
}

async function admissionFixtureFrom(
  manifest: Awaited<ReturnType<typeof validCrossDomainImpactManifest>>,
) {
  const reference = await sha256Fingerprint(manifest);
  return {
    schemaVersion: CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_ADMISSION_SCHEMA,
    manifest: {
      schemaVersion: manifest.schemaVersion,
      id: manifest.id,
      revision: manifest.revision,
      fingerprint: manifest.fingerprint,
      reference,
      uri: crossDomainImpactManifestUri(reference),
    },
    project: manifest.project,
    subject: manifest.subject,
    basis: {
      snapshotId: manifest.basis.snapshotId,
      revision: manifest.basis.revision,
      fingerprint: manifest.basis.fingerprint,
    },
    brief: {
      contractVersion: "2.0" as const,
      id: "brief.impact",
      revision: 2,
      fingerprint: { algorithm: "sha256" as const, digest: "f".repeat(64) },
      gates: manifest.gateMap.map((gate, index) => ({
        gateItemId: gate.gateItemId,
        kind: "success-criterion" as const,
        branchId: gate.branchId,
        role: gate.role,
        fingerprint: {
          algorithm: "sha256" as const,
          digest: `${index + 1}`.repeat(64),
        },
        dependsOnItemIds: index === 0 ? [] : ["brief.source.impact"],
      })).sort((left, right) => left.gateItemId.localeCompare(right.gateItemId)),
    },
    sourceAnchors: manifest.sourceAnchors,
    mechanicalEvidence: manifest.independenceAssertions.map((assertion) => ({
      assertionId: assertion.id,
      evidence: assertion.evidence,
      evidenceFreshness: "fresh" as const,
      consumptions: assertion.inspectedConsumptions.map((consumption) => ({
        id: consumption.id,
        consumerEvidence: assertion.evidence,
        input: consumption.input,
      })),
    })),
  };
}
