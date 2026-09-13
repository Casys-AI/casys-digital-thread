/** Registered Buy evidence operations. Capture reads ERP; seal does not. */

export const BUY_CAPTURE_CONFIGURATION_COST_OPERATION = {
  id: "buy.capture-configuration-cost",
  version: "1",
} as const;

export const BUY_SEAL_CONFIGURATION_COST_OPERATION = {
  id: "buy.seal-configuration-cost",
  version: "1",
} as const;

export const BUY_CAPTURE_CONFIGURATION_COST_TOOL =
  `${BUY_CAPTURE_CONFIGURATION_COST_OPERATION.id}@${BUY_CAPTURE_CONFIGURATION_COST_OPERATION.version}` as const;

export const BUY_SEAL_CONFIGURATION_COST_TOOL =
  `${BUY_SEAL_CONFIGURATION_COST_OPERATION.id}@${BUY_SEAL_CONFIGURATION_COST_OPERATION.version}` as const;

/** Server-owned provider tool lock. Callers cannot select a different tool. */
export const ERPNEXT_BUY_CAPTURE_TOOL = "erpnext_buy_capture" as const;
