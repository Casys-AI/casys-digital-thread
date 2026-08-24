import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  createCrossDomainImpactManifest,
  validateCrossDomainImpactManifest,
} from "./cross-domain-impact-manifest.ts";
import {
  documentDefinedCrossDomainImpactManifestBody,
  impactFingerprint,
  motionDeclaredCrossDomainImpactManifestBody,
  validCrossDomainImpactManifest,
  validCrossDomainImpactManifestBody,
} from "../../testing/cross-domain-impact-fixtures.ts";

Deno.test("cross-domain impact manifest accepts a closed canonical valid declaration", async () => {
  const manifest = await validCrossDomainImpactManifest();
  const reread = await validateCrossDomainImpactManifest(manifest);

  assertEquals(reread.schemaVersion, "cross-domain-impact-manifest/2.0");
  assertEquals(reread.changeKinds, ["brightness", "electrical-power"]);
  assertEquals(reread.branches.map((item) => item.id), [
    "electrical",
    "mechanical",
    "thermal",
  ]);
  assert(Object.isFrozen(reread));
});

Deno.test("cross-domain impact manifest rejects extra keys and duplicate canonical entries", async () => {
  const extra = validCrossDomainImpactManifestBody();
  Object.assign(extra, { unreviewed: true });
  await assertRejects(
    () => createCrossDomainImpactManifest(extra),
    TypeError,
    "unsupported field",
  );

  const duplicate = validCrossDomainImpactManifestBody();
  duplicate.gateMap.push({
    gateItemId: "gate-electrical",
    branchId: "thermal" as const,
    role: "contributes-to" as const,
  });
  await assertRejects(
    () => createCrossDomainImpactManifest(duplicate),
    TypeError,
    "must not contain duplicates",
  );
});

Deno.test("cross-domain impact manifest accepts a declared nonmechanical branch such as motion", async () => {
  const body = motionDeclaredCrossDomainImpactManifestBody();
  const manifest = await createCrossDomainImpactManifest(body);
  const reread = await validateCrossDomainImpactManifest(manifest);

  assertEquals(reread.branches.map((item) => item.id), [
    "electrical",
    "mechanical",
    "motion",
    "thermal",
  ]);
});

Deno.test("cross-domain impact manifest rejects an independence assertion for a nonmechanical branch", async () => {
  const body = validCrossDomainImpactManifestBody();
  body.independenceAssertions[0]!.branchId = "thermal";

  await assertRejects(
    () => createCrossDomainImpactManifest(body),
    TypeError,
    "legal only for the mechanical branch",
  );

  const motion = motionDeclaredCrossDomainImpactManifestBody();
  motion.independenceAssertions[0]!.branchId = "motion";
  await assertRejects(
    () => createCrossDomainImpactManifest(motion),
    TypeError,
    "legal only for the mechanical branch",
  );
});

Deno.test("cross-domain impact manifest rejects an undeclared branch on an edge or gateMap", async () => {
  const extraGate = validCrossDomainImpactManifestBody();
  extraGate.gateMap.push({
    gateItemId: "gate-optical",
    branchId: "optical",
    role: "satisfies",
  });
  await assertRejects(
    () => createCrossDomainImpactManifest(extraGate),
    TypeError,
    "unknown branch",
  );

  const extraEdge = validCrossDomainImpactManifestBody();
  extraEdge.causalEdges.push({
    id: "edge-power-optical",
    fromAnchorId: "anchor-electrical-power",
    to: {
      branchId: "optical",
      inputId: "electrical-power-input",
      inputFingerprint: impactFingerprint("b"),
    },
    relation: "positive-input" as const,
    assertion: {
      source: { id: "source-power-optical", fingerprint: impactFingerprint("c") },
      justification: "Reviewed source states the exact branch input relation.",
    },
    scope: "Exact manifest basis only.",
    evidence: [{ id: "source-power-optical", fingerprint: impactFingerprint("c") }],
  });
  await assertRejects(
    () => createCrossDomainImpactManifest(extraEdge),
    TypeError,
    "exact declared branch input fingerprint",
  );
});

Deno.test("cross-domain impact manifest rejects a declared branch without a gateMap entry", async () => {
  const body = motionDeclaredCrossDomainImpactManifestBody();
  body.gateMap = body.gateMap.filter((item) => item.branchId !== "motion");

  await assertRejects(
    () => createCrossDomainImpactManifest(body),
    TypeError,
    "must have at least one canonical gateMap entry",
  );
});

Deno.test("cross-domain impact manifest rejects an empty or unsafe branch id", async () => {
  for (const id of ["", " ", "mass change", "mass/change", "-motion"]) {
    const body = validCrossDomainImpactManifestBody();
    body.branches[0] = { ...body.branches[0]!, id };
    await assertRejects(() => createCrossDomainImpactManifest(body), TypeError);
  }
});

Deno.test("cross-domain impact manifest requires every exact source fingerprint", async () => {
  const body = validCrossDomainImpactManifestBody();
  delete (body.sourceAnchors[0]!.source as { fingerprint?: unknown }).fingerprint;

  await assertRejects(
    () => createCrossDomainImpactManifest(body),
    TypeError,
    "fingerprint is required",
  );
});

Deno.test("cross-domain impact manifest recomputes and rejects a mismatched body fingerprint", async () => {
  const manifest = await validCrossDomainImpactManifest();
  const forged = structuredClone(manifest) as unknown as Record<string, unknown>;
  forged.id = "impact-manifest-led-forged";

  await assertRejects(
    () => validateCrossDomainImpactManifest(forged),
    TypeError,
    "canonical manifest body",
  );
});

Deno.test("cross-domain impact manifest canonicalizes document-defined change kinds lexicographically", async () => {
  const body = documentDefinedCrossDomainImpactManifestBody();
  const manifest = await createCrossDomainImpactManifest(body);
  const reread = await validateCrossDomainImpactManifest(manifest);

  assertEquals(reread.changeKinds, ["geometry-change", "mass-change"]);
  assertEquals(
    reread.sourceAnchors.map((anchor) => anchor.changeKind).toSorted(),
    ["geometry-change", "mass-change"],
  );
});

Deno.test("cross-domain impact manifest rejects empty or unsafe causal change kinds", async () => {
  for (const changeKind of ["", " ", "mass change", "mass/change", "-mass"]) {
    const listed = documentDefinedCrossDomainImpactManifestBody();
    listed.changeKinds[0] = changeKind;
    await assertRejects(() => createCrossDomainImpactManifest(listed), TypeError);

    const anchored = documentDefinedCrossDomainImpactManifestBody();
    anchored.sourceAnchors[0] = {
      ...anchored.sourceAnchors[0]!,
      changeKind,
    };
    await assertRejects(() => createCrossDomainImpactManifest(anchored), TypeError);
  }
});

Deno.test("cross-domain impact manifest rejects a source anchor for an undeclared semantic change kind", async () => {
  const body = validCrossDomainImpactManifestBody();
  body.changeKinds = ["electrical-power"];

  await assertRejects(
    () => createCrossDomainImpactManifest(body),
    TypeError,
    "absent from $manifest.changeKinds",
  );
});
