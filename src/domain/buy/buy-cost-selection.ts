/**
 * Server-owned cost line selection from captured ERP documents.
 * Callers cannot supply an attested sourceInstance or fingerprint.
 * Child row identity is the provider row `name`, never a DT-invented hash.
 */

import type { BuyConfiguration } from "./buy-configuration.ts";
import type { BuyCostSelection } from "./buy-cost-bundle.ts";
import type { BuySourceCaptureEnvelope } from "./buy-source-capture.ts";

export function selectBuyCostLines(
  configuration: BuyConfiguration,
  captures: readonly BuySourceCaptureEnvelope[],
): readonly BuyCostSelection[] {
  return configuration.lines.map((line) => {
    if (!line.item) {
      return { configurationLineId: line.id, costClass: "estimate" };
    }
    for (const envelope of captures) {
      for (const document of envelope.capture.documents) {
        if (
          document.doctype === "Item Price" &&
          document.fields.item_code === line.item.name
        ) {
          return {
            configurationLineId: line.id,
            costClass: "catalogue",
            citation: {
              kind: "erp-attested",
              sourceInstance: envelope.capture.sourceInstance,
              captureFingerprint: envelope.fingerprint,
              document: { doctype: document.doctype, name: document.name },
              modified: document.modified,
              documentFingerprint: document.fingerprint,
            },
          };
        }
        if (document.doctype === "Supplier Quotation") {
          for (const table of document.children ?? []) {
            const row = table.rows.find((item) =>
              item.fields.item_code === line.item!.name
            );
            if (row) {
              return {
                configurationLineId: line.id,
                costClass: "quotation",
                citation: {
                  kind: "erp-attested",
                  sourceInstance: envelope.capture.sourceInstance,
                  captureFingerprint: envelope.fingerprint,
                  document: { doctype: document.doctype, name: document.name },
                  modified: document.modified,
                  documentFingerprint: document.fingerprint,
                  rowName: row.name,
                },
              };
            }
          }
        }
      }
    }
    return { configurationLineId: line.id, costClass: "estimate" };
  });
}
