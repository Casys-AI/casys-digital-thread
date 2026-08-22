import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  fingerprintElectricalObservationMethodSheet,
  type ElectricalObservationMethodSheet,
  validateElectricalObservationMethodSheet,
} from "../../../domain/electrical/observation-method-sheet.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  ElectricalObservationMethodSheetStore,
  ElectricalObservationMethodSheetStoreReceipt,
} from "../../../application/ports/out/electrical/observation-method-sheet-store.ts";

export class FileElectricalObservationMethodSheetStore
  implements ElectricalObservationMethodSheetStore {
  readonly #captures: FileCaptureStore<"electrical-observation-method-sheet">;
  readonly #workspaceDirectories: readonly string[];

  constructor(
    captures: FileCaptureStore<"electrical-observation-method-sheet">,
    workspaceDirectories: readonly string[] = [],
  ) {
    this.#captures = captures;
    this.#workspaceDirectories = workspaceDirectories;
  }

  async save(
    sheet: ElectricalObservationMethodSheet,
  ): Promise<ElectricalObservationMethodSheetStoreReceipt> {
    const canonical = validateElectricalObservationMethodSheet(sheet);
    const fingerprint = await fingerprintElectricalObservationMethodSheet(
      canonical,
    );
    const stored = await this.#captures.save(
      fingerprint,
      deterministicJson(canonical),
    );
    return { fingerprint, uri: stored.uri };
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<ElectricalObservationMethodSheet | undefined> {
    const text = await this.#captures.read(fingerprint);
    if (text !== undefined) {
      return await reopen(text, fingerprint);
    }
    for (const directory of this.#workspaceDirectories) {
      const scanned = await scanDirectory(directory, fingerprint);
      if (scanned) return scanned;
    }
    return undefined;
  }
}

async function reopen(
  text: string,
  fingerprint: ContentFingerprint,
): Promise<ElectricalObservationMethodSheet> {
  const sheet = validateElectricalObservationMethodSheet(JSON.parse(text));
  const actual = await fingerprintElectricalObservationMethodSheet(sheet);
  if (actual.digest !== fingerprint.digest) {
    throw new TypeError(
      "Reopened electrical observation method sheet fingerprint does not match the requested digest.",
    );
  }
  return sheet;
}

async function scanDirectory(
  directory: string,
  fingerprint: ContentFingerprint,
): Promise<ElectricalObservationMethodSheet | undefined> {
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(directory)) {
      entries.push(entry);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory) {
      const nested = await scanDirectory(path, fingerprint);
      if (nested) return nested;
      continue;
    }
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await Deno.readTextFile(path));
    } catch {
      continue;
    }
    if (
      parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
    ) continue;
    const schemaVersion = (parsed as { schemaVersion?: unknown }).schemaVersion;
    if (schemaVersion !== "electrical-observation-method-sheet/1.0") continue;
    const sheet = validateElectricalObservationMethodSheet(parsed);
    const actual = await fingerprintElectricalObservationMethodSheet(sheet);
    if (actual.digest === fingerprint.digest) return sheet;
  }
  return undefined;
}
