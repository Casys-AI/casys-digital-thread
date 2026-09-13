/**
 * Closed server-parsed ERP Buy qualification fixture.
 *
 * It names exact published document identities only. Probe tool and arguments
 * stay server-owned. Absence is an explicit non-qualified gap.
 */

import {
  arrayOf,
  closedRecord,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import {
  BUY_CLOSED_DOCTYPES,
  type BuyClosedDoctype,
} from "../../domain/buy/buy-source-capture.ts";
import type { BuyDocumentRequest } from "../../domain/buy/buy-proposal.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";

export const LOCAL_ERPNEXT_BUY_QUALIFICATION_FIXTURE_SCHEMA =
  "local-erpnext-buy-qualification-fixture/1.0" as const;

export const DEFAULT_LOCAL_ERPNEXT_BUY_QUALIFICATION_FIXTURE_PATH =
  "state/local/capability-runtime/erpnext-buy-qualification-fixture.json" as const;

export interface LocalErpnextBuyQualificationFixture {
  readonly schemaVersion: typeof LOCAL_ERPNEXT_BUY_QUALIFICATION_FIXTURE_SCHEMA;
  readonly id: string;
  readonly documents: readonly BuyDocumentRequest[];
  readonly boundary: string;
}

export type LocalErpnextBuyQualificationFixtureLoad =
  | { readonly status: "absent" }
  | {
    readonly status: "present";
    readonly fixture: LocalErpnextBuyQualificationFixture;
    readonly sourcePath: string;
  };

export async function loadLocalErpnextBuyQualificationFixture(
  options: { readonly path?: string } = {},
): Promise<LocalErpnextBuyQualificationFixtureLoad> {
  const sourcePath = options.path ??
    DEFAULT_LOCAL_ERPNEXT_BUY_QUALIFICATION_FIXTURE_PATH;
  let text: string;
  try {
    text = await Deno.readTextFile(sourcePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { status: "absent" };
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError(
      `ERP Buy qualification fixture at ${sourcePath} is not JSON.`,
    );
  }
  try {
    return {
      status: "present",
      sourcePath,
      fixture: parseLocalErpnextBuyQualificationFixture(parsed),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TypeError(
      `ERP Buy qualification fixture at ${sourcePath} is not a closed fixture: ${message}`,
    );
  }
}

export function parseLocalErpnextBuyQualificationFixture(
  value: unknown,
  path = "$erpnextBuyQualificationFixture",
): LocalErpnextBuyQualificationFixture {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new TypeError(`${path} is not JSON.`);
    }
  }
  const root = exactRecord(parsed, [
    "schemaVersion",
    "id",
    "documents",
    "boundary",
  ], path);
  literalValue(
    root.schemaVersion,
    LOCAL_ERPNEXT_BUY_QUALIFICATION_FIXTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const documents = arrayOf(root.documents, `${path}.documents`).map((
    document,
    index,
  ) => parseDocument(document, `${path}.documents[${index}]`));
  if (documents.length === 0) {
    throw new TypeError(`${path}.documents must not be empty.`);
  }
  rejectDuplicates(
    documents.map((document) => `${document.doctype}\u0000${document.name}`),
    `${path}.documents`,
  );
  return deepFreeze({
    schemaVersion: LOCAL_ERPNEXT_BUY_QUALIFICATION_FIXTURE_SCHEMA,
    id: safeId(root.id, `${path}.id`),
    documents,
    boundary: nonEmptyText(root.boundary, `${path}.boundary`),
  });
}

export function fingerprintLocalErpnextBuyQualificationFixture(
  fixture: LocalErpnextBuyQualificationFixture,
): Promise<ContentFingerprint> {
  return sha256Fingerprint({
    schemaVersion: fixture.schemaVersion,
    id: fixture.id,
    documents: fixture.documents,
    boundary: fixture.boundary,
  });
}

function parseDocument(value: unknown, path: string): BuyDocumentRequest {
  const root = closedRecord(
    value,
    ["doctype", "name", "expectedModified"],
    ["doctype", "name"],
    path,
  );
  if (
    typeof root.doctype !== "string" ||
    !(BUY_CLOSED_DOCTYPES as readonly string[]).includes(root.doctype)
  ) {
    throw new TypeError(`${path}.doctype must be a closed Buy doctype.`);
  }
  return {
    doctype: root.doctype as BuyClosedDoctype,
    name: nonEmptyText(root.name, `${path}.name`),
    ...(root.expectedModified === undefined || root.expectedModified === null ? {} : {
      expectedModified: nonEmptyText(
        root.expectedModified,
        `${path}.expectedModified`,
      ),
    }),
  };
}
