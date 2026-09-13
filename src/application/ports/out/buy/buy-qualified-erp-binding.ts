/** Exact qualified ERP Buy read binding. A fleet image tag is not this. */

import { COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY } from "../../../../domain/capability/engineering-capability.ts";
import type { BuySourceInstance } from "../../../../domain/buy/buy-source-capture.ts";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";

export interface BuyQualifiedErpBinding {
  readonly capability: typeof COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY;
  readonly qualification: "qualified";
  readonly sourceInstance: BuySourceInstance;
  readonly adapter: { readonly id: string; readonly version: string };
}

export type BuyQualifiedErpBindingResolution =
  | { readonly status: "qualified"; readonly binding: BuyQualifiedErpBinding }
  | { readonly status: "unresolved" | "unavailable"; readonly reason: string };

export interface BuyQualifiedErpBindingResolveInput {
  readonly project?: EngineeringProjectSnapshot;
}

export interface BuyQualifiedErpBindingResolver {
  resolve(
    input?: BuyQualifiedErpBindingResolveInput,
  ): Promise<BuyQualifiedErpBindingResolution>;
}
