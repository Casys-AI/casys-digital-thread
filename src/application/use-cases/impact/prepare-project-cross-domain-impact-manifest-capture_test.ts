import { assert, assertEquals, assertRejects } from "@std/assert";
import { FileCaptureStore } from "../../../adapters/shared/cas/file-capture-store.ts";
import { FileCrossDomainImpactManifestStore } from "../../../adapters/impact/file-cross-domain-impact-manifest-store.ts";
import type { CrossDomainImpactManifest } from "../../../domain/impact/cross-domain-impact-manifest.ts";
import type {
  CrossDomainImpactManifestStore,
  CrossDomainImpactManifestStoreReceipt,
} from "../../ports/out/impact/cross-domain-impact-manifest-store.ts";
import type {
  ReopenedCrossDomainImpactManifest,
} from "../../ports/out/impact/cross-domain-impact-manifest-reader.ts";
import { CROSS_DOMAIN_IMPACT_MANIFEST_CAPTURE_SOURCE_MAX_CHARS } from "../../ports/in/impact/project-cross-domain-impact-manifest-capture.ts";
import {
  validCrossDomainImpactManifestBody,
} from "../../../testing/cross-domain-impact-fixtures.ts";
import {
  PrepareProjectCrossDomainImpactManifestCapture,
  ProjectCrossDomainImpactManifestCaptureError,
} from "./prepare-project-cross-domain-impact-manifest-capture.ts";

Deno.test("impact-manifest capture writes draft CAS, rereads, and stays reference-only", async () => {
  const root = await Deno.makeTempDir({ prefix: "impact-manifest-capture-" });
  try {
    const manifests = fileStore(root);
    const capture = new PrepareProjectCrossDomainImpactManifestCapture({
      manifests,
    });
    const sourceText = JSON.stringify(validCrossDomainImpactManifestBody());
    const review = await capture.capture({ sourceText });
    assertEquals(
      review.schemaVersion,
      "cross-domain-impact-manifest-capture-review/1.0",
    );
    assertEquals(review.status, "captured");
    assertEquals(review.grants, "none");
    assertEquals(Object.keys(review).sort(), [
      "grants",
      "reference",
      "schemaVersion",
      "status",
      "summary",
    ]);
    assertEquals(Object.keys(review.reference), ["fingerprint"]);
    assertEquals(review.summary.id, "impact-manifest-led-1");
    assertEquals(review.summary.revision, 1);
    assertEquals(review.summary.basis, {
      projectId: "project-led-1",
      subjectId: "subject-led-1",
      snapshotId: "thread-led-r7",
      revision: 7,
    });
    assertEquals(review.summary.changeKinds, ["brightness", "electrical-power"]);
    assertEquals("uri" in review, false);
    assertEquals("sourceText" in review, false);
    assertEquals("manifest" in review, false);
    assertEquals("decisionParameters" in review || "next" in review, false);

    const reopened = await manifests.read(review.reference);
    assert(reopened);
    assertEquals(reopened.reference, review.reference);
    assertEquals(reopened.manifest.id, review.summary.id);
    assertEquals(reopened.manifest.changeKinds, review.summary.changeKinds);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("impact-manifest capture is deterministic and immediately readable", async () => {
  const root = await Deno.makeTempDir({ prefix: "impact-manifest-capture-det-" });
  try {
    const manifests = fileStore(root);
    const capture = new PrepareProjectCrossDomainImpactManifestCapture({
      manifests,
    });
    const sourceText = JSON.stringify(validCrossDomainImpactManifestBody());
    const first = await capture.capture({ sourceText });
    const second = await capture.capture({ sourceText });
    assertEquals(second.reference, first.reference);
    assertEquals(second.summary, first.summary);
    const reopened = await manifests.read(first.reference);
    assert(reopened);
    assertEquals(reopened.reference.fingerprint, first.reference.fingerprint);
    assertEquals(reopened.manifest.schemaVersion, "cross-domain-impact-manifest/1.0");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("impact-manifest capture rejects a forged fingerprint or extra field before save", async () => {
  let saves = 0;
  const capture = new PrepareProjectCrossDomainImpactManifestCapture({
    manifests: countingStore(() => {
      saves += 1;
    }),
  });
  const body = validCrossDomainImpactManifestBody();
  const forged = await assertRejects(
    () =>
      capture.capture({
        sourceText: JSON.stringify({
          ...body,
          fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        }),
      }),
    ProjectCrossDomainImpactManifestCaptureError,
  );
  assertEquals(forged.code, "invalid_manifest");
  const extra = await assertRejects(
    () =>
      capture.capture({
        sourceText: JSON.stringify({ ...body, provider: "ngspice" }),
      }),
    ProjectCrossDomainImpactManifestCaptureError,
  );
  assertEquals(extra.code, "invalid_manifest");
  const mismatched = structuredClone(body);
  mismatched.basis.projectId = "other-project";
  const join = await assertRejects(
    () => capture.capture({ sourceText: JSON.stringify(mismatched) }),
    ProjectCrossDomainImpactManifestCaptureError,
  );
  assertEquals(join.code, "invalid_manifest");
  assertEquals(saves, 0);
});

Deno.test("impact-manifest capture refuses extra authority fields and invalid JSON", async () => {
  let saves = 0;
  const capture = new PrepareProjectCrossDomainImpactManifestCapture({
    manifests: countingStore(() => {
      saves += 1;
    }),
  });
  const extra = await assertRejects(
    () =>
      capture.capture({
        sourceText: JSON.stringify(validCrossDomainImpactManifestBody()),
        provider: "ngspice",
        runtime: "latest",
      } as never),
    ProjectCrossDomainImpactManifestCaptureError,
  );
  assertEquals(extra.code, "invalid_request");
  const invalidJson = await assertRejects(
    () => capture.capture({ sourceText: "{" }),
    ProjectCrossDomainImpactManifestCaptureError,
  );
  assertEquals(invalidJson.code, "invalid_manifest");
  const oversized = await assertRejects(
    () =>
      capture.capture({
        sourceText: "x".repeat(
          CROSS_DOMAIN_IMPACT_MANIFEST_CAPTURE_SOURCE_MAX_CHARS + 1,
        ),
      }),
    ProjectCrossDomainImpactManifestCaptureError,
  );
  assertEquals(oversized.code, "invalid_request");
  assertEquals(saves, 0);
});

Deno.test("impact-manifest capture wraps a corrupt readback before returning a review", async () => {
  const capture = new PrepareProjectCrossDomainImpactManifestCapture({
    manifests: {
      save() {
        return Promise.resolve({
          reference: {
            fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
          },
        });
      },
      read() {
        return Promise.resolve(undefined);
      },
    },
  });
  const error = await assertRejects(
    () =>
      capture.capture({
        sourceText: JSON.stringify(validCrossDomainImpactManifestBody()),
      }),
    ProjectCrossDomainImpactManifestCaptureError,
  );
  assertEquals(error.code, "source_capture_failed");
});

function fileStore(root: string): FileCrossDomainImpactManifestStore {
  return new FileCrossDomainImpactManifestStore(
    new FileCaptureStore({
      kind: "cross-domain-impact-manifest",
      directory: `${root}/manifests`,
      uriNamespace: "cross-domain-impact-manifest",
      label: "Test impact manifest",
    }),
  );
}

function countingStore(onSave: () => void): CrossDomainImpactManifestStore {
  return {
    save(
      _value: CrossDomainImpactManifest,
    ): Promise<CrossDomainImpactManifestStoreReceipt> {
      onSave();
      throw new Error("must not save");
    },
    read(): Promise<ReopenedCrossDomainImpactManifest | undefined> {
      throw new Error("must not read");
    },
  };
}
