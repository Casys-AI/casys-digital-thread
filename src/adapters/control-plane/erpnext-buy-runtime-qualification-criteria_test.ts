import { assertEquals, assertThrows } from "@std/assert";
import {
  assertErpnextBuyQualificationEvidence,
  ERPNEXT_BUY_QUALIFICATION_CRITERIA,
} from "./erpnext-buy-runtime-qualification-criteria.ts";
import { validateBuySourceCaptureEnvelope } from "../../domain/buy/buy-source-capture.ts";
import { BUY_FIXTURE_MODIFIED } from "../../domain/buy/buy-fixtures.ts";
import type { BuyDocumentRequest } from "../../domain/buy/buy-proposal.ts";

const EXACT_FIXTURE_DOCUMENTS: readonly BuyDocumentRequest[] = [
  {
    doctype: "Item",
    name: "ITEM-SYNTHETIC-001",
    expectedModified: BUY_FIXTURE_MODIFIED,
  },
  { doctype: "BOM", name: "BOM-SYNTHETIC-001" },
  { doctype: "Item Price", name: "ITEM-PRICE-SYNTHETIC-001" },
  { doctype: "Supplier Quotation", name: "SQ-SYNTHETIC-001" },
];

Deno.test("qualification criteria fingerprint the fixture-document identity recross", () => {
  assertEquals(
    ERPNEXT_BUY_QUALIFICATION_CRITERIA.returnedDocumentsMustEqualFixtureIdentities,
    true,
  );
  assertEquals(
    ERPNEXT_BUY_QUALIFICATION_CRITERIA.documentIdentityFields,
    ["doctype", "name"],
  );
  assertEquals(
    ERPNEXT_BUY_QUALIFICATION_CRITERIA
      .expectedModifiedComparedToCaptureModifiedAsExactErpLiteral,
    true,
  );
});

Deno.test("exact fixture documents against the frozen wrapper are accepted", async () => {
  const envelope = await frozenWrapper();
  const accepted = assertErpnextBuyQualificationEvidence(
    evidence(EXACT_FIXTURE_DOCUMENTS, envelope),
  );
  assertEquals(
    accepted.capture.documents.map((document) => ({
      doctype: document.doctype,
      name: document.name,
    })),
    EXACT_FIXTURE_DOCUMENTS.map((document) => ({
      doctype: document.doctype,
      name: document.name,
    })),
  );
});

Deno.test("same-site frozen wrapper for another document identity is rejected", async () => {
  const envelope = await frozenWrapper();
  assertThrows(
    () =>
      assertErpnextBuyQualificationEvidence(
        evidence([{
          doctype: "Item",
          name: "INTENTIONALLY-NOT-IN-RETURNED-CAPTURE",
        }], envelope),
      ),
    TypeError,
    "do not equal the fixture identities",
  );
});

Deno.test("missing or extra capture document identities are rejected", async () => {
  const envelope = await frozenWrapper();
  assertThrows(
    () =>
      assertErpnextBuyQualificationEvidence(
        evidence(EXACT_FIXTURE_DOCUMENTS.slice(0, 3), envelope),
      ),
    TypeError,
    "do not equal the fixture identities",
  );
  assertThrows(
    () =>
      assertErpnextBuyQualificationEvidence(
        evidence([
          ...EXACT_FIXTURE_DOCUMENTS,
          { doctype: "Supplier", name: "SUP-SYNTHETIC-001" },
        ], envelope),
      ),
    TypeError,
    "do not equal the fixture identities",
  );
});

Deno.test("expectedModified mismatch against the ERP modified literal is rejected", async () => {
  const envelope = await frozenWrapper();
  assertThrows(
    () =>
      assertErpnextBuyQualificationEvidence(
        evidence([{
          doctype: "Item",
          name: "ITEM-SYNTHETIC-001",
          expectedModified: "2026-09-01T08:00:00.000Z",
        }, {
          doctype: "BOM",
          name: "BOM-SYNTHETIC-001",
        }, {
          doctype: "Item Price",
          name: "ITEM-PRICE-SYNTHETIC-001",
        }, {
          doctype: "Supplier Quotation",
          name: "SQ-SYNTHETIC-001",
        }], envelope),
      ),
    TypeError,
    "expectedModified does not equal the captured ERP modified token",
  );
});

async function frozenWrapper() {
  const text = await Deno.readTextFile(
    new URL("../buy/fixtures/buy-source-capture.wrapper.json", import.meta.url),
  );
  return validateBuySourceCaptureEnvelope(JSON.parse(text));
}

function evidence(
  documents: readonly BuyDocumentRequest[],
  envelope: ReturnType<typeof validateBuySourceCaptureEnvelope>,
): Parameters<typeof assertErpnextBuyQualificationEvidence>[0] {
  return {
    profile: { sourceInstance: envelope.capture.sourceInstance },
    candidate: {
      installedSourceInstance: envelope.capture.sourceInstance,
      fixture: { documents },
    },
    envelope,
  } as Parameters<typeof assertErpnextBuyQualificationEvidence>[0];
}
