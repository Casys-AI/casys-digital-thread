import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";
import {
  canonicalProviderResourceAcquisitionLedgerText,
  createProviderResourceRead,
  PROVIDER_RESOURCE_ACQUISITION_LEDGER_SCHEMA,
  validateExpectedProviderResource,
  validateProviderResourceAcquisitionLedger,
} from "./provider-resource-reader.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";

const expected = {
  uri: "artifact://modelica/run-1/result.csv",
  mediaType: "text/csv",
  byteCount: 3,
  sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
};

Deno.test("provider resource contract accepts only an exact canonical ledger tuple", () => {
  assertEquals(validateExpectedProviderResource(expected), expected);
  assertThrows(
    () => validateExpectedProviderResource({ ...expected, uri: "./result.csv" }),
    TypeError,
    "absolute canonical URI",
  );
  assertThrows(
    () =>
      validateExpectedProviderResource({
        ...expected,
        uri: "artifact://modelica/run-1/a/../result.csv",
      }),
    TypeError,
    "absolute canonical URI",
  );
  assertThrows(
    () => validateExpectedProviderResource({ ...expected, authority: true }),
    TypeError,
    "unsupported field authority",
  );
  assertThrows(
    () =>
      validateExpectedProviderResource({
        ...expected,
        mediaType: "Text/CSV",
      }),
    TypeError,
    "canonical media type",
  );
});

Deno.test("provider resource read hides backing storage and returns fresh copies", async () => {
  const source = new Uint8Array([1, 2, 3]);
  const result = await createProviderResourceRead(expected, source);
  source[0] = 9;
  const first = result.bytes.copy();
  first[1] = 9;
  const second = result.bytes.copy();

  assertEquals(first, new Uint8Array([1, 9, 3]));
  assertEquals(second, new Uint8Array([1, 2, 3]));
  assertNotEquals(first, second);
  assertEquals(result.attestation, {
    schemaVersion: "provider-resource-read-attestation/1.0",
    verification: "exact-content-match",
    ...expected,
  });
  assertEquals(Object.isFrozen(result.attestation), true);
});

Deno.test("provider resource read cannot attest bytes with a forged hash", async () => {
  await assertRejects(
    () =>
      createProviderResourceRead(
        { ...expected, sha256: "a".repeat(64) },
        new Uint8Array([1, 2, 3]),
      ),
    TypeError,
    "expected aaaaaaaaa",
  );
});

Deno.test("provider resource ledger is exact, role-sorted, canonical, and provider-bound", () => {
  const ledger = validateProviderResourceAcquisitionLedger({
    schemaVersion: PROVIDER_RESOURCE_ACQUISITION_LEDGER_SCHEMA,
    id: "ledger-1",
    provider: { id: "provider-1", runId: "run-1" },
    resources: [
      { role: "z-result", ...expected },
      {
        role: "a-log",
        ...expected,
        uri: "artifact://modelica/run-1/log.txt",
      },
    ],
  });
  assertEquals(ledger.resources.map((resource) => resource.role), [
    "a-log",
    "z-result",
  ]);
  assertEquals(
    canonicalProviderResourceAcquisitionLedgerText(ledger),
    deterministicJson(ledger),
  );
  assertThrows(
    () =>
      validateProviderResourceAcquisitionLedger({
        ...ledger,
        resources: [...ledger.resources, ledger.resources[0]],
      }),
    TypeError,
    "roles",
  );
});

Deno.test("provider resource ledger sorts roles by ASCII code units", () => {
  const ledger = validateProviderResourceAcquisitionLedger({
    schemaVersion: PROVIDER_RESOURCE_ACQUISITION_LEDGER_SCHEMA,
    id: "ledger-ascii-order",
    provider: { id: "provider-1", runId: "run-1" },
    resources: [
      { role: "i-role", ...expected, uri: "artifact://modelica/run-1/i.bin" },
      { role: "J-role", ...expected, uri: "artifact://modelica/run-1/j.bin" },
      { role: "I-role", ...expected, uri: "artifact://modelica/run-1/I.bin" },
    ],
  });

  assertEquals(ledger.resources.map((resource) => resource.role), [
    "I-role",
    "J-role",
    "i-role",
  ]);
});
