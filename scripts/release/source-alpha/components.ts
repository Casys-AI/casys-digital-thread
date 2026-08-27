/** CycloneDX component and source-notice rendering from declared source locks. */

import {
  type Component,
  isRecord,
  type JsonRecord,
  sha256Text,
  toHex,
} from "./contract.ts";

function parseNameAndVersion(identity: string): { name: string; version: string } {
  const match = identity.match(
    /^(?<name>@[^/]+\/[^@]+|[^@]+)@(?<version>[^_]+)(?:_|$)/u,
  );
  if (!match?.groups) {
    return { name: identity, version: "NOASSERTION" };
  }
  return {
    name: match.groups.name!,
    version: match.groups.version!,
  };
}

function nameFromNpmLockPath(lockPath: string): string {
  const leaf = lockPath.split("node_modules/").at(-1) ?? lockPath;
  if (leaf.startsWith("@")) return leaf.split("/").slice(0, 2).join("/");
  return leaf.split("/")[0] || "NOASSERTION";
}

function purlFor(source: string, name: string, version: string): string {
  return "pkg:generic/" + encodeURIComponent(source) + "/" +
    encodeURIComponent(name) + "@" + encodeURIComponent(version);
}

function sriToHash(integrity: string | undefined):
  | { readonly alg: string; readonly content: string }
  | undefined {
  if (!integrity) return undefined;
  if (/^[0-9a-f]{64}$/u.test(integrity)) {
    return { alg: "SHA-256", content: integrity };
  }
  const match = integrity.match(/^sha(256|384|512)-([A-Za-z0-9+/]+={0,2})/u);
  if (!match) return undefined;
  const binary = atob(match[2]!);
  return {
    alg: `SHA-${match[1]}`,
    content: toHex(Uint8Array.from(binary, (character) => character.charCodeAt(0))),
  };
}

function optionalString(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function libraryComponent(args: {
  readonly source: string;
  readonly identity: string;
  readonly name: string;
  readonly version?: string;
  readonly integrity?: string;
  readonly license?: string;
  readonly resolved?: string;
}): Component {
  const version = args.version || "NOASSERTION";
  const integrity = args.integrity || "NOASSERTION";
  const hash = sriToHash(args.integrity);
  return {
    type: "library",
    "bom-ref": `urn:casys:source-alpha:${encodeURIComponent(args.source)}:${
      encodeURIComponent(args.identity)
    }`,
    name: args.name || "NOASSERTION",
    version,
    purl: purlFor(args.source, args.name || "NOASSERTION", version),
    ...(hash ? { hashes: [hash] } : {}),
    licenses: [{ license: { name: args.license || "NOASSERTION" } }],
    ...(args.resolved
      ? {
        externalReferences: [{ type: "distribution" as const, url: args.resolved }],
      }
      : {}),
    properties: [
      { name: "casys:inventory-source", value: args.source },
      { name: "casys:integrity", value: integrity },
    ],
  };
}

function denoLockComponents(lock: unknown): readonly Component[] {
  if (!isRecord(lock)) throw new TypeError("deno.lock must be an object.");
  const components: Component[] = [];
  for (const section of ["jsr", "npm"] as const) {
    const packages = lock[section];
    if (!isRecord(packages)) continue;
    for (const [identity, value] of Object.entries(packages)) {
      if (!isRecord(value)) continue;
      const { name, version } = parseNameAndVersion(identity);
      components.push(libraryComponent({
        source: `deno-lock:${section}`,
        identity,
        name,
        version,
        integrity: optionalString(value, "integrity"),
      }));
    }
  }
  return components;
}

function npmLockComponents(lock: unknown): readonly Component[] {
  if (!isRecord(lock) || !isRecord(lock.packages)) {
    throw new TypeError("package-lock.json must contain a packages object.");
  }
  const components: Component[] = [];
  for (const [lockPath, value] of Object.entries(lock.packages)) {
    if (lockPath === "" || !isRecord(value)) continue;
    const name = optionalString(value, "name") || nameFromNpmLockPath(lockPath);
    components.push(libraryComponent({
      source: "npm-lock:src/ui/package-lock.json",
      identity: lockPath,
      name,
      version: optionalString(value, "version"),
      integrity: optionalString(value, "integrity"),
      license: optionalString(value, "license"),
      resolved: optionalString(value, "resolved"),
    }));
  }
  return components;
}

export function sourceLockComponents(
  denoLock: unknown,
  uiPackageLock: unknown,
): readonly Component[] {
  return [...denoLockComponents(denoLock), ...npmLockComponents(uiPackageLock)]
    .sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"]));
}

const CANONICAL_AGPL_V3_HEADER =
  "                    GNU AFFERO GENERAL PUBLIC LICENSE\n" +
  "                       Version 3, 19 November 2007";

export function repositoryLicenseName(text: string): string {
  return text.startsWith(CANONICAL_AGPL_V3_HEADER) ? "AGPL-3.0-only" : "NOASSERTION";
}

export async function deterministicBomUuid(seed: string): Promise<string> {
  const raw = (await sha256Text(seed)).slice(0, 32).split("");
  raw[12] = "5";
  raw[16] = ["8", "9", "a", "b"][Number.parseInt(raw[16]!, 16) % 4]!;
  return `urn:uuid:${raw.slice(0, 8).join("")}-${raw.slice(8, 12).join("")}-${
    raw.slice(12, 16).join("")
  }-${raw.slice(16, 20).join("")}-${raw.slice(20, 32).join("")}`;
}

function readBomComponents(bom: JsonRecord): Component[] {
  const components = bom.components;
  if (!Array.isArray(components)) {
    throw new TypeError("CycloneDX output must contain components.");
  }
  return components.filter(isRecord).map((component) =>
    component as unknown as Component
  );
}

export function renderNotices(bom: JsonRecord): string {
  const lines = [
    "# Third-party source inventory notices",
    "",
    "This deterministic inventory is derived only from the included source lockfiles.",
    "It is not a substitute for notices required by an OCI image, Desktop bundle,",
    "downloaded runtime, package cache, provider, worker, or other distributed artifact.",
    "`NOASSERTION` means the source lock did not provide a value; it is not a guessed licence.",
    "",
    "| Component | Version | Source lock | Declared licence | Integrity |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (
    const component of readBomComponents(bom).sort((left, right) =>
      left["bom-ref"].localeCompare(right["bom-ref"])
    )
  ) {
    const properties = new Map(
      component.properties.map((property) => [property.name, property.value]),
    );
    const license = component.licenses[0]?.license.name ?? "NOASSERTION";
    lines.push(
      `| ${escapeCell(component.name)} | ${escapeCell(component.version)} | ${
        escapeCell(properties.get("casys:inventory-source") ?? "NOASSERTION")
      } | ${escapeCell(license)} | ${
        escapeCell(properties.get("casys:integrity") ?? "NOASSERTION")
      } |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|");
}
