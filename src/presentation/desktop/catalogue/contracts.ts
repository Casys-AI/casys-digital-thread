/**
 * Curated MCP catalogue contract for the Desktop host (#54).
 *
 * Identity unity (shared with Canvas #55): a catalogue entry id is exactly
 * the fleet registry id (`config/mcp-fleet.json`), the chat connectable MCP
 * id, and the tool-runtime toolId. One id, three surfaces, no alias.
 *
 * Renderer safety: entries carry user copy, provider tool summaries, and
 * tested-distribution identity only. No endpoint URLs, no digests, no
 * ports, no container ids cross this boundary; availability details are
 * scrubbed and bounded host-side before construction.
 */
export const DESKTOP_CATALOGUE_PROTOCOL = "casys-desktop-catalogue/1.0" as const;

export const CATALOGUE_SCHEMA_VERSION = "casys-mcp-catalogue/1.0" as const;

export type CatalogueViewerSupport = "available" | "planned";
export type CataloguePlatformStatus = "measured" | "unclaimed";
export type CatalogueEngineStatus =
  | "ready"
  | "absent"
  | "stopped"
  | "incompatible"
  | "unknown";
export type CataloguePrepareOutcome = "prepared" | "needs-action";

export interface CatalogueToolDto {
  readonly name: string;
  readonly summary: string;
  readonly inputs: string;
  readonly results: string;
}

export interface CatalogueExampleDto {
  readonly title: string;
  readonly summary: string;
}

export interface CatalogueViewerDto {
  readonly uri: string;
  readonly label: string;
  readonly hostSupport: CatalogueViewerSupport;
  readonly note?: string;
}

export interface CatalogueDistributionDto {
  readonly version: string;
  readonly release: string;
  readonly revision: string;
}

export interface CataloguePlatformDto {
  readonly id: string;
  readonly status: CataloguePlatformStatus;
  readonly note: string;
}

export interface CatalogueAvailabilityDto {
  readonly prepared: boolean;
  readonly running: boolean;
  readonly capable: boolean;
  /** ISO timestamp of the last capability probe, or null when never probed. */
  readonly lastProbeAt: string | null;
  readonly detail: string;
  readonly engine: CatalogueEngineStatus;
}

export interface CatalogueEntryDto {
  readonly id: string;
  readonly displayName: string;
  readonly tagline: string;
  readonly description: string;
  readonly tools: readonly CatalogueToolDto[];
  readonly examples: readonly CatalogueExampleDto[];
  readonly viewers: readonly CatalogueViewerDto[];
  readonly distribution: CatalogueDistributionDto;
  readonly platforms: readonly CataloguePlatformDto[];
  readonly guidance: string;
  readonly availability: CatalogueAvailabilityDto;
  readonly isDefault: boolean;
}

export interface CatalogueSnapshotDto {
  readonly protocol: typeof DESKTOP_CATALOGUE_PROTOCOL;
  readonly entries: readonly CatalogueEntryDto[];
  readonly error?: string;
}

export type CatalogueCommandRequest =
  | {
    readonly protocol: typeof DESKTOP_CATALOGUE_PROTOCOL;
    readonly requestId: string;
    readonly command: "catalogue.prepare";
    readonly entryId: string;
  }
  | {
    readonly protocol: typeof DESKTOP_CATALOGUE_PROTOCOL;
    readonly requestId: string;
    readonly command: "catalogue.probe";
    readonly entryId: string;
  }
  | {
    readonly protocol: typeof DESKTOP_CATALOGUE_PROTOCOL;
    readonly requestId: string;
    readonly command: "catalogue.defaults.get";
  }
  | {
    readonly protocol: typeof DESKTOP_CATALOGUE_PROTOCOL;
    readonly requestId: string;
    readonly command: "catalogue.defaults.set";
    readonly ids: readonly string[];
  };

export interface CatalogueCommandResponse {
  readonly protocol: typeof DESKTOP_CATALOGUE_PROTOCOL;
  readonly requestId: string;
  readonly ok: boolean;
  readonly error?: string;
  readonly outcome?: CataloguePrepareOutcome;
  readonly detail?: string;
  readonly recovery?: string;
  readonly ids?: readonly string[];
}

export function parseCatalogueSnapshotRequest(value: unknown): {
  readonly protocol: typeof DESKTOP_CATALOGUE_PROTOCOL;
} {
  const input = record(value, "catalogue snapshot request");
  protocol(input.protocol);
  return Object.freeze({ protocol: DESKTOP_CATALOGUE_PROTOCOL });
}

export function parseCatalogueSnapshotDto(value: unknown): CatalogueSnapshotDto {
  const input = record(value, "catalogue snapshot");
  protocol(input.protocol);
  if (!Array.isArray(input.entries) || input.entries.length > 32) {
    throw new TypeError("catalogue entry list is invalid");
  }
  return Object.freeze({
    protocol: DESKTOP_CATALOGUE_PROTOCOL,
    entries: Object.freeze(input.entries.map(parseCatalogueEntryDto)),
    ...optionalText(input.error, "error", 1_000, "error"),
  });
}

export function parseCatalogueEntryDto(value: unknown): CatalogueEntryDto {
  const input = record(value, "catalogue entry");
  if (
    !Array.isArray(input.tools) || input.tools.length === 0 || input.tools.length > 32
  ) {
    throw new TypeError("catalogue entry tools are invalid");
  }
  if (!Array.isArray(input.examples) || input.examples.length > 16) {
    throw new TypeError("catalogue entry examples are invalid");
  }
  if (!Array.isArray(input.viewers) || input.viewers.length > 16) {
    throw new TypeError("catalogue entry viewers are invalid");
  }
  if (!Array.isArray(input.platforms) || input.platforms.length > 16) {
    throw new TypeError("catalogue entry platforms are invalid");
  }
  if (typeof input.isDefault !== "boolean") {
    throw new TypeError("catalogue entry default flag is invalid");
  }
  return Object.freeze({
    id: opaqueId(input.id, "catalogue entry id"),
    displayName: text(input.displayName, "catalogue entry displayName", 120),
    tagline: text(input.tagline, "catalogue entry tagline", 200),
    description: text(input.description, "catalogue entry description", 2_000),
    tools: Object.freeze(input.tools.map(parseCatalogueToolDto)),
    examples: Object.freeze(input.examples.map(parseCatalogueExampleDto)),
    viewers: Object.freeze(input.viewers.map(parseCatalogueViewerDto)),
    distribution: parseCatalogueDistributionDto(input.distribution),
    platforms: Object.freeze(input.platforms.map(parseCataloguePlatformDto)),
    guidance: text(input.guidance, "catalogue entry guidance", 1_500),
    availability: parseCatalogueAvailabilityDto(input.availability),
    isDefault: input.isDefault,
  });
}

export function parseCatalogueCommandRequest(value: unknown): CatalogueCommandRequest {
  const input = record(value, "catalogue command");
  protocol(input.protocol);
  const requestId = opaqueId(input.requestId, "requestId");
  const command = input.command;
  if (command === "catalogue.prepare" || command === "catalogue.probe") {
    return Object.freeze({
      protocol: DESKTOP_CATALOGUE_PROTOCOL,
      requestId,
      command,
      entryId: opaqueId(input.entryId, "catalogue entry id"),
    });
  }
  if (command === "catalogue.defaults.get") {
    return Object.freeze({ protocol: DESKTOP_CATALOGUE_PROTOCOL, requestId, command });
  }
  if (command === "catalogue.defaults.set") {
    if (!Array.isArray(input.ids) || input.ids.length > 8) {
      throw new TypeError("catalogue default ids are invalid");
    }
    return Object.freeze({
      protocol: DESKTOP_CATALOGUE_PROTOCOL,
      requestId,
      command,
      ids: Object.freeze(input.ids.map((id) => opaqueId(id, "catalogue default id"))),
    });
  }
  throw new TypeError("catalogue command is not supported");
}

export function parseCatalogueCommandResponse(
  value: unknown,
): CatalogueCommandResponse {
  const input = record(value, "catalogue command response");
  protocol(input.protocol);
  const requestId = opaqueId(input.requestId, "requestId");
  if (typeof input.ok !== "boolean") {
    throw new TypeError("catalogue response ok is invalid");
  }
  const outcome = input.outcome;
  if (
    outcome !== undefined && outcome !== "prepared" && outcome !== "needs-action"
  ) {
    throw new TypeError("catalogue response outcome is invalid");
  }
  if (input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.length > 8)) {
    throw new TypeError("catalogue response ids are invalid");
  }
  return Object.freeze({
    protocol: DESKTOP_CATALOGUE_PROTOCOL,
    requestId,
    ok: input.ok,
    ...optionalText(input.error, "error", 1_000, "error"),
    ...(outcome === undefined ? {} : { outcome }),
    ...optionalText(input.detail, "detail", 500, "detail"),
    ...optionalText(input.recovery, "recovery", 500, "recovery"),
    ...(input.ids === undefined ? {} : {
      ids: Object.freeze(
        (input.ids as unknown[]).map((id) => opaqueId(id, "catalogue response id")),
      ),
    }),
  });
}

function parseCatalogueToolDto(value: unknown): CatalogueToolDto {
  const input = record(value, "catalogue tool");
  return Object.freeze({
    name: opaqueId(input.name, "catalogue tool name"),
    summary: text(input.summary, "catalogue tool summary", 500),
    inputs: text(input.inputs, "catalogue tool inputs", 500),
    results: text(input.results, "catalogue tool results", 500),
  });
}

function parseCatalogueExampleDto(value: unknown): CatalogueExampleDto {
  const input = record(value, "catalogue example");
  return Object.freeze({
    title: text(input.title, "catalogue example title", 120),
    summary: text(input.summary, "catalogue example summary", 500),
  });
}

function parseCatalogueViewerDto(value: unknown): CatalogueViewerDto {
  const input = record(value, "catalogue viewer");
  const uri = text(input.uri, "catalogue viewer uri", 300);
  if (!uri.startsWith("ui://")) {
    throw new TypeError("catalogue viewer uri must be a ui:// resource");
  }
  const hostSupport = input.hostSupport;
  if (hostSupport !== "available" && hostSupport !== "planned") {
    throw new TypeError("catalogue viewer support is invalid");
  }
  return Object.freeze({
    uri,
    label: text(input.label, "catalogue viewer label", 120),
    hostSupport,
    ...optionalText(input.note, "note", 300, "note"),
  });
}

function parseCatalogueDistributionDto(value: unknown): CatalogueDistributionDto {
  const input = record(value, "catalogue distribution");
  return Object.freeze({
    version: text(input.version, "catalogue distribution version", 64),
    release: text(input.release, "catalogue distribution release", 64),
    revision: text(input.revision, "catalogue distribution revision", 64),
  });
}

function parseCataloguePlatformDto(value: unknown): CataloguePlatformDto {
  const input = record(value, "catalogue platform");
  const status = input.status;
  if (status !== "measured" && status !== "unclaimed") {
    throw new TypeError("catalogue platform status is invalid");
  }
  return Object.freeze({
    id: text(input.id, "catalogue platform id", 64),
    status,
    note: text(input.note, "catalogue platform note", 500),
  });
}

function parseCatalogueAvailabilityDto(value: unknown): CatalogueAvailabilityDto {
  const input = record(value, "catalogue availability");
  if (
    typeof input.prepared !== "boolean" || typeof input.running !== "boolean" ||
    typeof input.capable !== "boolean"
  ) {
    throw new TypeError("catalogue availability flags are invalid");
  }
  const lastProbeAt = input.lastProbeAt;
  if (
    lastProbeAt !== null &&
    (typeof lastProbeAt !== "string" || !Number.isFinite(Date.parse(lastProbeAt)))
  ) {
    throw new TypeError("catalogue last probe timestamp is invalid");
  }
  const engine = input.engine;
  if (
    engine !== "ready" && engine !== "absent" && engine !== "stopped" &&
    engine !== "incompatible" && engine !== "unknown"
  ) {
    throw new TypeError("catalogue engine status is invalid");
  }
  return Object.freeze({
    prepared: input.prepared,
    running: input.running,
    capable: input.capable,
    lastProbeAt,
    detail: text(input.detail, "catalogue availability detail", 500),
    engine,
  });
}

function protocol(value: unknown): void {
  if (value !== DESKTOP_CATALOGUE_PROTOCOL) {
    throw new TypeError(`protocol must be ${DESKTOP_CATALOGUE_PROTOCOL}`);
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw new TypeError(`${name} must be non-empty text of at most ${max} characters`);
  }
  return value.trim();
}

function optionalText(
  value: unknown,
  name: string,
  max: number,
  key: string,
): Record<string, string> {
  if (value === undefined) return {};
  return { [key]: text(value, name, max) };
}

const OPAQUE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;

function opaqueId(value: unknown, name: string): string {
  const candidate = text(value, name, 160);
  if (!OPAQUE_ID.test(candidate)) throw new TypeError(`${name} is invalid`);
  return candidate;
}
