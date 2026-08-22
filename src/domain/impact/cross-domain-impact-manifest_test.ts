import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  createCrossDomainImpactManifest,
  validateCrossDomainImpactManifest,
} from "./cross-domain-impact-manifest.ts";
import {
  documentDefinedCrossDomainImpactManifestBody,
  impactFingerprint,
  validCrossDomainImpactManifest,
  validCrossDomainImpactManifestBody,
} from "../../testing/cross-domain-impact-fixtures.ts";

Deno.test("cross-domain impact manifest accepts a closed canonical valid declaration", async () => {
  const manifest = await validCrossDomainImpactManifest();
  const reread = await validateCrossDomainImpactManifest(manifest);

  assertEquals(reread.schemaVersion, "cross-domain-impact-manifest/1.0");
  assertEquals(reread.changeKinds, ["brightness", "electrical-power"]);
  assertEquals(reread.branches.map((item) => item.id), [
    "electrical",
    "thermal",
    "mechanical",
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

Deno.test("cross-domain impact manifest rejects a caller-defined branch", async () => {
  const body = validCrossDomainImpactManifestBody();
  body.branches[2] = {
    id: "optical",
    version: "1.0",
    inputs: [{ id: "optical-input", fingerprint: impactFingerprint("a") }],
    method: { id: "optical-method", fingerprint: impactFingerprint("b") },
    joins: [{ id: "optical-join", fingerprint: impactFingerprint("c") }],
  } as never;

  await assertRejects(
    () => createCrossDomainImpactManifest(body),
    TypeError,
    "electrical, thermal or mechanical",
  );
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
