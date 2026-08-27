/**
 * Opaque, content-addressed reference to one captured CAD source and its
 * passive source analysis. The parser lives in the domain because drafts,
 * canonical captures and the reopening adapter all share this exact identity.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../kernel/case-validation.ts";
import { sha256Hex } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

export type GeometrySourceSelector =
  | { readonly kind: "assembly" }
  | { readonly kind: "part-definition"; readonly elementId: string };

export interface GeometrySourceAnalysisReference {
  readonly sourceId: string;
  readonly selector: GeometrySourceSelector;
  readonly sourceFingerprint: ContentFingerprint;
  readonly sourceCaptureFingerprint: ContentFingerprint;
  readonly analysisFingerprint: ContentFingerprint;
}

export function parseGeometrySourceSelector(
  value: unknown,
  path = "$geometrySourceSelector",
): GeometrySourceSelector {
  const candidate = value !== null && typeof value === "object" &&
      !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  if (candidate?.kind === "assembly") {
    exactRecord(value, ["kind"], path);
    return deepFreeze({ kind: "assembly" as const });
  }
  const selector = exactRecord(value, ["kind", "elementId"], path);
  if (selector.kind !== "part-definition") {
    throw new TypeError(`${path}.kind must be assembly or part-definition.`);
  }
  return deepFreeze({
    kind: "part-definition" as const,
    // Provider element ids are opaque. Do not narrow them to the Casys safe-id
    // alphabet; only their non-empty, exact bytes are authoritative.
    elementId: nonEmptyText(selector.elementId, `${path}.elementId`),
  });
}

export async function geometrySourceIdFor(
  selector: GeometrySourceSelector,
): Promise<string> {
  const exact = parseGeometrySourceSelector(selector);
  if (exact.kind === "assembly") return "cad-assembly";
  const digest = await sha256Hex(new TextEncoder().encode(exact.elementId));
  return `cad-part-definition:${digest}`;
}

export async function parseGeometrySourceAnalysisReference(
  value: unknown,
  path = "$geometrySourceAnalysisReference",
): Promise<GeometrySourceAnalysisReference> {
  const reference = exactRecord(
    value,
    [
      "sourceId",
      "selector",
      "sourceFingerprint",
      "sourceCaptureFingerprint",
      "analysisFingerprint",
    ],
    path,
  );
  const selector = parseGeometrySourceSelector(
    reference.selector,
    `${path}.selector`,
  );
  const sourceId = safeId(reference.sourceId, `${path}.sourceId`);
  if (sourceId !== await geometrySourceIdFor(selector)) {
    throw new TypeError(`${path}.sourceId does not match the exact selector.`);
  }
  return deepFreeze({
    sourceId,
    selector,
    sourceFingerprint: parseContentFingerprint(
      reference.sourceFingerprint,
      `${path}.sourceFingerprint`,
    ),
    sourceCaptureFingerprint: parseContentFingerprint(
      reference.sourceCaptureFingerprint,
      `${path}.sourceCaptureFingerprint`,
    ),
    analysisFingerprint: parseContentFingerprint(
      reference.analysisFingerprint,
      `${path}.analysisFingerprint`,
    ),
  });
}

function parseContentFingerprint(
  value: unknown,
  path: string,
): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  if (
    typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return { algorithm: "sha256", digest: fingerprint.digest };
}
