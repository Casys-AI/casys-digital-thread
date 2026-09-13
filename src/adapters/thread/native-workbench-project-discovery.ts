import { EngineeringProjectStoreConflictError } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import { sha256Hex } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { EngineeringProjectValidationError } from "../../domain/project/engineering-project-validation.ts";
import {
  type EngineeringProjectRevisionFileEntry,
  type PhysicalProjectRevisionHead,
  selectPhysicalProjectRevisionHead,
} from "../shared/stores/engineering-project-store.ts";

export const NATIVE_WORKBENCH_PROJECT_DISCOVERY_SCHEMA_VERSION =
  "native-workbench-project-discovery/2.0" as const;

export const NATIVE_WORKBENCH_PROJECT_DISCOVERY_IDENTITY_AUTHORITY =
  "observed-storage" as const;

export const NATIVE_WORKBENCH_PROJECT_DISCOVERY_MAX_ENTRIES = 4096;
export const NATIVE_WORKBENCH_PROJECT_DISCOVERY_MAX_DIRECTORY_NAME_LENGTH = 255;
export const NATIVE_WORKBENCH_PROJECT_DISCOVERY_MAX_HEAD_BYTES = 32 * 1024 * 1024;

export const NATIVE_WORKBENCH_PROJECT_DISCOVERY_REASON_CODES = [
  "invalid-uri-encoding",
  "symlink",
  "root-escape",
  "identity-mismatch",
  "malformed-head",
  "unpublished-claim",
  "validation-failure",
  "read-permission-failure",
  "no-published-json",
  "oversized-head",
  "unreadable-head",
  "changed-during-read",
  "enumeration-truncated",
  "root-unreadable",
  "unexpected-non-project",
  "directory-name-too-long",
] as const;

export type NativeWorkbenchProjectDiscoveryReasonCode =
  typeof NATIVE_WORKBENCH_PROJECT_DISCOVERY_REASON_CODES[number];

const REASON_MESSAGES: {
  readonly [Code in NativeWorkbenchProjectDiscoveryReasonCode]: string;
} = {
  "invalid-uri-encoding":
    "Observed storage identifier is not a valid URI-encoded project directory name.",
  symlink: "Observed storage entry is a symbolic link and was not followed.",
  "root-escape":
    "Observed storage identifier is not confined to the configured project root.",
  "identity-mismatch":
    "Observed storage identity does not match a validated project snapshot identity.",
  "malformed-head": "Observed project head is not well-formed published JSON.",
  "unpublished-claim":
    "Observed project head has a higher unpublished claim than any published JSON.",
  "validation-failure":
    "Observed project head is not a valid current EngineeringProjectSnapshot.",
  "read-permission-failure":
    "Observed project head could not be read because of a permission failure.",
  "no-published-json": "Observed project directory has no published JSON revision.",
  "oversized-head": "Observed project head exceeds the discovery byte bound.",
  "unreadable-head": "Observed project head could not be read.",
  "changed-during-read":
    "Observed project head changed while discovery was inspecting it.",
  "enumeration-truncated":
    "Project root enumeration exceeded the discovery entry bound.",
  "root-unreadable": "Configured project root could not be enumerated completely.",
  "unexpected-non-project":
    "Observed storage entry is not a project directory candidate.",
  "directory-name-too-long":
    "Observed storage identifier exceeds the discovery name bound.",
};

export interface NativeWorkbenchProjectDiscoveryAvailableEntry {
  readonly kind: "available";
  readonly id: string;
  readonly name: string;
  readonly revision: number;
  readonly subjectId: string;
}

export interface NativeWorkbenchProjectDiscoveryObservedHead {
  readonly filename: string;
  readonly digest?: ContentFingerprint;
}

export interface NativeWorkbenchProjectDiscoveryUnavailableEntry {
  readonly kind: "unavailable";
  readonly observedStorageIdentifier: string;
  readonly identityAuthority:
    typeof NATIVE_WORKBENCH_PROJECT_DISCOVERY_IDENTITY_AUTHORITY;
  readonly observedHead?: NativeWorkbenchProjectDiscoveryObservedHead;
  readonly reasonCode: NativeWorkbenchProjectDiscoveryReasonCode;
  readonly message: string;
}

export type NativeWorkbenchProjectDiscoveryEntry =
  | NativeWorkbenchProjectDiscoveryAvailableEntry
  | NativeWorkbenchProjectDiscoveryUnavailableEntry;

export interface NativeWorkbenchProjectDiscoveryCounts {
  readonly available: number;
  readonly unavailable: number;
  readonly candidates: number;
}

export interface NativeWorkbenchProjectDiscoveryEnumeration {
  readonly complete: boolean;
  readonly truncated: boolean;
}

export type NativeWorkbenchProjectDiscovery =
  | {
    readonly schemaVersion: typeof NATIVE_WORKBENCH_PROJECT_DISCOVERY_SCHEMA_VERSION;
    readonly state: "complete" | "partial";
    readonly counts: NativeWorkbenchProjectDiscoveryCounts;
    readonly enumeration: NativeWorkbenchProjectDiscoveryEnumeration;
    readonly entries: readonly NativeWorkbenchProjectDiscoveryEntry[];
  }
  | {
    readonly schemaVersion: typeof NATIVE_WORKBENCH_PROJECT_DISCOVERY_SCHEMA_VERSION;
    readonly state: "unavailable";
    readonly reasonCode: NativeWorkbenchProjectDiscoveryReasonCode;
    readonly message: string;
    readonly counts: NativeWorkbenchProjectDiscoveryCounts;
    readonly enumeration: NativeWorkbenchProjectDiscoveryEnumeration;
    readonly entries: readonly NativeWorkbenchProjectDiscoveryEntry[];
  };

export interface ProjectDiscoveryDirEntry {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymlink: boolean;
}

export interface ProjectDiscoveryStat {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymlink: boolean;
  readonly size: number;
  readonly mtimeMs: number | null;
  readonly ino: number | null;
}

export interface ProjectDiscoveryFileIo {
  readDir(path: string): AsyncIterable<ProjectDiscoveryDirEntry>;
  lstat(path: string): Promise<ProjectDiscoveryStat>;
  readBoundedFile(path: string, maxBytes: number): Promise<Uint8Array>;
}

export interface ReadNativeWorkbenchProjectDiscoveryOptions {
  readonly io?: ProjectDiscoveryFileIo;
  readonly maxEntries?: number;
  readonly maxDirectoryNameLength?: number;
  readonly maxHeadBytes?: number;
}

export const nativeWorkbenchProjectDiscoveryFileIo: ProjectDiscoveryFileIo = {
  readDir: async function* (path) {
    for await (const entry of Deno.readDir(path)) {
      yield {
        name: entry.name,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
        isSymlink: entry.isSymlink,
      };
    }
  },
  lstat: async (path) => {
    const stat = await Deno.lstat(path);
    return {
      isFile: stat.isFile,
      isDirectory: stat.isDirectory,
      isSymlink: stat.isSymlink,
      size: stat.size,
      mtimeMs: stat.mtime?.getTime() ?? null,
      ino: stat.ino,
    };
  },
  readBoundedFile: async (path, maxBytes) => {
    const file = await Deno.open(path, { read: true });
    try {
      const buffer = new Uint8Array(maxBytes);
      const read = await file.read(buffer);
      return read === null ? new Uint8Array() : buffer.slice(0, read);
    } finally {
      file.close();
    }
  },
};

const REVISION_FILE_NAME = /^\d{10}\.(?:json|claim)$/;

/**
 * Read-only discovery of persisted project directories.
 *
 * Available entries require the same `store.get` success as the project
 * catalog. Failed newest heads stay visible as unavailable placeholders and
 * never license an older revision. This inspects storage state; it is not
 * qualification, migration, or command authority.
 */
export async function readNativeWorkbenchProjectDiscovery(
  store: Pick<EngineeringProjectRevisionStore, "get">,
  directory: string,
  options: ReadNativeWorkbenchProjectDiscoveryOptions = {},
): Promise<NativeWorkbenchProjectDiscovery> {
  const io = options.io ?? nativeWorkbenchProjectDiscoveryFileIo;
  const maxEntries = options.maxEntries ??
    NATIVE_WORKBENCH_PROJECT_DISCOVERY_MAX_ENTRIES;
  const maxDirectoryNameLength = options.maxDirectoryNameLength ??
    NATIVE_WORKBENCH_PROJECT_DISCOVERY_MAX_DIRECTORY_NAME_LENGTH;
  const maxHeadBytes = options.maxHeadBytes ??
    NATIVE_WORKBENCH_PROJECT_DISCOVERY_MAX_HEAD_BYTES;

  const root = await inspectRoot(directory, io);
  if (root.kind === "missing") return freezeDiscovery(completeDiscovery([]));
  if (root.kind === "unavailable") {
    return freezeDiscovery(unavailableDiscovery(root.reasonCode, []));
  }

  let observed: ProjectDiscoveryDirEntry[];
  try {
    observed = await listBounded(io, directory, maxEntries);
  } catch (error) {
    return freezeDiscovery(
      unavailableDiscovery(classifyRootIoError(error), []),
    );
  }
  const truncated = observed.length > maxEntries;
  const listed = (truncated ? observed.slice(0, maxEntries) : observed)
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));

  const entries: NativeWorkbenchProjectDiscoveryEntry[] = [];
  for (const entry of listed) {
    entries.push(
      await inspectCandidate(store, directory, entry, io, {
        maxDirectoryNameLength,
        maxHeadBytes,
      }),
    );
  }
  entries.sort((left, right) =>
    discoverySortKey(left).localeCompare(discoverySortKey(right))
  );

  if (truncated) {
    return freezeDiscovery(
      unavailableDiscovery("enumeration-truncated", entries),
    );
  }
  const unavailable = entries.some((entry) => entry.kind === "unavailable");
  return freezeDiscovery({
    schemaVersion: NATIVE_WORKBENCH_PROJECT_DISCOVERY_SCHEMA_VERSION,
    state: unavailable ? "partial" : "complete",
    counts: countsOf(entries),
    enumeration: { complete: true, truncated: false },
    entries,
  });
}

export function nativeWorkbenchProjectDiscoveryHttpStatus(
  discovery: NativeWorkbenchProjectDiscovery,
): 200 | 503 {
  return discovery.state === "unavailable" ? 503 : 200;
}

export function escapeNativeWorkbenchDiscoveryHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderNativeWorkbenchProjectDiscoveryHtml(
  discovery: NativeWorkbenchProjectDiscovery,
): string {
  const diagnostic = discovery.enumeration.complete
    ? ""
    : `<p><strong>${escapeNativeWorkbenchDiscoveryHtml("unavailable")}</strong> — ${
      escapeNativeWorkbenchDiscoveryHtml(
        discovery.state === "unavailable"
          ? discovery.message
          : REASON_MESSAGES["root-unreadable"],
      )
    }</p>`;
  if (discovery.entries.length === 0) {
    return discovery.state === "complete"
      ? `${diagnostic}<p>No persisted engineering project is available.</p>`
      : `${diagnostic}<ul></ul>`;
  }
  const items = discovery.entries.map(renderDiscoveryEntry).join("");
  return `${diagnostic}<ul>${items}</ul>`;
}

function renderDiscoveryEntry(
  entry: NativeWorkbenchProjectDiscoveryEntry,
): string {
  if (entry.kind === "available") {
    return `<li data-discovery-kind="available"><strong>${
      escapeNativeWorkbenchDiscoveryHtml(entry.name)
    }</strong><br><code>${
      escapeNativeWorkbenchDiscoveryHtml(entry.id)
    }</code> · revision ${entry.revision}</li>`;
  }
  const head = entry.observedHead
    ? ` · <code>${
      escapeNativeWorkbenchDiscoveryHtml(entry.observedHead.filename)
    }</code>`
    : "";
  return `<li data-discovery-kind="unavailable"><strong>unavailable</strong> — ${
    escapeNativeWorkbenchDiscoveryHtml(entry.message)
  }<br><code>${
    escapeNativeWorkbenchDiscoveryHtml(entry.observedStorageIdentifier)
  }</code> · ${escapeNativeWorkbenchDiscoveryHtml(entry.reasonCode)}${head}</li>`;
}

async function inspectRoot(
  directory: string,
  io: ProjectDiscoveryFileIo,
): Promise<
  | { readonly kind: "ready" }
  | { readonly kind: "missing" }
  | {
    readonly kind: "unavailable";
    readonly reasonCode: NativeWorkbenchProjectDiscoveryReasonCode;
  }
> {
  try {
    const stat = await io.lstat(directory);
    if (stat.isSymlink) {
      return { kind: "unavailable", reasonCode: "root-escape" };
    }
    if (!stat.isDirectory) {
      return { kind: "unavailable", reasonCode: "root-unreadable" };
    }
    return { kind: "ready" };
  } catch (error) {
    if (isNotFound(error)) return { kind: "missing" };
    return { kind: "unavailable", reasonCode: classifyRootIoError(error) };
  }
}

async function listBounded(
  io: ProjectDiscoveryFileIo,
  directory: string,
  maxEntries: number,
): Promise<ProjectDiscoveryDirEntry[]> {
  const entries: ProjectDiscoveryDirEntry[] = [];
  for await (const entry of io.readDir(directory)) {
    entries.push(entry);
    if (entries.length > maxEntries) break;
  }
  return entries;
}

async function inspectCandidate(
  store: Pick<EngineeringProjectRevisionStore, "get">,
  root: string,
  entry: ProjectDiscoveryDirEntry,
  io: ProjectDiscoveryFileIo,
  bounds: {
    readonly maxDirectoryNameLength: number;
    readonly maxHeadBytes: number;
  },
): Promise<NativeWorkbenchProjectDiscoveryEntry> {
  const observedStorageIdentifier = entry.name;
  if (observedStorageIdentifier.length > bounds.maxDirectoryNameLength) {
    return unavailableEntry(observedStorageIdentifier, "directory-name-too-long");
  }
  if (!isSafeRelativeName(observedStorageIdentifier)) {
    return unavailableEntry(observedStorageIdentifier, "root-escape");
  }
  const path = joinContained(root, observedStorageIdentifier);
  let stat: ProjectDiscoveryStat;
  try {
    stat = await io.lstat(path);
  } catch (error) {
    return unavailableEntry(
      observedStorageIdentifier,
      classifyChildIoError(error),
    );
  }
  if (stat.isSymlink) {
    return unavailableEntry(observedStorageIdentifier, "symlink");
  }
  if (!stat.isDirectory) {
    return unavailableEntry(observedStorageIdentifier, "unexpected-non-project");
  }

  const identity = decodeObservedProjectIdentity(observedStorageIdentifier);
  const firstHead = await observePhysicalHead(path, io, bounds.maxHeadBytes);
  if (firstHead.kind === "blocked") {
    return unavailableEntry(
      observedStorageIdentifier,
      firstHead.reasonCode,
      firstHead.observedHead,
    );
  }
  if (identity.kind !== "ok") {
    return unavailableEntry(
      observedStorageIdentifier,
      identity.kind,
      observedHeadFromSelection(firstHead),
    );
  }

  let snapshot: Awaited<ReturnType<typeof store.get>>;
  try {
    snapshot = await store.get(identity.projectId);
  } catch (error) {
    const secondHead = await observePhysicalHead(path, io, bounds.maxHeadBytes);
    if (headChanged(firstHead, secondHead)) {
      return unavailableEntry(observedStorageIdentifier, "changed-during-read");
    }
    return unavailableEntry(
      observedStorageIdentifier,
      classifyStoreError(error),
      observedHeadFromSelection(firstHead),
    );
  }

  const secondHead = await observePhysicalHead(path, io, bounds.maxHeadBytes);
  if (headChanged(firstHead, secondHead)) {
    return unavailableEntry(observedStorageIdentifier, "changed-during-read");
  }
  if (!snapshot) {
    return unavailableEntry(
      observedStorageIdentifier,
      "no-published-json",
      observedHeadFromSelection(firstHead),
    );
  }
  if (snapshot.project.id !== identity.projectId) {
    return unavailableEntry(
      observedStorageIdentifier,
      "identity-mismatch",
      observedHeadFromSelection(firstHead),
    );
  }
  return Object.freeze({
    kind: "available",
    id: snapshot.project.id,
    name: snapshot.project.name,
    revision: snapshot.revision,
    subjectId: snapshot.project.subjectId,
  });
}

type ObservedHeadState =
  | {
    readonly kind: "observed";
    readonly selection: PhysicalProjectRevisionHead;
    readonly marker: HeadMarker | undefined;
    readonly observedHead: NativeWorkbenchProjectDiscoveryObservedHead | undefined;
  }
  | {
    readonly kind: "blocked";
    readonly reasonCode: NativeWorkbenchProjectDiscoveryReasonCode;
    readonly observedHead?: NativeWorkbenchProjectDiscoveryObservedHead;
  };

interface HeadMarker {
  readonly filename: string;
  readonly size: number;
  readonly mtimeMs: number | null;
  readonly ino: number | null;
  readonly digest?: string;
}

async function observePhysicalHead(
  projectDirectory: string,
  io: ProjectDiscoveryFileIo,
  maxHeadBytes: number,
): Promise<ObservedHeadState> {
  let entries: ProjectDiscoveryDirEntry[];
  try {
    entries = [];
    for await (const entry of io.readDir(projectDirectory)) {
      if (!isSafeRelativeName(entry.name)) {
        return { kind: "blocked", reasonCode: "root-escape" };
      }
      entries.push(entry);
    }
  } catch (error) {
    return { kind: "blocked", reasonCode: classifyChildIoError(error) };
  }

  const selectorEntries: EngineeringProjectRevisionFileEntry[] = [];
  const stats = new Map<string, ProjectDiscoveryStat>();
  let highestRevision: number | undefined;
  let highestSymlinkName: string | undefined;
  for (const entry of entries) {
    const child = joinContained(projectDirectory, entry.name);
    let stat: ProjectDiscoveryStat;
    try {
      stat = await io.lstat(child);
    } catch (error) {
      return { kind: "blocked", reasonCode: classifyChildIoError(error) };
    }
    stats.set(entry.name, stat);
    if (!REVISION_FILE_NAME.test(entry.name)) continue;
    const revision = Number(entry.name.slice(0, 10));
    if (highestRevision === undefined || revision > highestRevision) {
      highestRevision = revision;
      highestSymlinkName = stat.isSymlink ? entry.name : undefined;
    } else if (revision === highestRevision && stat.isSymlink) {
      highestSymlinkName = entry.name;
    }
    if (stat.isFile && !stat.isSymlink) {
      selectorEntries.push({ name: entry.name, isFile: true });
    }
  }
  if (highestSymlinkName !== undefined) {
    return {
      kind: "blocked",
      reasonCode: "symlink",
      observedHead: Object.freeze({ filename: highestSymlinkName }),
    };
  }

  const selection = selectPhysicalProjectRevisionHead(selectorEntries);
  if (selection.kind === "unpublished-claim") {
    return {
      kind: "observed",
      selection,
      marker: markerOf(stats.get(selection.claimFilename), selection.claimFilename),
      observedHead: Object.freeze({ filename: selection.claimFilename }),
    };
  }
  if (selection.kind === "absent") {
    return {
      kind: "observed",
      selection,
      marker: undefined,
      observedHead: undefined,
    };
  }

  const fileStat = stats.get(selection.filename);
  const filePath = joinContained(projectDirectory, selection.filename);
  if (!fileStat) {
    return { kind: "blocked", reasonCode: "changed-during-read" };
  }
  if (fileStat.isSymlink) {
    return {
      kind: "blocked",
      reasonCode: "symlink",
      observedHead: Object.freeze({ filename: selection.filename }),
    };
  }
  if (fileStat.size > maxHeadBytes) {
    return {
      kind: "blocked",
      reasonCode: "oversized-head",
      observedHead: Object.freeze({ filename: selection.filename }),
    };
  }
  let digest: ContentFingerprint | undefined;
  try {
    const bytes = await io.readBoundedFile(filePath, maxHeadBytes);
    if (bytes.byteLength !== fileStat.size) {
      return { kind: "blocked", reasonCode: "changed-during-read" };
    }
    digest = Object.freeze({
      algorithm: "sha256" as const,
      digest: await sha256Hex(bytes),
    });
  } catch (error) {
    return {
      kind: "blocked",
      reasonCode: classifyChildIoError(error),
      observedHead: Object.freeze({ filename: selection.filename }),
    };
  }
  const marker = markerOf(fileStat, selection.filename);
  if (!marker || !digest) {
    return { kind: "blocked", reasonCode: "changed-during-read" };
  }
  return {
    kind: "observed",
    selection,
    marker: { ...marker, digest: digest.digest },
    observedHead: Object.freeze({
      filename: selection.filename,
      digest,
    }),
  };
}

function markerOf(
  stat: ProjectDiscoveryStat | undefined,
  filename: string,
): HeadMarker | undefined {
  if (!stat) return undefined;
  return {
    filename,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ino: stat.ino,
  };
}

function headChanged(
  first: ObservedHeadState,
  second: ObservedHeadState,
): boolean {
  if (first.kind !== "observed" || second.kind !== "observed") return true;
  if (first.selection.kind !== second.selection.kind) return true;
  if (first.selection.kind === "absent" && second.selection.kind === "absent") {
    return false;
  }
  if (
    physicalSelectionKey(first.selection) !== physicalSelectionKey(second.selection)
  ) {
    return true;
  }
  const left = first.marker;
  const right = second.marker;
  if (left === undefined || right === undefined) {
    return left !== right;
  }
  if (
    left.filename !== right.filename ||
    left.size !== right.size ||
    left.mtimeMs !== right.mtimeMs ||
    left.ino !== right.ino
  ) {
    return true;
  }
  if (first.selection.kind === "unpublished-claim") return false;
  if (left.digest === undefined || right.digest === undefined) return true;
  return left.digest !== right.digest;
}

function physicalSelectionKey(selection: PhysicalProjectRevisionHead): string {
  if (selection.kind === "published-json") {
    return `published-json:${selection.filename}`;
  }
  if (selection.kind === "unpublished-claim") {
    return `unpublished-claim:${selection.claimFilename}`;
  }
  return "absent";
}

function observedHeadFromSelection(
  head: ObservedHeadState,
): NativeWorkbenchProjectDiscoveryObservedHead | undefined {
  if (head.kind === "blocked") return head.observedHead;
  if (head.selection.kind === "unpublished-claim") {
    return Object.freeze({ filename: head.selection.claimFilename });
  }
  return head.observedHead;
}

function decodeObservedProjectIdentity(
  name: string,
):
  | { readonly kind: "ok"; readonly projectId: string }
  | { readonly kind: "invalid-uri-encoding" }
  | { readonly kind: "identity-mismatch" } {
  let decoded: string;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    return { kind: "invalid-uri-encoding" };
  }
  if (encodeURIComponent(decoded) !== name) {
    return { kind: "identity-mismatch" };
  }
  return { kind: "ok", projectId: decoded };
}

function classifyStoreError(
  error: unknown,
): NativeWorkbenchProjectDiscoveryReasonCode {
  if (error instanceof EngineeringProjectStoreConflictError) {
    return "unpublished-claim";
  }
  if (error instanceof EngineeringProjectValidationError) {
    return "validation-failure";
  }
  if (error instanceof SyntaxError) return "malformed-head";
  if (error instanceof TypeError) return "identity-mismatch";
  if (isPermissionDenied(error)) return "read-permission-failure";
  if (isNotFound(error)) return "changed-during-read";
  if (
    error instanceof Error &&
    /revision path .+ contains /.test(error.message)
  ) {
    return "identity-mismatch";
  }
  return "unreadable-head";
}

function classifyRootIoError(
  error: unknown,
): NativeWorkbenchProjectDiscoveryReasonCode {
  if (isPermissionDenied(error)) return "root-unreadable";
  return "root-unreadable";
}

function classifyChildIoError(
  error: unknown,
): NativeWorkbenchProjectDiscoveryReasonCode {
  if (isPermissionDenied(error)) return "read-permission-failure";
  if (isNotFound(error)) return "changed-during-read";
  return "unreadable-head";
}

function unavailableEntry(
  observedStorageIdentifier: string,
  reasonCode: NativeWorkbenchProjectDiscoveryReasonCode,
  observedHead?: NativeWorkbenchProjectDiscoveryObservedHead,
): NativeWorkbenchProjectDiscoveryUnavailableEntry {
  return Object.freeze({
    kind: "unavailable",
    observedStorageIdentifier,
    identityAuthority: NATIVE_WORKBENCH_PROJECT_DISCOVERY_IDENTITY_AUTHORITY,
    ...(observedHead ? { observedHead: Object.freeze({ ...observedHead }) } : {}),
    reasonCode,
    message: REASON_MESSAGES[reasonCode],
  });
}

function completeDiscovery(
  entries: readonly NativeWorkbenchProjectDiscoveryEntry[],
): NativeWorkbenchProjectDiscovery {
  return {
    schemaVersion: NATIVE_WORKBENCH_PROJECT_DISCOVERY_SCHEMA_VERSION,
    state: "complete",
    counts: countsOf(entries),
    enumeration: { complete: true, truncated: false },
    entries,
  };
}

function unavailableDiscovery(
  reasonCode: NativeWorkbenchProjectDiscoveryReasonCode,
  entries: readonly NativeWorkbenchProjectDiscoveryEntry[],
): NativeWorkbenchProjectDiscovery {
  return {
    schemaVersion: NATIVE_WORKBENCH_PROJECT_DISCOVERY_SCHEMA_VERSION,
    state: "unavailable",
    reasonCode,
    message: REASON_MESSAGES[reasonCode],
    counts: countsOf(entries),
    enumeration: {
      complete: false,
      truncated: reasonCode === "enumeration-truncated",
    },
    entries,
  };
}

function countsOf(
  entries: readonly NativeWorkbenchProjectDiscoveryEntry[],
): NativeWorkbenchProjectDiscoveryCounts {
  const available = entries.filter((entry) => entry.kind === "available").length;
  const unavailable = entries.length - available;
  return {
    available,
    unavailable,
    candidates: entries.length,
  };
}

function discoverySortKey(entry: NativeWorkbenchProjectDiscoveryEntry): string {
  return entry.kind === "available"
    ? encodeURIComponent(entry.id)
    : entry.observedStorageIdentifier;
}

function freezeDiscovery(
  discovery: NativeWorkbenchProjectDiscovery,
): NativeWorkbenchProjectDiscovery {
  return Object.freeze({
    ...discovery,
    counts: Object.freeze({ ...discovery.counts }),
    enumeration: Object.freeze({ ...discovery.enumeration }),
    entries: Object.freeze([...discovery.entries]),
  });
}

function isSafeRelativeName(name: string): boolean {
  if (name.length === 0 || name === "." || name === "..") return false;
  return !name.includes("/") && !name.includes("\\") && !name.includes("\0");
}

function joinContained(root: string, name: string): string {
  return `${root.replace(/\/$/, "")}/${name}`;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    (error instanceof Error && error.name === "NotFound");
}

function isPermissionDenied(error: unknown): boolean {
  return error instanceof Deno.errors.PermissionDenied ||
    error instanceof Deno.errors.NotCapable ||
    (error instanceof Error &&
      (error.name === "PermissionDenied" || error.name === "NotCapable"));
}
