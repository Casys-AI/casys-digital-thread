import { assert, assertEquals, assertRejects } from "@std/assert";
import { FileBuyCostEstimatePreviewEvidenceStore } from "../../../adapters/buy/file-buy-cost-estimate-preview-evidence-store.ts";
import {
  BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_KIND,
  BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_URI_NAMESPACE,
} from "../../../adapters/buy/file-buy-cost-estimate-preview-evidence-store.ts";
import { FileByteStore } from "../../../adapters/shared/cas/file-byte-store.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  genuinePreviewResult,
  PREVIEW_TEST_BASIS,
  PREVIEW_TEST_CANDIDATE_DIGEST,
  PREVIEW_TEST_PROJECT_ID,
} from "../../../testing/buy-cost-estimate-preview-test-support.ts";
import {
  BoundedBuyCostEstimatePreview,
  BUY_COST_ESTIMATE_PREVIEW_SUMMARY_MAX_BYTES,
  ReadBuyCostEstimatePreviewEvidence,
  summary,
} from "./bounded-buy-cost-estimate-preview.ts";

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

function facade(directory: string, result: unknown) {
  return new BoundedBuyCostEstimatePreview(
    { execute: () => Promise.resolve(structuredClone(result) as never) },
    store(directory),
  );
}

function command(inputRefs: readonly unknown[]) {
  return {
    projectId: PREVIEW_TEST_PROJECT_ID,
    basis: { ...PREVIEW_TEST_BASIS },
    candidateArtifactId: `buy-cost-candidate-${PREVIEW_TEST_CANDIDATE_DIGEST}`,
    candidateFingerprint: {
      algorithm: "sha256",
      digest: PREVIEW_TEST_CANDIDATE_DIGEST,
    },
    estimateRefs: inputRefs,
  };
}

Deno.test("bounded summary carries exact identities within its fixed bound", async () => {
  const directory = await Deno.makeTempDir({ prefix: "buy-preview-facade-" });
  const { inputRefs, result } = await genuinePreviewResult();
  const out = await (await facade(directory, result)).execute(command(inputRefs));
  assertEquals(out.status, "preview");
  if (out.status !== "preview") return;
  assertEquals(out.nature, "documentary");
  assertEquals(out.provisional, false);
  assertEquals(out.configurationDigest, result.configurationDigest);
  assertEquals(out.candidateDigest, PREVIEW_TEST_CANDIDATE_DIGEST);
  assertEquals(out.baseBundleDigest, result.bundle.baseBundle.digest);
  assertEquals(out.coverage.status, result.bundle.coverage.status);
  assertEquals(out.totals[0]?.amount, result.bundle.totals[0]?.amount);
  assertEquals(out.counts.estimates, 1);
  assertEquals(out.counts.lines, result.bundle.lines.length);
  const bytes = new TextEncoder().encode(deterministicJson(out)).byteLength;
  assert(bytes <= BUY_COST_ESTIMATE_PREVIEW_SUMMARY_MAX_BYTES, `${bytes}`);
  assertEquals("annexes" in out, false);
  assertEquals("bundle" in out, false);
  assertEquals("decisionParameters" in out, false);
});

Deno.test("large many-gap facts still fit the default summary bound", async () => {
  const directory = await Deno.makeTempDir({ prefix: "buy-preview-facade-" });
  const { inputRefs, result } = await genuinePreviewResult();
  const gaps = Array.from({ length: 200 }, (_, i) => ({
    code: "dimension-unknown",
    message: `synthetic gap ${i} ` + "x".repeat(500),
    lineId: `line.synthetic.${i}`,
  }));
  const large = {
    ...(result as unknown as Record<string, unknown>),
    bundle: {
      ...(result.bundle as unknown as Record<string, unknown>),
      lines: Array.from({ length: 100 }, (_, i) => ({
        ...(result.bundle.lines[0] as unknown as Record<string, unknown>),
        configurationLineId: `line.synthetic.${i}`,
        gaps: [gaps[i % gaps.length], gaps[(i + 1) % gaps.length]],
      })),
      gaps,
    },
  };
  const out = await (await facade(directory, large)).execute(command(inputRefs));
  assertEquals(out.status, "preview");
  if (out.status !== "preview") return;
  const bytes = new TextEncoder().encode(deterministicJson(out)).byteLength;
  assert(bytes <= BUY_COST_ESTIMATE_PREVIEW_SUMMARY_MAX_BYTES, `${bytes}`);
  assertEquals(out.counts.gaps, 400);
  assert(out.samples.omittedGaps > 0);
  assert(out.samples.gaps.every((gap) => gap.message.length <= 200));
  assertEquals(out.samples.gaps.length <= 8, true);
});

Deno.test("refusals pass through without evidence", async () => {
  const directory = await Deno.makeTempDir({ prefix: "buy-preview-facade-" });
  const out = await (await facade(directory, {
    status: "unresolved",
    reason: "synthetic refusal",
  })).execute(command([]));
  assertEquals(out, { status: "unresolved", reason: "synthetic refusal" });
});

Deno.test("named sections page with scoped cursors and full-evidence completes", async () => {
  const directory = await Deno.makeTempDir({ prefix: "buy-preview-facade-" });
  const { inputRefs, result } = await genuinePreviewResult({
    assumptions: Array.from({ length: 25 }, (_, i) => `synthetic assumption ${i}`),
  });
  const bounded = await facade(directory, result);
  const out = await bounded.execute(command(inputRefs));
  assertEquals(out.status, "preview");
  if (out.status !== "preview") return;
  const reader = new ReadBuyCostEstimatePreviewEvidence(store(directory));
  const query = {
    projectId: PREVIEW_TEST_PROJECT_ID,
    evidenceRef: out.evidenceRef,
  };
  const pricing = await reader.execute({ ...query, section: "pricing" });
  assertEquals(pricing.items.length, 1);
  const lines = await reader.execute({ ...query, section: "lines" });
  assertEquals(lines.items.length, result.bundle.lines.length);
  const terms = await reader.execute({ ...query, section: "annex-terms" });
  assertEquals(terms.items.length, 1);
  const sources = await reader.execute({ ...query, section: "source-evidence" });
  assertEquals(sources.items.length, 1);
  const first = await reader.execute({ ...query, section: "assumptions" });
  assertEquals(first.items.length, 20);
  assert(first.nextCursor !== null);
  const second = await reader.execute({
    ...query,
    section: "assumptions",
    cursor: first.nextCursor,
  });
  assertEquals(second.items.length, 5);
  assertEquals(second.nextCursor, null);
  const full = await reader.execute({ ...query, section: "full-evidence" });
  assertEquals(full.items.length, 1);
  assertEquals(
    (full.items[0] as { configurationDigest: string }).configurationDigest,
    result.configurationDigest,
  );
  await assertRejects(
    () => reader.execute({ ...query, section: "lines", cursor: first.nextCursor! }),
    TypeError,
    "invalid or foreign",
  );
  await assertRejects(
    () =>
      reader.execute({
        projectId: "foreign-project",
        evidenceRef: out.evidenceRef,
        section: "lines",
      }),
    TypeError,
    "unavailable or foreign",
  );
  await assertRejects(
    () => reader.execute({ ...query, section: "invented" }),
    TypeError,
    "must be one of",
  );
});

Deno.test("summary helper agrees with the bounded facade output", async () => {
  const { result } = await genuinePreviewResult();
  const ref = {
    schemaVersion: "buy-cost-estimate-preview-evidence-reference/1.0",
    projectId: PREVIEW_TEST_PROJECT_ID,
    fingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
    byteCount: 128,
  } as const;
  const out = summary(result as never, ref);
  assertEquals(out.evidenceRef, ref);
  assertEquals(out.evidenceBytes, 128);
  assertEquals(out.counts.terms, 1);
});
