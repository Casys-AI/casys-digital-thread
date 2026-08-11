/**
 * Reviewed workspace identities shared by CM-01 executors and read projectors.
 *
 * These values live in the domain so a writer never imports a UI/read adapter,
 * and so the same component cannot silently acquire two server-fixed IDs.
 */

const DRIP_TRAY_COMPONENT_ID = "cm01-v3:drip-tray" as const;

export const CM01_V3_PRODUCT_STRUCTURE_IDENTITIES = Object.freeze({
  dripTray: Object.freeze({
    componentId: DRIP_TRAY_COMPONENT_ID,
    semanticRef: Object.freeze({
      domain: "thread" as const,
      kind: "component" as const,
      id: DRIP_TRAY_COMPONENT_ID,
    }),
    provider: "syson" as const,
    bindingKind: "part-definition" as const,
  }),
});
