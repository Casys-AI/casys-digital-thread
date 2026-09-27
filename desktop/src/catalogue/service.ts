/**
 * Curated MCP catalogue service for the Desktop host (#54).
 *
 * Joins the versioned curated library (`config/mcp-catalogue.json`) with
 * live availability: listed (in the file), prepared and running (from the
 * #56 ToolRuntime backend), and capable (from a direct endpoint probe).
 * Availability is computed fresh on every snapshot; the UI polls slowly
 * and only while the catalogue is open.
 *
 * Renderer safety: curated copy is validated against the DTO caps at load,
 * and every runtime-built string is scrubbed and bounded before it reaches
 * a DTO. Snapshots never throw: a failed backend or probe degrades one
 * entry to explicit unknown states.
 */
import catalogueManifest from "../../../config/mcp-catalogue.json" with {
  type: "json",
};
import {
  CATALOGUE_SCHEMA_VERSION,
  type CatalogueAvailabilityDto,
  type CatalogueCommandRequest,
  type CatalogueCommandResponse,
  type CatalogueEntryDto,
  type CatalogueSnapshotDto,
  DESKTOP_CATALOGUE_PROTOCOL,
} from "../../../src/presentation/desktop/catalogue/contracts.ts";
import { connectableMcpServers, probeChatMcpServer } from "../chat/mcp-servers.ts";
import type { ChatMcpProbeOutcome, ChatMcpServerConfig } from "../chat/runtime-port.ts";
import {
  projectToolRuntimeStatus,
  scrubRendererText,
  type ToolRuntimeHost,
  type ToolRuntimeStatus,
} from "../tool-runtime/backend.ts";
import type { PreparationOutcome } from "../tool-runtime/preparation.ts";

export interface CatalogueBackend {
  status(): Promise<ToolRuntimeStatus>;
  prepare(toolId: string): Promise<PreparationOutcome>;
}

export interface CatalogueServiceOptions {
  /** Defaults to the bundled curated manifest. Injected in tests. */
  readonly manifest?: unknown;
  readonly backend: CatalogueBackend;
  /** Defaults to the validated connectable fleet entries. */
  readonly fleetServers?: readonly ChatMcpServerConfig[];
  /** Defaults to the direct endpoint probe. */
  readonly probe?: (
    server: ChatMcpServerConfig,
  ) => Promise<ChatMcpProbeOutcome>;
  readonly defaultsPath: string;
  readonly now?: () => string;
}

interface CuratedTool {
  readonly name: string;
  readonly summary: string;
  readonly inputs: string;
  readonly results: string;
}

interface CuratedExample {
  readonly title: string;
  readonly summary: string;
}

interface CuratedViewer {
  readonly uri: string;
  readonly label: string;
  readonly hostSupport: "available" | "planned";
  readonly note?: string;
}

interface CuratedEntry {
  readonly id: string;
  readonly displayName: string;
  readonly tagline: string;
  readonly description: string;
  readonly tools: readonly CuratedTool[];
  readonly examples: readonly CuratedExample[];
  readonly viewers: readonly CuratedViewer[];
  readonly distribution: {
    readonly version: string;
    readonly release: string;
    readonly revision: string;
  };
  readonly platforms: readonly {
    readonly id: string;
    readonly status: "measured" | "unclaimed";
    readonly note: string;
  }[];
  readonly guidance: string;
}

const ENTRY_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export function loadCatalogueEntries(manifest: unknown): CuratedEntry[] {
  const root = record(manifest, "catalogue manifest");
  if (root.schemaVersion !== CATALOGUE_SCHEMA_VERSION) {
    throw new TypeError("catalogue manifest schema is not supported");
  }
  if (
    !Array.isArray(root.entries) || root.entries.length === 0 ||
    root.entries.length > 32
  ) {
    throw new TypeError("catalogue manifest entries are invalid");
  }
  const entries = root.entries.map((entry) => curatedEntry(entry));
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) {
    throw new TypeError("catalogue manifest entry ids must be unique");
  }
  return entries;
}

export class CatalogueService {
  readonly #entries: readonly CuratedEntry[];
  readonly #backend: CatalogueBackend;
  readonly #fleet: ReadonlyMap<string, ChatMcpServerConfig>;
  readonly #probe: (
    server: ChatMcpServerConfig,
  ) => Promise<ChatMcpProbeOutcome>;
  readonly #defaultsPath: string;
  readonly #now: () => string;

  constructor(options: CatalogueServiceOptions) {
    this.#entries = loadCatalogueEntries(options.manifest ?? catalogueManifest);
    this.#backend = options.backend;
    const fleet = options.fleetServers ?? connectableMcpServers();
    for (const entry of this.#entries) {
      if (!fleet.some((server) => server.id === entry.id)) {
        throw new TypeError(
          `Catalogue entry "${entry.id}" has no connectable fleet server.`,
        );
      }
    }
    this.#fleet = new Map(fleet.map((server) => [server.id, server]));
    this.#probe = options.probe ?? probeChatMcpServer;
    this.#defaultsPath = options.defaultsPath;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async snapshot(): Promise<CatalogueSnapshotDto> {
    const defaults = await this.getDefaults();
    let projected: ReturnType<typeof projectToolRuntimeStatus> | undefined;
    try {
      projected = projectToolRuntimeStatus(await this.#backend.status());
    } catch {
      projected = undefined;
    }
    const entries: CatalogueEntryDto[] = [];
    for (const entry of this.#entries) {
      entries.push({
        id: entry.id,
        displayName: entry.displayName,
        tagline: entry.tagline,
        description: entry.description,
        tools: Object.freeze(entry.tools.map((tool) => Object.freeze({ ...tool }))),
        examples: Object.freeze(
          entry.examples.map((example) => Object.freeze({ ...example })),
        ),
        viewers: Object.freeze(
          entry.viewers.map((viewer) => Object.freeze({ ...viewer })),
        ),
        distribution: Object.freeze({ ...entry.distribution }),
        platforms: Object.freeze(
          entry.platforms.map((platform) => Object.freeze({ ...platform })),
        ),
        guidance: entry.guidance,
        availability: await this.#availability(entry, projected),
        isDefault: defaults.includes(entry.id),
      });
    }
    return Object.freeze({
      protocol: DESKTOP_CATALOGUE_PROTOCOL,
      entries: Object.freeze(entries),
    });
  }

  async command(
    input: CatalogueCommandRequest,
  ): Promise<CatalogueCommandResponse> {
    if (input.command === "catalogue.prepare") {
      const prepared = await this.prepare(input.entryId);
      return Object.freeze({
        protocol: DESKTOP_CATALOGUE_PROTOCOL,
        requestId: input.requestId,
        ok: true,
        outcome: prepared.outcome,
        detail: prepared.detail,
        ...(prepared.recovery === undefined ? {} : { recovery: prepared.recovery }),
      });
    }
    if (input.command === "catalogue.probe") {
      const probed = await this.probe(input.entryId);
      return Object.freeze({
        protocol: DESKTOP_CATALOGUE_PROTOCOL,
        requestId: input.requestId,
        ok: true,
        detail: probed.detail,
      });
    }
    if (input.command === "catalogue.defaults.get") {
      return Object.freeze({
        protocol: DESKTOP_CATALOGUE_PROTOCOL,
        requestId: input.requestId,
        ok: true,
        ids: Object.freeze(await this.getDefaults()),
      });
    }
    return Object.freeze({
      protocol: DESKTOP_CATALOGUE_PROTOCOL,
      requestId: input.requestId,
      ok: true,
      ids: Object.freeze(await this.setDefaults(input.ids)),
    });
  }

  async prepare(
    entryId: string,
  ): Promise<Pick<CatalogueCommandResponse, "outcome" | "detail" | "recovery">> {
    const entry = this.#entries.find((candidate) => candidate.id === entryId);
    if (entry === undefined) throw new Error("Unknown catalogue entry.");
    let outcome: PreparationOutcome;
    try {
      outcome = await this.#backend.prepare(entry.id);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error("Host preparation is not implemented for this tool.");
      }
      // Thrown backend failures can carry paths, ports, or digests: only the
      // curated outcome path above may reach the renderer.
      throw new Error("Host preparation failed before reporting an outcome.");
    }
    if (outcome.status === "ready") {
      return {
        outcome: "prepared",
        detail: bound(scrubRendererText(outcome.detail), 500),
      };
    }
    return {
      outcome: "needs-action",
      detail: bound(scrubRendererText(outcome.detail), 500),
      recovery: bound(scrubRendererText(outcome.recovery), 500),
    };
  }

  async probe(
    entryId: string,
  ): Promise<{ readonly capable: boolean; readonly detail: string }> {
    const availability = await this.#availabilityFor(entryId);
    return { capable: availability.capable, detail: availability.detail };
  }

  async getDefaults(): Promise<string[]> {
    let raw: string;
    try {
      raw = await Deno.readTextFile(this.#defaultsPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return [];
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return [];
      }
      const ids = (parsed as Record<string, unknown>).ids;
      if (!Array.isArray(ids)) return [];
      const known = new Set(this.#entries.map((entry) => entry.id));
      return [
        ...new Set(
          ids.filter((id): id is string => typeof id === "string" && known.has(id)),
        ),
      ];
    } catch {
      return [];
    }
  }

  async setDefaults(ids: readonly string[]): Promise<string[]> {
    const known = new Set(this.#entries.map((entry) => entry.id));
    for (const id of ids) {
      if (!known.has(id)) throw new Error(`Unknown catalogue entry "${id}".`);
    }
    const stored = [...new Set(ids)];
    try {
      const directory = this.#defaultsPath.split(/[/\\]/).slice(0, -1).join("/");
      if (directory !== "") await Deno.mkdir(directory, { recursive: true });
      await Deno.writeTextFile(
        this.#defaultsPath,
        JSON.stringify({
          schemaVersion: "casys-desktop-catalogue-defaults/1.0",
          ids: stored,
        }),
      );
    } catch {
      // Deno filesystem errors quote the host path: never forward them.
      throw new Error("Catalogue defaults could not be saved.");
    }
    return stored;
  }

  async #availabilityFor(entryId: string): Promise<CatalogueAvailabilityDto> {
    const entry = this.#entries.find((candidate) => candidate.id === entryId);
    if (entry === undefined) throw new Error("Unknown catalogue entry.");
    let projected: ReturnType<typeof projectToolRuntimeStatus> | undefined;
    try {
      projected = projectToolRuntimeStatus(await this.#backend.status());
    } catch {
      projected = undefined;
    }
    return await this.#availability(entry, projected);
  }

  async #availability(
    entry: CuratedEntry,
    projected: ReturnType<typeof projectToolRuntimeStatus> | undefined,
  ): Promise<CatalogueAvailabilityDto> {
    const tool = projected?.tools.find((candidate) => candidate.toolId === entry.id);
    const engine = projected?.engine ?? "unknown";
    if (tool === undefined) {
      return {
        prepared: false,
        running: false,
        capable: await this.#probeCapable(entry),
        lastProbeAt: this.#now(),
        detail: projected === undefined
          ? "Host runtime status is unavailable; flags stay conservative."
          : "Host preparation is not implemented for this tool.",
        engine,
      };
    }
    const prepared = tool.state === "ready" || tool.state === "stopped";
    const running = tool.state === "ready";
    const capable = await this.#probeCapable(entry);
    return {
      prepared,
      running,
      capable,
      lastProbeAt: this.#now(),
      detail: bound(this.#availabilityDetail(tool.state, tool.detail, capable), 500),
      engine,
    };
  }

  #availabilityDetail(state: string, toolDetail: string, capable: boolean): string {
    if (!capable) {
      return `Not reachable: ${toolDetail}`;
    }
    if (state === "stopped" || state === "never-prepared") {
      return `${toolDetail} An external endpoint answers.`;
    }
    return toolDetail;
  }

  async #probeCapable(entry: CuratedEntry): Promise<boolean> {
    const server = this.#fleet.get(entry.id);
    if (server === undefined) return false;
    try {
      return (await this.#probe(server)).ok;
    } catch {
      return false;
    }
  }
}

function curatedEntry(value: unknown): CuratedEntry {
  const input = record(value, "catalogue entry");
  const id = field(input.id, "catalogue entry id", 64);
  if (!ENTRY_ID.test(id)) throw new TypeError("catalogue entry id is invalid");
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
  return {
    id,
    displayName: field(input.displayName, "catalogue entry displayName", 120),
    tagline: field(input.tagline, "catalogue entry tagline", 200),
    description: field(input.description, "catalogue entry description", 2_000),
    tools: input.tools.map((tool) => {
      const item = record(tool, "catalogue tool");
      const name = field(item.name, "catalogue tool name", 160);
      if (!ENTRY_ID.test(name)) throw new TypeError("catalogue tool name is invalid");
      return {
        name,
        summary: field(item.summary, "catalogue tool summary", 500),
        inputs: field(item.inputs, "catalogue tool inputs", 500),
        results: field(item.results, "catalogue tool results", 500),
      };
    }),
    examples: input.examples.map((example) => {
      const item = record(example, "catalogue example");
      return {
        title: field(item.title, "catalogue example title", 120),
        summary: field(item.summary, "catalogue example summary", 500),
      };
    }),
    viewers: input.viewers.map((viewer) => {
      const item = record(viewer, "catalogue viewer");
      const uri = field(item.uri, "catalogue viewer uri", 300);
      if (!uri.startsWith("ui://")) {
        throw new TypeError("catalogue viewer uri must be a ui:// resource");
      }
      if (item.hostSupport !== "available" && item.hostSupport !== "planned") {
        throw new TypeError("catalogue viewer support is invalid");
      }
      return {
        uri,
        label: field(item.label, "catalogue viewer label", 120),
        hostSupport: item.hostSupport,
        ...(item.note === undefined
          ? {}
          : { note: field(item.note, "catalogue viewer note", 300) }),
      };
    }),
    distribution: (() => {
      const item = record(input.distribution, "catalogue distribution");
      return {
        version: field(item.version, "catalogue distribution version", 64),
        release: field(item.release, "catalogue distribution release", 64),
        revision: field(item.revision, "catalogue distribution revision", 64),
      };
    })(),
    platforms: input.platforms.map((platform) => {
      const item = record(platform, "catalogue platform");
      if (item.status !== "measured" && item.status !== "unclaimed") {
        throw new TypeError("catalogue platform status is invalid");
      }
      return {
        id: field(item.id, "catalogue platform id", 64),
        status: item.status,
        note: field(item.note, "catalogue platform note", 500),
      };
    }),
    guidance: field(input.guidance, "catalogue entry guidance", 1_500),
  };
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function field(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw new TypeError(`${name} must be non-empty text of at most ${max} characters`);
  }
  return value.trim();
}

/** Code-point-safe bound; DTO text caps are UTF-16 lengths, this stays under. */
function bound(value: string, max: number): string {
  const points = [...value];
  if (points.length <= max) return value;
  return `${points.slice(0, max - 1).join("")}…`;
}

export type { ToolRuntimeHost };
