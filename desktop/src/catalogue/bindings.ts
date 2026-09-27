/**
 * Desktop webview bindings for the curated MCP catalogue (#54).
 *
 * The catalogue service runs in the Deno Desktop process next to the
 * #56 ToolRuntime backend; these bindings are its only renderer surface.
 * Unknown entries and host failures surface as explicit `ok:false`
 * responses or snapshot errors, never as thrown binding rejections.
 */
import {
  type CatalogueCommandRequest,
  type CatalogueCommandResponse,
  type CatalogueSnapshotDto,
  DESKTOP_CATALOGUE_PROTOCOL,
  parseCatalogueCommandRequest,
  parseCatalogueSnapshotRequest,
} from "../../../src/presentation/desktop/catalogue/contracts.ts";
import type { BrowserWindowBindingPort } from "../chat/bindings.ts";

export const CATALOGUE_SNAPSHOT_BINDING = "casysCatalogueSnapshot" as const;
export const CATALOGUE_COMMAND_BINDING = "casysCatalogueCommand" as const;

export interface DesktopCatalogueBindingHost {
  snapshot(): Promise<CatalogueSnapshotDto>;
  command(
    input: CatalogueCommandRequest,
  ): Promise<CatalogueCommandResponse>;
}

export function registerDesktopCatalogueBindings(
  window: BrowserWindowBindingPort,
  host?: DesktopCatalogueBindingHost,
): void {
  window.bind(CATALOGUE_SNAPSHOT_BINDING, async (value: unknown) => {
    parseCatalogueSnapshotRequest(value);
    if (host === undefined) {
      return Object.freeze({
        protocol: DESKTOP_CATALOGUE_PROTOCOL,
        entries: Object.freeze([]),
        error: "The curated MCP catalogue is unavailable.",
      }) satisfies CatalogueSnapshotDto;
    }
    try {
      return await host.snapshot();
    } catch {
      return Object.freeze({
        protocol: DESKTOP_CATALOGUE_PROTOCOL,
        entries: Object.freeze([]),
        error: "The curated MCP catalogue snapshot is unavailable.",
      }) satisfies CatalogueSnapshotDto;
    }
  });
  window.bind(CATALOGUE_COMMAND_BINDING, async (value: unknown) => {
    const input = parseCatalogueCommandRequest(value);
    if (host === undefined) {
      return Object.freeze({
        protocol: DESKTOP_CATALOGUE_PROTOCOL,
        requestId: input.requestId,
        ok: false,
        error: "The curated MCP catalogue is unavailable.",
      }) satisfies CatalogueCommandResponse;
    }
    try {
      return await host.command(input);
    } catch (error) {
      return Object.freeze({
        protocol: DESKTOP_CATALOGUE_PROTOCOL,
        requestId: input.requestId,
        ok: false,
        error: safeError(error),
      }) satisfies CatalogueCommandResponse;
    }
  });
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Catalogue request failed";
  return [...message].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("").slice(0, 1_000);
}
