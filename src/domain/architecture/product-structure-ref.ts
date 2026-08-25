/**
 * Exact SysML product-structure identities.
 *
 * Labels never join or authorize. The unique product root is a
 * PartDefinition element, never an occurrence. A PartUsage occurrence always
 * has a nonempty path ending in its elementId. Graphology may index these
 * refs; it does not own them.
 */

import {
  deepFreeze,
  exactRecord,
  nonEmptyText,
  safeId,
} from "../kernel/case-validation.ts";

export const PRODUCT_STRUCTURE_ELEMENT_KINDS = [
  "PartDefinition",
  "PartUsage",
] as const;

export type ProductStructureElementKind =
  typeof PRODUCT_STRUCTURE_ELEMENT_KINDS[number];

export interface ProductStructureElementRef {
  readonly elementKind: ProductStructureElementKind;
  readonly elementId: string;
}

export interface ProductStructureOccurrenceRef {
  readonly element: ProductStructureElementRef;
  readonly path: readonly string[];
}

export function productStructureElementRef(
  elementKind: ProductStructureElementKind,
  elementId: string,
): ProductStructureElementRef {
  return parseProductStructureElementRef(
    { elementKind, elementId },
    "$element",
  );
}

export function productStructureOccurrenceRef(input: {
  readonly element: ProductStructureElementRef | {
    readonly elementKind: ProductStructureElementKind;
    readonly elementId: string;
  };
  readonly path: readonly string[];
}): ProductStructureOccurrenceRef {
  return parseProductStructureOccurrenceRef(
    {
      element: input.element,
      path: [...input.path],
    },
    "$occurrence",
  );
}

export function parseProductStructureElementRef(
  value: unknown,
  path: string,
): ProductStructureElementRef {
  const rec = exactRecord(value, ["elementKind", "elementId"], path);
  const elementKind = parseElementKind(rec.elementKind, `${path}.elementKind`);
  const elementId = parseElementId(rec.elementId, `${path}.elementId`);
  return deepFreeze({ elementKind, elementId });
}

export function parseProductStructureOccurrenceRef(
  value: unknown,
  path: string,
): ProductStructureOccurrenceRef {
  const rec = exactRecord(value, ["element", "path"], path);
  const element = parseProductStructureElementRef(rec.element, `${path}.element`);
  if (element.elementKind !== "PartUsage") {
    throw new TypeError(
      `${path} is a PartUsage occurrence only. A PartDefinition is an element, never an occurrence.`,
    );
  }
  if (!Array.isArray(rec.path)) {
    throw new TypeError(`${path}.path must be an array.`);
  }
  if (rec.path.length === 0) {
    throw new TypeError(
      `${path} a PartUsage occurrence path must be nonempty.`,
    );
  }
  const occurrencePath = rec.path.map((segment, index) =>
    parseElementId(segment, `${path}.path[${index}]`)
  );
  if (occurrencePath[occurrencePath.length - 1] !== element.elementId) {
    throw new TypeError(
      `${path} a PartUsage occurrence path must end with its elementId.`,
    );
  }
  return deepFreeze({
    element,
    path: Object.freeze([...occurrencePath]),
  });
}

export function productStructureElementRefsEqual(
  left: ProductStructureElementRef,
  right: ProductStructureElementRef,
): boolean {
  return left.elementKind === right.elementKind &&
    left.elementId === right.elementId;
}

export function productStructureOccurrenceRefsEqual(
  left: ProductStructureOccurrenceRef,
  right: ProductStructureOccurrenceRef,
): boolean {
  return productStructureElementRefsEqual(left.element, right.element) &&
    left.path.length === right.path.length &&
    left.path.every((segment, index) => segment === right.path[index]);
}

function parseElementKind(
  value: unknown,
  path: string,
): ProductStructureElementKind {
  if (value !== "PartDefinition" && value !== "PartUsage") {
    throw new TypeError(
      `${path} must be PartDefinition or PartUsage.`,
    );
  }
  return value;
}

function parseElementId(value: unknown, path: string): string {
  const id = safeId(nonEmptyText(value, path), path);
  if (id.toLowerCase() === "latest") {
    throw new TypeError(`${path} cannot use a latest alias.`);
  }
  return id;
}
