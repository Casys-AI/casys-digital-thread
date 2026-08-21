import { assertEquals, assertRejects } from "@std/assert";
import {
  CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_ADMISSION_SCHEMA,
  crossDomainImpactManifestUri,
} from "../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import {
  CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_CAPTURE_SCHEMA,
  validateCrossDomainImpactManifestSealCapture,
} from "../../domain/impact/cross-domain-impact-manifest-seal-capture.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import { validCrossDomainImpactManifest } from "../../testing/cross-domain-impact-fixtures.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";
import { FileCrossDomainImpactManifestSealCaptureStore } from "./file-cross-domain-impact-manifest-seal-capture-store.ts";
import { FileCrossDomainImpactManifestStore } from "./file-cross-domain-impact-manifest-store.ts";

Deno.test("impact manifest and seal capture readers reopen only their closed content address", async () => {
  const root = await Deno.makeTempDir({ prefix: "impact-store-" });
  try {
    const manifestsRaw = new FileCaptureStore({
      kind: "cross-domain-impact-manifest" as const,
      directory: `${root}/manifests`,
      uriNamespace: "cross-domain-impact-manifest",
      label: "Test impact manifest",
    });
    const manifests = new FileCrossDomainImpactManifestStore(manifestsRaw);
    const manifest = await validCrossDomainImpactManifest();
    const saved = await manifests.save(manifest);
    const reopened = await manifests.read(saved.reference);
    assertEquals(reopened?.reference, saved.reference);
    assertEquals(reopened?.manifest.fingerprint, manifest.fingerprint);

    const captureRaw = new FileCaptureStore({
      kind: "cross-domain-impact-manifest-seal-capture" as const,
      directory: `${root}/seals`,
      uriNamespace: "cross-domain-impact-manifest-seal-capture",
      label: "Test impact seal",
    });
    const captures = new FileCrossDomainImpactManifestSealCaptureStore(captureRaw);
    const capture = validateCrossDomainImpactManifestSealCapture({
      schemaVersion: CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_CAPTURE_SCHEMA,
      kind: "cross-domain-impact-manifest-seal",
      operation: { id: "verify.seal-cross-domain-impact-manifest", version: "1" },
      trustedRunId: "run.impact.store",
      decisionId: "decision.impact.store",
      sealedAt: "2026-08-22T09:00:00.000Z",
      admission: await admissionFixture(manifest, saved.reference.fingerprint),
    });
    const storedCapture = await captures.save(capture);
    const reopenedCapture = await captures.read(storedCapture.fingerprint);
    assertEquals(reopenedCapture?.trustedRunId, capture.trustedRunId);

    await Deno.writeTextFile(
      manifestsRaw.pathFor(saved.reference.fingerprint),
      "{\"forged\":true}",
    );
    await assertRejects(() => manifests.read(saved.reference));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function admissionFixture(
  manifest: Awaited<ReturnType<typeof validCrossDomainImpactManifest>>,
  reference: { readonly algorithm: "sha256"; readonly digest: string },
) {
  const verifiedReference = await sha256Fingerprint(manifest);
  assertEquals(verifiedReference, reference);
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
      id: "brief.impact.store",
      revision: 2,
      fingerprint: { algorithm: "sha256" as const, digest: "f".repeat(64) },
      gates: manifest.gateMap.map((gate, index) => ({
        gateItemId: gate.gateItemId,
        kind: "success-criterion" as const,
        branchId: gate.branchId,
        role: gate.role,
        fingerprint: { algorithm: "sha256" as const, digest: `${index + 1}`.repeat(64) },
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
