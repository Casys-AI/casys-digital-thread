/**
 * Image-owned CalculiX static-proof wrapper.
 *
 * OCI builds cache the exact JSR dependency and copy this file to
 * `/opt/casys/profiles/calculix-static-proof-v1/run.ts`. The Microsandbox
 * adapter invokes Deno directly with two fixed arguments (bundle, output
 * directory); neither the agent nor the bundle can select a command or path.
 */

import {
  buildDeck,
  canonicalJson,
  meshStepRecorded,
  resolveRecordedStaticRequest,
  solveDeckRecorded,
} from "jsr:@casys/mcp-calculix@0.7.0";
import { CALCULIX_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

const BUNDLE_SCHEMA = "calculix-isolated-static-input-bundle/1.0";
const REQUEST_SCHEMA = "calculix-isolated-static-request/1.0";
const RESULT_SCHEMA = "calculix-isolated-static-result/1.0";
const PROFILE = Object.freeze({ id: "calculix-static-proof-v1", version: "1.0.0" });
const MAGIC = new TextEncoder().encode("CASYS-CALCULIX-STATIC-BUNDLE/1.0\n");
const MAXIMUM_MANIFEST_BYTES = 1_048_576;

if (import.meta.main) await main();

async function main(): Promise<void> {
  const worker = CALCULIX_MICROSANDBOX_WORKER_CONTRACT;
  if (
    Deno.args.length !== 2 || Deno.args[0] !== worker.sourcePath ||
    Deno.args[1] !== worker.outputDirectory
  ) fail("The fixed CalculiX wrapper requires its registered paths.");
  const [bundlePath, outputDirectory] = Deno.args;
  const bundle = await parseBundle(await Deno.readFile(bundlePath));
  await assertEmptyOutputDirectory(outputDirectory);

  const executionIdentity = await observedExecutionIdentity();
  const proof = record(bundle.manifest.proof, "bundle.proof");
  const analysis = record(proof.analysis, "bundle.proof.analysis");
  const material = record(analysis.material, "bundle.proof.analysis.material");
  const mesh = record(analysis.mesh, "bundle.proof.analysis.mesh");
  const supports = array(analysis.supports, "bundle.proof.analysis.supports");
  const loads = array(analysis.loads, "bundle.proof.analysis.loads");
  if (supports.length === 0 || loads.length === 0) {
    fail("The proof must contain at least one support and one load.");
  }
  const selections = [
    ...supports.map((support, index) => selectionFrom(support, `supports[${index}]`)),
    ...loads.map((load, index) => selectionFrom(load, `loads[${index}]`)),
  ];
  const fixed = supports.map((support, index) => {
    const item = record(support, `supports[${index}]`);
    literal(item.kind, "fixed", `supports[${index}].kind`);
    return selectionName(record(item.selection, `supports[${index}].selection`).name);
  });
  const normalizedLoads = loads.map((load, index) => {
    const item = record(load, `loads[${index}]`);
    literal(item.kind, "force", `loads[${index}].kind`);
    const force = record(item.force, `loads[${index}].force`);
    literal(force.unit, "N", `loads[${index}].force.unit`);
    return {
      selection: selectionName(
        record(item.selection, `loads[${index}].selection`).name,
      ),
      force_n: vector(force.value, `loads[${index}].force.value`),
    };
  });
  const effective = record(bundle.manifest.effective, "bundle.effective");
  const step = record(bundle.manifest.step, "bundle.step");
  const youngModulus = record(
    material.youngModulus,
    "bundle.proof.analysis.material.youngModulus",
  );
  const poissonRatio = record(
    material.poissonRatio,
    "bundle.proof.analysis.material.poissonRatio",
  );
  const targetSize = record(mesh.targetSize, "bundle.proof.analysis.mesh.targetSize");
  literal(youngModulus.unit, "MPa", "youngModulus.unit");
  literal(poissonRatio.unit, "1", "poissonRatio.unit");
  literal(targetSize.unit, "mm", "targetSize.unit");

  // Reuse the qualified mcp-calculix core validator and lowering, without an
  // MCP server or agent-selected `.inp` deck.
  const dispatch = resolveRecordedStaticRequest({
    request_id: text(bundle.manifest.requestId, "bundle.requestId"),
    step_path: "input.step",
    expected_step_sha256: digest(step.sha256, "bundle.step.sha256"),
    mesh_size_mm: positive(targetSize.value, "targetSize.value"),
    element_order: elementOrder(effective.elementOrder),
    material: {
      e_mpa: positive(youngModulus.value, "youngModulus.value"),
      nu: poisson(poissonRatio.value),
    },
    selections,
    fixed,
    loads: normalizedLoads,
    timeout_ms: positiveInteger(effective.timeoutMs, "effective.timeoutMs"),
  }, {
    schema_version: "1.0",
    server: { package: "@casys/mcp-calculix", version: "0.7.0" },
    method: { id: "calculix_solve_static_recorded", version: "1.0" },
    lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
    engines: {
      gmsh: executionIdentity.engines.gmsh,
      ccx: executionIdentity.engines.ccx,
    },
    image: { status: "unattested" },
  });

  await Deno.writeFile(`${outputDirectory}/input.step`, bundle.step, {
    createNew: true,
    mode: 0o400,
  });
  const requestDocument = {
    schemaVersion: REQUEST_SCHEMA,
    requestId: dispatch.requestId,
    proofFingerprint: bundle.manifest.proofFingerprint,
    effective: bundle.manifest.effective,
    step: bundle.manifest.step,
  };
  await writeCanonicalJson(
    `${outputDirectory}/request.json`,
    requestDocument,
  );

  const meshed = await meshStepRecorded({
    stepPath: `${outputDirectory}/input.step`,
    selections: dispatch.selections,
    meshSizeMm: dispatch.meshSizeMm,
    elementOrder: dispatch.elementOrder,
    timeoutMs: dispatch.timeoutMs,
  });
  await writeText(`${outputDirectory}/mesh.geo`, meshed.artifacts.geoText);
  await writeText(`${outputDirectory}/mesh.inp`, meshed.artifacts.cleanedInpText);
  await writeText(`${outputDirectory}/gmsh.log`, meshed.artifacts.diagnostics);

  const deck = buildDeck({
    inpText: meshed.mesh.inpText,
    maxNodeId: meshed.mesh.maxNodeId,
    material: { eMpa: dispatch.material.e_mpa, nu: dispatch.material.nu },
    fixed: [...dispatch.fixed],
    loads: dispatch.loads.map((load) => ({
      selection: load.selection,
      totalForceN: [...load.force_n],
    })),
    nodesPerSet: meshed.mesh.nodesPerSet,
  });
  await writeText(`${outputDirectory}/job.inp`, deck);
  const solved = await solveDeckRecorded(deck, dispatch.timeoutMs);
  await writeText(`${outputDirectory}/ccx.log`, solved.diagnostics);
  await writeText(`${outputDirectory}/job.dat`, solved.datText);
  await writeCanonicalJson(`${outputDirectory}/result.json`, {
    schemaVersion: RESULT_SCHEMA,
    requestId: dispatch.requestId,
    executionIdentity,
    inputArtifact: {
      mediaType: "model/step",
      byteCount: bundle.step.byteLength,
      sha256: await sha256(bundle.step),
    },
    mesh: {
      nodes: meshed.mesh.nodeCount,
      elements: meshed.mesh.elementCount,
      nodesPerSelection: meshed.mesh.nodesPerSet,
    },
    constraints: {
      fixedSelections: dispatch.fixed,
      loads: dispatch.loads.map((load) => ({
        selection: load.selection,
        forceN: load.force_n,
      })),
    },
    metrics: {
      maximumDisplacement: {
        value: solved.result.maxDisplacement.magnitudeMm,
        unit: "mm",
        nodeId: solved.result.maxDisplacement.nodeId,
        vectorMm: solved.result.maxDisplacement.vectorMm,
      },
      maximumVonMises: {
        value: solved.result.maxVonMises.mpa,
        unit: "MPa",
        elementId: solved.result.maxVonMises.elementId,
      },
    },
  });
  await assertExactOutputDirectory(outputDirectory);
  await writeControlEvidence();
}

async function assertExactOutputDirectory(path: string): Promise<void> {
  const expected = [
    "ccx.log",
    "gmsh.log",
    "input.step",
    "job.dat",
    "job.inp",
    "mesh.geo",
    "mesh.inp",
    "request.json",
    "result.json",
  ];
  const observed: string[] = [];
  for await (const entry of Deno.readDir(path)) {
    if (!entry.isFile || entry.isSymlink) {
      fail("The CalculiX output set is not regular files.");
    }
    observed.push(entry.name);
  }
  observed.sort(compareAscii);
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    fail("The CalculiX worker emitted an unexpected output set.");
  }
}

async function writeControlEvidence(): Promise<void> {
  const control = CALCULIX_MICROSANDBOX_WORKER_CONTRACT.controlFiles;
  await Deno.mkdir(control.directory, { mode: 0o700 });
  for (const path of [control.stdoutPath, control.stderrPath]) {
    await Deno.writeFile(path, new Uint8Array(), {
      createNew: true,
      mode: 0o400,
    });
  }
  // Written last: every declared output and both awaited engine invocations
  // have completed before the backend may expose the output inventory.
  await Deno.writeTextFile(control.quiescencePath, control.quiescenceText, {
    createNew: true,
    mode: 0o400,
  });
  const expected = ["quiesced.json", "stderr.bin", "stdout.bin"];
  const observed: string[] = [];
  for await (const entry of Deno.readDir(control.directory)) {
    if (!entry.isFile || entry.isSymlink) {
      fail("The CalculiX control evidence is not regular files.");
    }
    observed.push(entry.name);
  }
  observed.sort(compareAscii);
  if (
    canonicalJson(observed) !== canonicalJson(expected) ||
    await Deno.readTextFile(control.quiescencePath) !== control.quiescenceText ||
    (await Deno.readFile(control.stdoutPath)).byteLength !== 0 ||
    (await Deno.readFile(control.stderrPath)).byteLength !== 0
  ) fail("The CalculiX control evidence failed its exact reread.");
}

interface ParsedBundle {
  readonly manifest: Record<string, unknown>;
  readonly step: Uint8Array;
}

async function parseBundle(bytes: Uint8Array): Promise<ParsedBundle> {
  if (!startsWith(bytes, MAGIC)) fail("Invalid CalculiX bundle magic.");
  const lengthStart = MAGIC.byteLength;
  const lengthEnd = bytes.indexOf(10, lengthStart);
  if (lengthEnd < 0 || lengthEnd - lengthStart > 10) fail("Invalid bundle length.");
  const lengthText = decode(bytes.subarray(lengthStart, lengthEnd), "bundle length");
  if (!/^[1-9][0-9]*$/.test(lengthText)) fail("Non-canonical bundle length.");
  const manifestLength = Number(lengthText);
  if (
    !Number.isSafeInteger(manifestLength) || manifestLength > MAXIMUM_MANIFEST_BYTES
  ) {
    fail("Invalid bundle manifest length.");
  }
  const manifestStart = lengthEnd + 1;
  const manifestEnd = manifestStart + manifestLength;
  if (manifestEnd >= bytes.byteLength) fail("Bundle has no STEP payload.");
  const manifestText = decode(
    bytes.subarray(manifestStart, manifestEnd),
    "bundle manifest",
  );
  const manifest = record(JSON.parse(manifestText), "bundle manifest");
  if (canonicalJson(manifest) !== manifestText) {
    fail("Bundle manifest is not canonical.");
  }
  exactKeys(manifest, [
    "effective",
    "proof",
    "proofFingerprint",
    "requestId",
    "schemaVersion",
    "step",
  ], "bundle manifest");
  literal(manifest.schemaVersion, BUNDLE_SCHEMA, "bundle.schemaVersion");
  const proofFingerprint = record(manifest.proofFingerprint, "proofFingerprint");
  exactKeys(proofFingerprint, ["algorithm", "digest"], "proofFingerprint");
  literal(proofFingerprint.algorithm, "sha256", "proofFingerprint.algorithm");
  if (
    await sha256(new TextEncoder().encode(canonicalJson(manifest.proof))) !==
      digest(proofFingerprint.digest, "proofFingerprint.digest")
  ) {
    fail("Bundle proof fingerprint mismatch.");
  }
  const step = bytes.slice(manifestEnd);
  const stepIdentity = record(manifest.step, "bundle.step");
  exactKeys(
    stepIdentity,
    ["basename", "byteCount", "mediaType", "sha256"],
    "bundle.step",
  );
  literal(stepIdentity.basename, "input.step", "bundle.step.basename");
  literal(stepIdentity.mediaType, "model/step", "bundle.step.mediaType");
  if (
    positiveInteger(stepIdentity.byteCount, "bundle.step.byteCount") !==
      step.byteLength ||
    digest(stepIdentity.sha256, "bundle.step.sha256") !== await sha256(step)
  ) fail("Bundle STEP identity mismatch.");
  const stepText = decode(step, "STEP input");
  if (
    !stepText.startsWith("ISO-10303-21;") ||
    !stepText.trimEnd().endsWith("END-ISO-10303-21;")
  ) {
    fail("Bundle STEP is not one complete Part 21 file.");
  }
  return Object.freeze({ manifest, step });
}

async function observedExecutionIdentity() {
  const [gmsh, ccx] = await Promise.all([
    executableVersion("gmsh", ["--version"]),
    executableVersion("ccx", ["-v"]),
  ]);
  return {
    schemaVersion: "1.0",
    profile: PROFILE,
    wrapper: PROFILE,
    lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
    engines: {
      gmsh: { command: "gmsh" as const, version: gmsh },
      ccx: { command: "ccx" as const, version: ccx },
    },
    image: { status: "bound-by-isolated-runner-receipt" as const },
  };
}

async function executableVersion(command: "gmsh" | "ccx", args: string[]) {
  const output = await new Deno.Command(command, {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const version = `${decode(output.stdout, command)}${decode(output.stderr, command)}`
    .trim().replaceAll(/\s+/g, " ");
  const accepted = command === "ccx"
    ? /\bversion\s+[0-9]/i.test(version)
    : output.success;
  if (!accepted || version.length === 0 || version.length > 128) {
    fail(`Cannot attest ${command} version.`);
  }
  return version;
}

function selectionFrom(value: unknown, path: string) {
  const item = record(value, path);
  const selected = record(item.selection, `${path}.selection`);
  const box = record(selected.box, `${path}.selection.box`);
  literal(box.unit, "mm", `${path}.selection.box.unit`);
  return {
    name: selectionName(selected.name),
    box: {
      min: vector(box.min, `${path}.selection.box.min`),
      max: vector(box.max, `${path}.selection.box.max`),
    },
  };
}

async function assertEmptyOutputDirectory(path: string): Promise<void> {
  for await (const _ of Deno.readDir(path)) fail("The output directory is not empty.");
}

async function writeCanonicalJson(path: string, value: unknown): Promise<void> {
  await writeText(path, canonicalJson(value));
}

async function writeText(path: string, value: string): Promise<void> {
  await Deno.writeTextFile(path, value, { createNew: true, mode: 0o400 });
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  return value;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value: Record<string, unknown>, keys: string[], path: string): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    fail(`${path} has an unsupported shape.`);
  }
}

function literal(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) fail(`${path} is unsupported.`);
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    fail(`${path} is invalid.`);
  }
  return value;
}

function selectionName(value: unknown): string {
  const name = text(value, "selection name");
  if (!/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(name)) fail("Invalid selection name.");
  return name;
}

function digest(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^[a-f0-9]{64}$/.test(result)) fail(`${path} is not SHA-256.`);
  return result;
}

function positive(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(`${path} must be positive.`);
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail(`${path} must be a positive integer.`);
  }
  return Number(value);
}

function elementOrder(value: unknown): 1 | 2 {
  if (value !== 1 && value !== 2) fail("Unsupported element order.");
  return value;
}

function poisson(value: unknown): number {
  if (
    typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 0.5
  ) {
    fail("Invalid Poisson ratio.");
  }
  return value;
}

function vector(value: unknown, path: string): [number, number, number] {
  if (
    !Array.isArray(value) || value.length !== 3 ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) {
    fail(`${path} must be a finite vector.`);
  }
  return [value[0], value[1], value[2]] as [number, number, number];
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return value.byteLength >= prefix.byteLength &&
    prefix.every((byte, index) => value[index] === byte);
}

function decode(value: Uint8Array, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    fail(`${path} is not UTF-8.`);
  }
}

async function sha256(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fail(message: string): never {
  throw new TypeError(message);
}
