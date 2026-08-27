import { assertEquals, assertNotEquals } from "@std/assert";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";
import { createModelicaMicrosandboxQualificationKit } from "./qualification-kit.ts";

Deno.test("Modelica qualification kit derives every authority digest from exact code-owned documents", async () => {
  const kit = await createModelicaMicrosandboxQualificationKit({
    name: "OpenModelica",
    version: "1.27.0",
    mslVersion: "4.1.0",
  });
  assertEquals(
    kit.bundle.document.qualification.caseSha256,
    (await sha256Fingerprint(kit.basis.case)).digest,
  );
  assertEquals(
    kit.bundle.document.qualification.manifestSha256,
    (await sha256Fingerprint(kit.basis.manifest)).digest,
  );
  assertEquals(
    kit.bundle.document.qualification.sourceCaptureSha256,
    (await sha256Fingerprint(kit.basis.sourceCapture)).digest,
  );
  assertNotEquals(kit.bundle.document.qualification.caseSha256, "a".repeat(64));
  assertNotEquals(kit.bundle.document.qualification.manifestSha256, "b".repeat(64));
  assertNotEquals(
    kit.bundle.document.qualification.sourceCaptureSha256,
    "c".repeat(64),
  );
});
