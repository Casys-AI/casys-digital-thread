/**
 * Recross a buy-configuration/1.0 against the workspace-declared catalogue.
 *
 * Catalogue `erpnext:item` bindings are declarations, not attested mappings.
 * Missing occurrence, item, quantity or UOM identity becomes an explicit gap.
 */

import type { ThreadComponentCatalog } from "../thread/thread-component-catalog.ts";
import {
  type BuyConfiguration,
  type BuyConfigurationGap,
  type BuyConfigurationLine,
} from "./buy-configuration.ts";
import { addBuyDecimals } from "./buy-decimal.ts";

export function recrossBuyConfigurationCatalog(
  configuration: BuyConfiguration,
  catalog: ThreadComponentCatalog | undefined,
): readonly BuyConfigurationGap[] {
  const gaps: BuyConfigurationGap[] = [...configuration.gaps];
  if (!catalog) {
    gaps.push({
      code: "catalog-not-proof",
      message:
        "No workspace-declared component catalogue is bound; catalogue identity is not a mapping proof.",
    });
    for (const line of configuration.lines) {
      gaps.push(...line.gaps);
      if (line.occurrences.length === 0) {
        gaps.push({
          code: "occurrence-unresolved",
          message: `Configuration line ${line.id} has no sourced occurrence identity.`,
          lineId: line.id,
        });
      }
    }
    return gaps;
  }
  if (catalog.authority !== "workspace-declared") {
    gaps.push({
      code: "catalog-not-proof",
      message: "Component catalogue authority is not workspace-declared.",
    });
  }
  if (catalog.subjectId !== configuration.subjectId) {
    gaps.push({
      code: "part-definition-unresolved",
      message: "Component catalogue subject does not match the configuration subject.",
    });
  }
  for (const line of configuration.lines) {
    gaps.push(...recrossLine(line, catalog));
  }
  return gaps;
}

function recrossLine(
  line: BuyConfigurationLine,
  catalog: ThreadComponentCatalog,
): readonly BuyConfigurationGap[] {
  const gaps: BuyConfigurationGap[] = [];
  const component = catalog.components.find((item) =>
    item.bindings.some((binding) =>
      binding.provider === "syson" &&
      binding.kind === "part-definition" &&
      binding.id === line.partDefinition.elementId
    ) || item.id === line.partDefinition.elementId
  );
  if (!component) {
    gaps.push({
      code: "part-definition-unresolved",
      message:
        `PartDefinition ${line.partDefinition.elementId} is not in the workspace-declared catalogue.`,
      lineId: line.id,
    });
  }
  if (line.occurrences.length === 0) {
    gaps.push({
      code: "occurrence-unresolved",
      message: `Configuration line ${line.id} has no sourced occurrence identity.`,
      lineId: line.id,
    });
  }
  const uoms = new Set(line.occurrences.map((occurrence) => occurrence.uom));
  if (uoms.size > 1 || (uoms.size === 1 && !uoms.has(line.uom))) {
    gaps.push({
      code: "uom-incompatible",
      message:
        `Configuration line ${line.id} mixes occurrence UOMs without a sourced conversion.`,
      lineId: line.id,
    });
  } else if (line.occurrences.length > 0 && uoms.size === 1) {
    const rolled = line.occurrences.reduce(
      (sum, occurrence) => addBuyDecimals(sum, occurrence.quantity),
      "0",
    );
    if (rolled !== line.quantity) {
      gaps.push({
        code: "quantity-unresolved",
        message:
          `Configuration line ${line.id} quantity ${line.quantity} is not the sourced occurrence sum ${rolled}.`,
        lineId: line.id,
      });
    }
  }
  const catalogItem = component?.bindings.find((binding) =>
    binding.provider === "erpnext" && binding.kind === "item"
  );
  if (line.item?.authority === "catalog-declared") {
    gaps.push({
      code: "catalog-not-proof",
      message:
        `Catalogue erpnext:item ${line.item.name} is workspace-declared, not an attested ERP mapping.`,
      lineId: line.id,
    });
  }
  if (line.sourcing === "buy" && !line.item && !catalogItem) {
    gaps.push({
      code: "item-mapping-unresolved",
      message: `Configuration line ${line.id} has no ERP Item mapping.`,
      lineId: line.id,
    });
  }
  return gaps;
}
