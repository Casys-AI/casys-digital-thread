import { assertEquals, assertRejects } from "@std/assert";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import {
  deterministicJson,
  sha256Hex,
} from "../../domain/kernel/deterministic-json.ts";
import {
  genuinePreviewResult,
  PREVIEW_TEST_BASIS,
  PREVIEW_TEST_CANDIDATE_DIGEST,
  PREVIEW_TEST_PROJECT_ID,
} from "../../testing/buy-cost-estimate-preview-test-support.ts";
import {
  BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_KIND,
  BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_URI_NAMESPACE,
  FileBuyCostEstimatePreviewEvidenceStore,
} from "./file-buy-cost-estimate-preview-evidence-store.ts";

async function genuineEvidence() {
  const { inputRefs, result } = await genuinePreviewResult();
  return {
    schemaVersion: "buy-cost-estimate-preview-evidence/1.0",
    projectId: PREVIEW_TEST_PROJECT_ID,
    basis: { ...PREVIEW_TEST_BASIS },
    candidate: {
      artifactId: `buy-cost-candidate-${PREVIEW_TEST_CANDIDATE_DIGEST}`,
      digest: PREVIEW_TEST_CANDIDATE_DIGEST,
    },
    configurationDigest: result.configurationDigest,
    baseBundleDigest: result.bundle.baseBundle.digest,
    inputRefs,
    result,
  } as const;
}

function store(directory: string) {
  return new FileBuyCostEstimatePreviewEvidenceStore(
    new FileByteStore({
      kind: BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_KIND,
      directory,
      uriNamespace: BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_URI_NAMESPACE,
      label: "test buy estimate preview evidence",
    }),
  );
}

Deno.test("evidence saves and reopens with the same canonical hash, bytes, and basis", async () => {
  const directory = await Deno.makeTempDir({ prefix: "buy-preview-evidence-" });
  const evidence = await genuineEvidence();
  const ref = await store(directory).save(evidence as never);
  assertEquals(ref.projectId, PREVIEW_TEST_PROJECT_ID);
  const reopened = await store(directory).read(ref);
  assertEquals(
    deterministicJson(reopened),
    deterministicJson({ ...evidence, basis: { ...PREVIEW_TEST_BASIS } }),
  );
  const canonicalBytes = new TextEncoder().encode(deterministicJson(reopened));
  assertEquals(ref.byteCount, canonicalBytes.byteLength);
  assertEquals(ref.fingerprint.digest, await sha256Hex(canonicalBytes));
  assertEquals(reopened?.basis, { ...PREVIEW_TEST_BASIS });
});

Deno.test("foreign project, count, digest, and nested structure are refused", async () => {
  const directory = await Deno.makeTempDir({ prefix: "buy-preview-evidence-" });
  const evidence = await genuineEvidence();
  const ref = await store(directory).save(evidence as never);
  await assertRejects(
    () => store(directory).read({ ...ref, projectId: "foreign-project" }),
    TypeError,
    "foreign or corrupt",
  );
  await assertRejects(
    () => store(directory).read({ ...ref, byteCount: ref.byteCount + 1 }),
    TypeError,
    "not exact",
  );
  const missing = await store(directory).read({
    ...ref,
    fingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
  });
  assertEquals(missing, undefined);
  await assertRejects(
    () =>
      store(directory).save({
        ...(evidence as unknown as Record<string, unknown>),
        result: {
          ...(evidence.result as unknown as Record<string, unknown>),
          bundle: {
            ...(evidence.result.bundle as unknown as Record<string, unknown>),
            inventedField: true,
          },
        },
      } as never),
    TypeError,
    "unsupported field",
  );
  await assertRejects(
    () =>
      store(directory).save({
        ...(evidence as unknown as Record<string, unknown>),
        baseBundleDigest: "1".repeat(64),
      } as never),
    TypeError,
    "base bundle digest does not match",
  );
  await assertRejects(
    () =>
      store(directory).save({
        ...(evidence as unknown as Record<string, unknown>),
        inputRefs: [],
      } as never),
    TypeError,
    "must hold 1..8",
  );
});

Deno.test("tampered stored bytes fail closed and cursors round-trip", async () => {
  const directory = await Deno.makeTempDir({ prefix: "buy-preview-evidence-" });
  const evidence = await genuineEvidence();
  const ref = await store(directory).save(evidence as never);
  const path = `${directory}/${ref.fingerprint.digest}`;
  await Deno.writeTextFile(path, JSON.stringify({ tampered: true }));
  await assertRejects(
    () => store(directory).read(ref),
    Error,
    undefined,
  );
  const fresh = await Deno.makeTempDir({ prefix: "buy-preview-evidence-" });
  const cursor = await store(fresh).saveCursor({
    projectId: PREVIEW_TEST_PROJECT_ID,
    fingerprint: ref.fingerprint.digest,
    section: "lines",
    offset: 20,
  });
  assertEquals(await store(fresh).readCursor(cursor), {
    projectId: PREVIEW_TEST_PROJECT_ID,
    fingerprint: ref.fingerprint.digest,
    section: "lines",
    offset: 20,
  });
  assertEquals(await store(fresh).readCursor("0".repeat(64)), undefined);
  await assertRejects(
    () =>
      store(fresh).saveCursor({
        projectId: PREVIEW_TEST_PROJECT_ID,
        fingerprint: "not-hex",
        section: "lines",
        offset: 0,
      }),
    TypeError,
    "invalid or foreign",
  );
  await assertRejects(
    () => store(fresh).readCursor("not-hex"),
    TypeError,
    "invalid or foreign",
  );
});
