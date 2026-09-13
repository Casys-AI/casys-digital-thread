import { assertEquals } from "@std/assert";
import { ERPNEXT_BUY_CAPTURE_TOOL } from "../../domain/buy/buy-operations.ts";
import { BUY_FIXTURE_MODIFIED } from "../../domain/buy/buy-fixtures.ts";
import { ErpnextBuyCaptureClient } from "./erpnext-buy-capture-client.ts";

const FIXTURE_DOCUMENTS = [
  {
    doctype: "Item" as const,
    name: "ITEM-SYNTHETIC-001",
    expectedModified: BUY_FIXTURE_MODIFIED,
  },
  {
    doctype: "BOM" as const,
    name: "BOM-SYNTHETIC-001",
    expectedModified: BUY_FIXTURE_MODIFIED,
  },
  {
    doctype: "Item Price" as const,
    name: "ITEM-PRICE-SYNTHETIC-001",
    expectedModified: BUY_FIXTURE_MODIFIED,
  },
  {
    doctype: "Supplier Quotation" as const,
    name: "SQ-SYNTHETIC-001",
    expectedModified: BUY_FIXTURE_MODIFIED,
  },
];

Deno.test(
  "ErpnextBuyCaptureClient emits locked erpnext_buy_capture documents arguments",
  async () => {
    const sent: Array<{
      readonly name: string;
      readonly arguments?: Readonly<Record<string, unknown>>;
    }> = [];
    const wrapper = await loadProducerWrapper();
    const client = new ErpnextBuyCaptureClient({
      callTool(call) {
        sent.push(call);
        return Promise.resolve({ structuredContent: wrapper, text: "" });
      },
      callToolTextResult() {
        return Promise.reject(new Error("unused"));
      },
    });
    const envelope = await client.capture(FIXTURE_DOCUMENTS);
    assertEquals(sent.length, 1);
    assertEquals(sent[0]?.name, ERPNEXT_BUY_CAPTURE_TOOL);
    const args = sent[0]?.arguments ?? {};
    assertEquals(Object.keys(args), ["documents"]);
    assertEquals(args.documents, FIXTURE_DOCUMENTS);
    assertEquals(
      envelope.fingerprint,
      "sha256:aa33230c6af6abc929f1687ce6ffc00ccf920510e58efa3c53ec71f4dbbe9d5a",
    );
    const dump = Deno.env.get("BUY_DT_CAPTURE_INPUT_PATH");
    if (dump) {
      await Deno.writeTextFile(dump, `${JSON.stringify(args)}\n`);
    }
  },
);

async function loadProducerWrapper(): Promise<Record<string, unknown>> {
  const text = await Deno.readTextFile(
    new URL("./fixtures/buy-source-capture.wrapper.json", import.meta.url),
  );
  return JSON.parse(text.endsWith("\n") ? text.slice(0, -1) : text);
}
