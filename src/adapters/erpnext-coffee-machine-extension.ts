import type {
  ContentFingerprint,
  ThreadFreshness,
  ThreadObservation,
  ThreadOperationRef,
} from "../domain/thread-snapshot.ts";
import type { ThreadSnapshotExtension } from "../domain/thread-snapshot-extension.ts";
import {
  COFFEE_MACHINE_ERPNEXT_SUBJECT_ID,
  countErpNextCoffeeMachineBinRows,
  parseObservedErpNextCoffeeMachineBom,
  type ProviderSubjectBinding,
  selectErpNextCoffeeMachineBom,
  selectErpNextCoffeeMachineBomItems,
} from "./erpnext-coffee-machine-observer.ts";

export interface ErpNextCoffeeMachineBomExtension extends ThreadSnapshotExtension {
  /** Stable provider identity, before workspace identity manifests map it. */
  providerSubject: ProviderSubjectBinding;
}

/** Persist the exact BOM child rows as a separately fingerprinted branch. */
export async function materializeErpNextCoffeeMachineBomDetailExtension(
  value: unknown,
  options: { sourceUri?: string } = {},
): Promise<ErpNextCoffeeMachineBomExtension> {
  const capture = parseObservedErpNextCoffeeMachineBom(value);
  const bom = selectErpNextCoffeeMachineBom(capture);
  const items = selectErpNextCoffeeMachineBomItems(capture);
  const stamp = compactTimestamp(capture.capturedAt);
  const detailFingerprint = fingerprint(
    await sha256(canonicalJson(capture.bomDetail)),
  );
  const artifactId = `erpnext-bom-detail-${idFragment(bom.name)}-${
    detailFingerprint.digest.slice(0, 12)
  }`;
  const operation: ThreadOperationRef = {
    serverId: "erpnext",
    tool: capture.bomDetail.tool,
    runId: `observed-${stamp}-bom-get`,
  };
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capture.capturedAt,
    invalidatedByChangeIds: [],
  };
  return {
    id: `capture-erpnext-bom-detail-${stamp}`,
    name: `Capture ERPNext BOM detail with ${items.length} component rows`,
    subjectId: COFFEE_MACHINE_ERPNEXT_SUBJECT_ID,
    capturedAt: capture.capturedAt,
    providerSubject: capture.providerSubject,
    bindingProofs: [capture.providerSubject],
    artifacts: [{
      id: artifactId,
      name: `ERPNext BOM ${bom.name} component detail`,
      kind: "bom",
      version: detailFingerprint.digest.slice(0, 12),
      fingerprint: detailFingerprint,
      ...(options.sourceUri ? { uri: `${options.sourceUri}#bomDetail` } : {}),
      producer: operation,
      inputArtifactIds: [],
      freshness,
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
}

/**
 * Project one observed ERPNext BOM/stock read into an independently attachable
 * ThreadSnapshot branch.
 *
 * No item-name inference happens here. The extension is intentionally targeted
 * at the provider subject and will be rejected by the generic assembler until
 * a workspace-declared identity manifest maps that provider identity to a
 * common CoffeeMachine subject.
 */
export async function materializeErpNextCoffeeMachineBomExtension(
  value: unknown,
  options: { sourceUri?: string } = {},
): Promise<ErpNextCoffeeMachineBomExtension> {
  const capture = parseObservedErpNextCoffeeMachineBom(value);
  const bom = selectErpNextCoffeeMachineBom(capture);
  const stockRows = countErpNextCoffeeMachineBinRows(capture);
  const stamp = compactTimestamp(capture.capturedAt);
  const bomFingerprint = fingerprint(await sha256(canonicalJson(capture.bom)));
  const stockFingerprint = fingerprint(
    await sha256(canonicalJson(capture.stock)),
  );
  const bomArtifactId = `erpnext-bom-${idFragment(bom.name)}-${
    bomFingerprint.digest.slice(0, 12)
  }`;
  const stockArtifactId = `erpnext-bin-query-${idFragment(capture.itemCode)}-${
    stockFingerprint.digest.slice(0, 12)
  }`;
  const bomOperation: ThreadOperationRef = {
    serverId: "erpnext",
    tool: capture.bom.tool,
    runId: `observed-${stamp}-bom-list`,
  };
  const stockOperation: ThreadOperationRef = {
    serverId: "erpnext",
    tool: capture.stock.tool,
    runId: `observed-${stamp}-stock-balance`,
  };
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capture.capturedAt,
    invalidatedByChangeIds: [],
  };
  const quantityObservationId = `erpnext-bom-quantity-${
    bomFingerprint.digest.slice(0, 12)
  }`;
  const stockRowsObservationId = `erpnext-bin-rows-${
    stockFingerprint.digest.slice(0, 12)
  }`;

  return {
    id: `capture-erpnext-coffee-machine-${stamp}`,
    name: "Capture ERPNext CoffeeMachine BOM and Bin query",
    subjectId: COFFEE_MACHINE_ERPNEXT_SUBJECT_ID,
    capturedAt: capture.capturedAt,
    providerSubject: capture.providerSubject,
    bindingProofs: [capture.providerSubject],
    artifacts: [
      {
        id: bomArtifactId,
        name: `ERPNext BOM ${bom.name} for ${capture.itemName}`,
        kind: "bom",
        version: bomFingerprint.digest.slice(0, 12),
        fingerprint: bomFingerprint,
        ...(options.sourceUri ? { uri: `${options.sourceUri}#bom` } : {}),
        producer: bomOperation,
        inputArtifactIds: [],
        freshness,
      },
      {
        id: stockArtifactId,
        name: `ERPNext Bin query for ${capture.itemCode}`,
        kind: "evidence",
        version: stockFingerprint.digest.slice(0, 12),
        fingerprint: stockFingerprint,
        ...(options.sourceUri ? { uri: `${options.sourceUri}#stock` } : {}),
        producer: stockOperation,
        inputArtifactIds: [],
        freshness,
      },
    ],
    consumptions: [],
    observations: [
      observation(
        quantityObservationId,
        "BOM quantity per finished good",
        "bom_quantity_per_finished_good",
        bom.quantity,
        bom.uom,
        bomOperation,
        bomArtifactId,
        capture.capturedAt,
        freshness,
      ),
      observation(
        stockRowsObservationId,
        `ERPNext Bin rows returned for ${capture.itemCode}`,
        "erpnext_bin_rows_returned",
        stockRows,
        "1",
        stockOperation,
        stockArtifactId,
        capture.capturedAt,
        freshness,
      ),
    ],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      derivedObservation(
        quantityObservationId,
        bomArtifactId,
        "The quantity was returned by the active default BOM list query.",
      ),
      derivedObservation(
        stockRowsObservationId,
        stockArtifactId,
        "This is the number of Bin rows returned by the item-filtered query, not an availability verdict.",
      ),
    ],
    proposedActions: [],
  };
}

function observation(
  id: string,
  name: string,
  metric: string,
  value: number,
  unit: string,
  operation: ThreadOperationRef,
  artifactId: string,
  capturedAt: string,
  freshness: ThreadFreshness,
): ThreadObservation {
  return {
    id,
    name,
    metric,
    quantity: { value, unit },
    source: { operation, artifactIds: [artifactId], capturedAt },
    freshness,
  };
}

function derivedObservation(
  observationId: string,
  artifactId: string,
  rationale: string,
) {
  return {
    id: `link-${observationId}-${artifactId}`,
    relation: "derived_from" as const,
    from: { kind: "observation" as const, id: observationId },
    to: { kind: "artifact" as const, id: artifactId },
    rationale,
  };
}

function fingerprint(digest: string): ContentFingerprint {
  return { algorithm: "sha256", digest };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return `{${
      Object.keys(input).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(input[key])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function compactTimestamp(value: string): string {
  return value.replace(/[-:.]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function idFragment(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}
