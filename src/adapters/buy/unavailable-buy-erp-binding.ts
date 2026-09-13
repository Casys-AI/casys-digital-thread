/**
 * Live Buy ERP binding resolver. No fleet image tag is treated as
 * qualification. Root adopts a qualified binding separately.
 */

import type {
  BuyQualifiedErpBindingResolution,
  BuyQualifiedErpBindingResolver,
} from "../../application/ports/out/buy/buy-qualified-erp-binding.ts";
import { COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY } from "../../domain/capability/engineering-capability.ts";

export const BUY_ERPNEXT_BINDING_UNAVAILABLE_REASON =
  `No qualified binding is registered for ${COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY.id}@${COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY.version}. ` +
  "A legacy fleet image tag or source version is not qualification. Capture remains unresolved and will not dispatch.";

export class UnavailableBuyQualifiedErpBindingResolver
  implements BuyQualifiedErpBindingResolver {
  resolve(): Promise<BuyQualifiedErpBindingResolution> {
    return Promise.resolve({
      status: "unresolved",
      reason: BUY_ERPNEXT_BINDING_UNAVAILABLE_REASON,
    });
  }
}
