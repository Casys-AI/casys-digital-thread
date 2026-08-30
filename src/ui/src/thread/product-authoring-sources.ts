/**
 * Read-only browser client for exact ProjectSourceWorkspace authoring heads.
 * This is deliberately separate from `thread.sourceFiles`, which records
 * admitted Thread source evidence rather than live authoring attachments.
 */
import type { ThreadFetch } from "./client.ts";
import type { ThreadComponent } from "./types.ts";

export type ProductAuthoringSourceKind = "part-definition" | "part-usage";
export type ProductAuthoringSourceReadStatus =
  | "observed"
  | "unavailable"
  | "unattached"
  | "unresolved";

export interface ProductAuthoringSourceSelection {
  readonly kind: ProductAuthoringSourceKind;
  readonly id: string;
}

export interface ProductAuthoringSourceAttachment {
  readonly attachmentId: string;
  readonly attachmentRevision: number;
  readonly fileId: string;
  readonly fileHeadRevision: number | null;
  readonly sourceStatus: "active" | "source-removed";
  readonly role: { readonly id: string; readonly version: number };
  readonly target: {
    readonly elementKind: "PartDefinition" | "PartUsage";
    readonly elementId: string;
  };
  readonly basisStatus: "exact-basis" | "different-basis";
}

export interface ProductAuthoringSourcePage {
  readonly status: ProductAuthoringSourceReadStatus;
  readonly attachments: readonly ProductAuthoringSourceAttachment[];
}

export interface ProductAuthoringSourceClient {
  load(
    selection: ProductAuthoringSourceSelection,
    signal?: AbortSignal,
  ): Promise<ProductAuthoringSourcePage>;
}

/** Keeps distinct PartDefinition and PartUsage identities; labels never join. */
export function authoringSourceSelectionsForComponent(
  component: ThreadComponent,
): readonly ProductAuthoringSourceSelection[] {
  const known = new Set<string>();
  return component.bindings.flatMap((binding) => {
    if (
      binding.provider !== "syson" ||
      (binding.kind !== "part-definition" && binding.kind !== "part-usage")
    ) return [];
    const key = `${binding.kind}:${binding.id}`;
    if (known.has(key)) return [];
    known.add(key);
    return [{ kind: binding.kind, id: binding.id }];
  });
}

/** Only an exact attachment revision is a duplicate; file IDs are not. */
export function mergeAuthoringSourcePages(
  pages: readonly ProductAuthoringSourcePage[],
): readonly ProductAuthoringSourceAttachment[] {
  const attachments = new Map<string, ProductAuthoringSourceAttachment>();
  for (const page of pages) {
    if (page.status !== "observed") continue;
    for (const attachment of page.attachments) {
      const key = `${attachment.attachmentId}@${attachment.attachmentRevision}`;
      if (!attachments.has(key)) attachments.set(key, attachment);
    }
  }
  return [...attachments.values()];
}

type DecodedPage = ProductAuthoringSourcePage & {
  readonly nextCursor: string | null;
  readonly workspaceRevision?: number;
};

/** A small, injectable GET reader; it has no command or MCP surface. */
export class HttpProductAuthoringSourceClient
  implements ProductAuthoringSourceClient {
  constructor(
    private readonly endpoint = "/api/thread/product-navigation",
    private readonly fetcher: ThreadFetch = globalThis.fetch.bind(globalThis),
  ) {}

  async load(
    selection: ProductAuthoringSourceSelection,
    signal?: AbortSignal,
  ): Promise<ProductAuthoringSourcePage> {
    const attachments: ProductAuthoringSourceAttachment[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let workspaceRevision: number | undefined;

    while (true) {
      const page = await this.readPage(selection, cursor, signal);
      if (page.status !== "observed") return page;
      if (
        workspaceRevision !== undefined &&
        workspaceRevision !== page.workspaceRevision
      ) {
        throw new Error("Authoring-source pages changed during one read.");
      }
      workspaceRevision = page.workspaceRevision;
      attachments.push(...page.attachments);
      if (page.nextCursor === null) break;
      if (cursors.has(page.nextCursor)) {
        throw new Error("Authoring-source pagination repeated a cursor.");
      }
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    return { status: "observed", attachments };
  }

  private async readPage(
    selection: ProductAuthoringSourceSelection,
    cursor: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<DecodedPage> {
    const query = new URLSearchParams({
      view: "authoring-attachments",
      kind: selection.kind,
      id: selection.id,
      pageSize: "50",
      ...(cursor === undefined ? {} : { cursor }),
    });
    const response = await this.fetcher(`${this.endpoint}?${query}`, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new Error(`Authoring sources HTTP ${response.status}.`);
    }
    return decodePage(await response.json(), selection);
  }
}

function decodePage(
  value: unknown,
  selection: ProductAuthoringSourceSelection,
): DecodedPage {
  if (!isRecord(value) || value.schemaVersion !== "product-inspect/1.0") {
    throw new Error("Unsupported authoring-source contract.");
  }
  if (!isReadStatus(value.status)) {
    throw new Error("Invalid authoring-source status.");
  }
  if (value.status !== "observed") {
    return { status: value.status, attachments: [], nextCursor: null };
  }
  if (!isRecord(value.authoringAttachments)) {
    throw new Error("Authoring-source attachment page is missing.");
  }
  const { attachments, nextCursor, workspaceRevision } =
    value.authoringAttachments;
  if (
    !Array.isArray(attachments) ||
    !isPositiveRevision(workspaceRevision) ||
    (nextCursor !== null && typeof nextCursor !== "string")
  ) {
    throw new Error("Invalid authoring-source attachment page.");
  }
  return {
    status: "observed",
    workspaceRevision,
    nextCursor,
    attachments: attachments.map((attachment) =>
      decodeAttachment(attachment, selection)
    ),
  };
}

function decodeAttachment(
  value: unknown,
  selection: ProductAuthoringSourceSelection,
): ProductAuthoringSourceAttachment {
  if (!isRecord(value) || !isRecord(value.role) || !isRecord(value.target)) {
    throw new Error("Invalid authoring-source attachment.");
  }
  const { role, target } = value;
  const expectedKind = selection.kind === "part-definition"
    ? "PartDefinition"
    : "PartUsage";
  if (
    typeof value.attachmentId !== "string" ||
    !isPositiveRevision(value.attachmentRevision) ||
    typeof value.fileId !== "string" ||
    (value.fileHeadRevision !== null &&
      !isPositiveRevision(value.fileHeadRevision)) ||
    (value.sourceStatus !== "active" &&
      value.sourceStatus !== "source-removed") ||
    typeof role.id !== "string" ||
    !isPositiveRevision(role.version) ||
    target.elementKind !== expectedKind ||
    target.elementId !== selection.id ||
    (value.basisStatus !== "exact-basis" &&
      value.basisStatus !== "different-basis")
  ) {
    throw new Error("Invalid authoring-source attachment.");
  }
  return {
    attachmentId: value.attachmentId,
    attachmentRevision: value.attachmentRevision,
    fileId: value.fileId,
    fileHeadRevision: value.fileHeadRevision,
    sourceStatus: value.sourceStatus,
    role: { id: role.id, version: role.version },
    target: { elementKind: expectedKind, elementId: selection.id },
    basisStatus: value.basisStatus,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isReadStatus(
  value: unknown,
): value is ProductAuthoringSourceReadStatus {
  return value === "observed" || value === "unavailable" ||
    value === "unattached" || value === "unresolved";
}
