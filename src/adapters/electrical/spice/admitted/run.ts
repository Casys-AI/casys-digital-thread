/** Image-owned ngspice operating-point execution for circuit-only SPICE v1. */

import {
  type AuthorizedSpiceCircuitClosedSubsetV1Source,
  authorizeSpiceCircuitClosedSubsetV1Source,
} from "../../../../domain/electrical/spice/closed-subset-v1.ts";
import {
  SPICE_ADMITTED_EVIDENCE_OUTPUT,
  SPICE_ADMITTED_MAX_DURATION_MS,
  SPICE_ADMITTED_MAX_EVIDENCE_BYTES,
  SPICE_ADMITTED_MAX_LOG_BYTES,
  SPICE_ADMITTED_MAX_OBSERVABLES,
  SPICE_ADMITTED_MAX_RESULT_BYTES,
  SPICE_ADMITTED_MAX_SOURCE_BYTES,
  SPICE_ADMITTED_MAX_VECTOR_BYTES,
  SPICE_ADMITTED_RESULT_OUTPUT,
  SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE,
  SPICE_ISOLATED_EVIDENCE_LIMITATIONS,
  SPICE_ISOLATED_EVIDENCE_SCHEMA,
  SPICE_OPERATING_POINT_ANALYSIS_KIND,
  SPICE_OPERATING_POINT_ENGINE_NAME,
  SPICE_OPERATING_POINT_EXPORT,
  SPICE_OPERATING_POINT_RESULT_SCHEMA,
  SPICE_OPERATING_POINT_SIGN_CONVENTION,
  SPICE_OPERATING_POINT_WRAPPER,
} from "../../../../domain/electrical/spice/admitted/contract.ts";
import { NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

const PATHS = NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT;
const TITLE = "casys spice-circuit-closed-subset-v1 operating-point";
const EXPORT_DONE = "CASYS_NGSPICE_OP_EXPORT_DONE";
const VECTOR_LINE = /^([^ =][^=]*?) = ([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i;
const NATIVE_NAME =
  /^(?:v\([a-z0-9_]{1,64}\)|i\([a-z0-9_]{1,64}\)|@[a-z][a-z0-9_]{0,63}\[[a-z]{1,16}\])$/;

export interface SpiceOperatingPointPlanItem {
  readonly nativeName: string;
  readonly kind: "node-voltage" | "branch-current";
  readonly sourceSymbol: string;
  readonly unit: "V" | "A";
}

export interface AuthorizedAdmittedSpiceSource {
  readonly source: AuthorizedSpiceCircuitClosedSubsetV1Source;
  readonly sha256: string;
  readonly byteCount: number;
}

if (import.meta.main) await main();

async function main(): Promise<void> {
  if (Deno.args.length !== 0) {
    fail("The ngspice worker accepts no caller arguments.");
  }
  const authorized = await authorizeAdmittedSpiceSource(
    await Deno.readFile(PATHS.sourcePath),
  );
  await assertEmptyDirectory(PATHS.outputDirectory, "output");
  await assertEmptyDirectory(PATHS.workDirectory, "work");
  const plan = spiceOperatingPointPlanFor(authorized.source);
  const netlist = buildSpiceOperatingPointNetlist(authorized.source.sourceText, plan);
  await Deno.writeTextFile(PATHS.runNetlistPath, netlist, {
    createNew: true,
    mode: 0o400,
  });
  await runNgspice();
  const observables = parseSpiceOperatingPointVectors(
    await Deno.readTextFile(PATHS.vectorPath),
    plan,
  );
  const result = {
    schemaVersion: SPICE_OPERATING_POINT_RESULT_SCHEMA,
    analysisKind: SPICE_OPERATING_POINT_ANALYSIS_KIND,
    signConvention: SPICE_OPERATING_POINT_SIGN_CONVENTION,
    observables,
  };
  const resultBytes = new TextEncoder().encode(canonicalJson(result));
  if (resultBytes.byteLength > SPICE_ADMITTED_MAX_RESULT_BYTES) {
    fail("The operating-point result exceeds the worker byte bound.");
  }
  const evidence = {
    schemaVersion: SPICE_ISOLATED_EVIDENCE_SCHEMA,
    status: "succeeded",
    analysisKind: SPICE_OPERATING_POINT_ANALYSIS_KIND,
    inputSourceSha256: authorized.sha256,
    profile: SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE,
    wrapper: SPICE_OPERATING_POINT_WRAPPER,
    method: {
      engine: await ngspiceEngine(),
      export: SPICE_OPERATING_POINT_EXPORT,
    },
    counts: {
      sourceBytes: authorized.byteCount,
      observableCount: observables.length,
      nodeVoltageCount: observables.filter((item) => item.kind === "node-voltage")
        .length,
      branchCurrentCount:
        observables.filter((item) => item.kind === "branch-current").length,
    },
    limits: {
      maxSourceBytes: SPICE_ADMITTED_MAX_SOURCE_BYTES,
      maxObservables: SPICE_ADMITTED_MAX_OBSERVABLES,
      maxResultBytes: SPICE_ADMITTED_MAX_RESULT_BYTES,
      maxEvidenceBytes: SPICE_ADMITTED_MAX_EVIDENCE_BYTES,
      maxVectorBytes: SPICE_ADMITTED_MAX_VECTOR_BYTES,
      maxDurationMs: SPICE_ADMITTED_MAX_DURATION_MS,
    },
    limitations: SPICE_ISOLATED_EVIDENCE_LIMITATIONS,
    warnings: [],
    result: {
      role: SPICE_ADMITTED_RESULT_OUTPUT.role,
      basename: SPICE_ADMITTED_RESULT_OUTPUT.basename,
      byteCount: resultBytes.byteLength,
      sha256: await sha256(resultBytes),
    },
  };
  const evidenceBytes = new TextEncoder().encode(canonicalJson(evidence));
  if (evidenceBytes.byteLength > SPICE_ADMITTED_MAX_EVIDENCE_BYTES) {
    fail("The operating-point evidence exceeds the worker byte bound.");
  }
  await Deno.writeFile(
    `${PATHS.outputDirectory}/${SPICE_ADMITTED_RESULT_OUTPUT.basename}`,
    resultBytes,
    { createNew: true, mode: 0o400 },
  );
  await Deno.writeFile(
    `${PATHS.outputDirectory}/${SPICE_ADMITTED_EVIDENCE_OUTPUT.basename}`,
    evidenceBytes,
    { createNew: true, mode: 0o400 },
  );
  await assertExactOutputDirectory(PATHS.outputDirectory);
  await writeControlEvidence();
}

export async function authorizeAdmittedSpiceSource(
  bytes: Uint8Array,
): Promise<AuthorizedAdmittedSpiceSource> {
  if (
    !(bytes instanceof Uint8Array) || bytes.byteLength === 0 ||
    bytes.byteLength > SPICE_ADMITTED_MAX_SOURCE_BYTES
  ) {
    fail("The admitted SPICE source must contain 1 to 262144 bytes.");
  }
  let sourceText: string;
  try {
    sourceText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("The admitted SPICE source is not UTF-8.");
  }
  if (new TextEncoder().encode(sourceText).byteLength !== bytes.byteLength) {
    fail("The admitted SPICE source is not canonical UTF-8.");
  }
  return Object.freeze({
    source: authorizeSpiceCircuitClosedSubsetV1Source(sourceText),
    sha256: await sha256(bytes),
    byteCount: bytes.byteLength,
  });
}

/** Server-owned observables: node voltages and currents ngspice exposes. */
export function spiceOperatingPointPlanFor(
  source: AuthorizedSpiceCircuitClosedSubsetV1Source,
): readonly SpiceOperatingPointPlanItem[] {
  const plan: SpiceOperatingPointPlanItem[] = [];
  for (const node of source.nodes) {
    if (foldName(node) === "0") continue;
    plan.push({
      nativeName: `v(${foldName(node)})`,
      kind: "node-voltage",
      sourceSymbol: node,
      unit: "V",
    });
  }
  for (const element of source.elements) {
    const folded = foldName(element.name);
    switch (element.type) {
      case "R":
      case "C":
      case "L":
        plan.push(current(`@${folded}[i]`, element.name));
        break;
      case "V":
        plan.push(current(`i(${folded})`, element.name));
        break;
      case "I":
        plan.push(current(`@${folded}[current]`, element.name));
        break;
      case "D":
        plan.push(current(`@${folded}[id]`, element.name));
        break;
      case "Q":
        for (const param of ["ib", "ic", "ie"] as const) {
          plan.push(current(`@${folded}[${param}]`, element.name));
        }
        break;
      case "M":
        for (const param of ["id", "ig", "is", "ib"] as const) {
          plan.push(current(`@${folded}[${param}]`, element.name));
        }
        break;
      case "K":
        break;
    }
  }
  if (plan.length < 1 || plan.length > SPICE_ADMITTED_MAX_OBSERVABLES) {
    fail("The operating-point plan must contain 1 to 2048 observables.");
  }
  for (const item of plan) assertSafeNativeName(item.nativeName);
  return Object.freeze(plan.map((item) => Object.freeze(item)));
}

/** Exact source plus a separate server-owned OP analysis/control/end block. */
export function buildSpiceOperatingPointNetlist(
  sourceText: string,
  plan: readonly SpiceOperatingPointPlanItem[],
): string {
  if (typeof sourceText !== "string" || sourceText.length === 0) {
    fail("The run netlist requires the exact circuit source.");
  }
  const sourceBlock = sourceText.endsWith("\n") ? sourceText.slice(0, -1) : sourceText;
  const prints = plan.map((item, index) => {
    assertSafeNativeName(item.nativeName);
    const redirect = index === 0 ? ">" : ">>";
    return `print ${item.nativeName} ${redirect} ${PATHS.vectorPath}`;
  });
  return [
    TITLE,
    sourceBlock,
    "",
    "* casys-server-owned-operating-point",
    ".options savecurrents",
    ".control",
    "set noaskquit",
    "unset moremode",
    "op",
    ...prints,
    `echo ${EXPORT_DONE}`,
    "quit",
    ".endc",
    ".end",
    "",
  ].join("\n");
}

export function parseSpiceOperatingPointVectors(
  text: string,
  plan: readonly SpiceOperatingPointPlanItem[],
): readonly {
  readonly nativeName: string;
  readonly kind: "node-voltage" | "branch-current";
  readonly sourceSymbol: string;
  readonly value: number;
  readonly unit: "V" | "A";
}[] {
  if (text.length === 0 || text.length > SPICE_ADMITTED_MAX_VECTOR_BYTES) {
    fail("The ngspice vector file exceeds the worker bound.");
  }
  if (!text.endsWith("\n") || text.includes("\r") || text.includes("\0")) {
    fail("The ngspice vector file must be canonical LF text.");
  }
  const byNative = new Map(plan.map((item) => [item.nativeName, item]));
  if (byNative.size !== plan.length) fail("The operating-point plan is not unique.");
  const seen = new Set<string>();
  const parsed: {
    nativeName: string;
    kind: "node-voltage" | "branch-current";
    sourceSymbol: string;
    value: number;
    unit: "V" | "A";
  }[] = [];
  for (const line of text.slice(0, -1).split("\n")) {
    const match = VECTOR_LINE.exec(line);
    if (!match) fail("The ngspice vector file has an unexpected line.");
    const nativeName = match[1]!.trim().toLowerCase();
    assertSafeNativeName(nativeName);
    if (seen.has(nativeName)) fail("The ngspice vector file has a duplicate name.");
    const item = byNative.get(nativeName);
    if (item === undefined) fail("The ngspice vector file has an undeclared name.");
    const value = Number(match[2]);
    if (!Number.isFinite(value)) {
      fail("The ngspice vector file has a non-finite value.");
    }
    seen.add(nativeName);
    parsed.push({
      nativeName: item.nativeName,
      kind: item.kind,
      sourceSymbol: item.sourceSymbol,
      value,
      unit: item.unit,
    });
  }
  if (seen.size !== plan.length) {
    fail("The ngspice vector file is missing a planned observable.");
  }
  parsed.sort((left, right) => compareAscii(left.nativeName, right.nativeName));
  return Object.freeze(parsed.map((item) => Object.freeze(item)));
}

async function runNgspice(): Promise<void> {
  let command: Deno.CommandOutput;
  try {
    command = await new Deno.Command("ngspice", {
      args: ["-b", "-n", "-o", PATHS.logPath, PATHS.runNetlistPath],
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(SPICE_ADMITTED_MAX_DURATION_MS),
    }).output();
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      fail("ngspice exceeded the worker's code-owned 30000 ms timeout.");
    }
    throw error;
  }
  if (!command.success) {
    fail(`ngspice failed${diagnostic(command.stderr)}`);
  }
  let log = "";
  try {
    log = await Deno.readTextFile(PATHS.logPath);
  } catch {
    fail("ngspice did not write its code-owned log.");
  }
  if (log.length > SPICE_ADMITTED_MAX_LOG_BYTES) {
    fail("The ngspice log exceeds the worker bound.");
  }
  if (/\bError:/i.test(log)) fail("ngspice reported an error.");
  if (!log.includes(EXPORT_DONE)) {
    fail("ngspice did not finish the server-owned export.");
  }
}

async function ngspiceEngine(): Promise<{ name: "ngspice"; version: string }> {
  const version = await new Deno.Command("ngspice", {
    args: ["--version"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!version.success) fail("ngspice version read failed.");
  const text = `${decode(version.stdout)}\n${decode(version.stderr)}`;
  const match = text.match(/\bngspice-(\d+)\b/i);
  if (!match) fail("ngspice version read was empty.");
  return { name: SPICE_OPERATING_POINT_ENGINE_NAME, version: match[1]! };
}

function current(
  nativeName: string,
  sourceSymbol: string,
): SpiceOperatingPointPlanItem {
  return {
    nativeName,
    kind: "branch-current",
    sourceSymbol,
    unit: "A",
  };
}

function assertSafeNativeName(name: string): void {
  if (!NATIVE_NAME.test(name) || name !== name.toLowerCase()) {
    fail("The operating-point native name is not server-owned.");
  }
}

function foldName(name: string): string {
  return name.toLowerCase();
}

async function assertEmptyDirectory(path: string, label: string): Promise<void> {
  const info = await Deno.lstat(path);
  if (!info.isDirectory || info.isSymlink) {
    fail(`The fixed ${label} path is not a directory.`);
  }
  for await (const _entry of Deno.readDir(path)) {
    fail(`The fixed ${label} directory is not empty.`);
  }
}

async function assertExactOutputDirectory(path: string): Promise<void> {
  const entries: string[] = [];
  for await (const entry of Deno.readDir(path)) {
    if (!entry.isFile || entry.isSymlink) {
      fail("The SPICE output set is not regular files.");
    }
    entries.push(entry.name);
  }
  entries.sort(compareAscii);
  if (
    JSON.stringify(entries) !==
      JSON.stringify([
        SPICE_ADMITTED_EVIDENCE_OUTPUT.basename,
        SPICE_ADMITTED_RESULT_OUTPUT.basename,
      ].sort(compareAscii))
  ) {
    fail("The ngspice worker emitted an unexpected output set.");
  }
}

async function writeControlEvidence(): Promise<void> {
  const control = PATHS.controlFiles;
  await Deno.mkdir(control.directory, { mode: 0o700 });
  for (const path of [control.stdoutPath, control.stderrPath]) {
    await Deno.writeFile(path, new Uint8Array(), { createNew: true, mode: 0o400 });
  }
  await Deno.writeFile(
    control.quiescencePath,
    new TextEncoder().encode(control.quiescenceText),
    { createNew: true, mode: 0o400 },
  );
}

function canonicalJson(value: unknown): string {
  if (
    value === null || typeof value === "number" || typeof value === "boolean" ||
    typeof value === "string"
  ) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${
      Object.entries(value as Record<string, unknown>).filter(([, item]) =>
        item !== undefined
      ).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) =>
        `${JSON.stringify(key)}:${canonicalJson(item)}`
      ).join(",")
    }}`;
  }
  fail("Canonical JSON cannot encode this value.");
}

function diagnostic(bytes: Uint8Array): string {
  const sanitized = decode(bytes).split("").map((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? " " : char;
  }).join("").trim().slice(-1_000);
  return sanitized.length === 0 ? "." : `: ${sanitized}`;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function compareAscii(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fail(message: string): never {
  throw new TypeError(message);
}
