/**
 * Qualification preflight for the fixed Modelica worker image.
 *
 * Default mode is read-only planning. `--run-container-preflight` exercises
 * the real OMC binary in the image with a deny-all Docker boundary and then
 * validates both declared outputs outside it. This is deliberately not the
 * Microsandbox MicroVM qualification required to activate the profile.
 */

import {
  MODELICA_ISOLATED_OUTPUT_MANIFEST,
  validateModelicaIsolatedInputBundle,
  validateModelicaIsolatedOutput,
  validateModelicaIsolatedRun,
} from "../../src/domain/modelica/qualified-kit/isolated-execution.ts";
import { fingerprintResourceBytes } from "../../src/domain/compile/source/provider-resource-reader.ts";
import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";
import { createModelicaMicrosandboxQualificationKit } from "../../src/adapters/modelica/qualified-kit/kit-v1/qualification-kit.ts";
import { MODELICA_QUALIFIED_KIT_WRAPPER_SHA256 } from "../../src/adapters/modelica/qualified-kit/execution-profile.ts";
import { MODELICA_MICROSANDBOX_WORKER_CONTRACT } from "../../src/adapters/modelica/qualified-kit/kit-v1/worker-contract.ts";

const DEFAULT_IMAGE = "casys/modelica-microsandbox-worker:gate";
const CONTAINER_PID_LIMIT = 64;
const WRAPPER = "src/adapters/modelica/qualified-kit/kit-v1/run.ts";
const DENO_LOCK = "images/modelica-microsandbox-worker/deno.lock";
const WORKER_CONTRACT = "src/adapters/modelica/qualified-kit/kit-v1/worker-contract.ts";
const WORKER_CONTRACT_SHA256 =
  "043132ed24db6df3f9ded2e688a70d4cf6527841f626a9134f0ced49a2f61b72";
const DENO_LOCK_SHA256 =
  "458cd80498b070cb2313cfdf5f4184a70272f689a9c20d7fc90acff655b88e65";
const EXPECTED_ENTRYPOINT = Object.freeze([
  MODELICA_MICROSANDBOX_WORKER_CONTRACT.executable,
  ...MODELICA_MICROSANDBOX_WORKER_CONTRACT.args,
]);

const options = parseArgs(Deno.args);
if (!options.runContainerPreflight) {
  console.log(deterministicJson({
    schemaVersion: "modelica-microsandbox-worker-gate-plan/1.0",
    status: "not-run",
    image: options.image,
    containerPreflight: [
      "digest-and-label-binding",
      "single-local-image-id-snapshot",
      "non-root-user-and-direct-entrypoint",
      "docker-network-none",
      "read-only-rootfs",
      "capabilities-dropped",
      "exact-linear-ramp-bundle",
      "real-omc-and-msl-probe",
      "direct-wrapper-execution",
      "exact-quiescence-and-log-control-files",
      "two-regular-bounded-outputs",
      "external-bundle-csv-and-evidence-validation",
    ],
    activationGate: [
      "publish-worker-by-oci-digest",
      "execute-same-bundle-in-microsandbox-0.6.8-local-microvm",
      "reopen-published-output-batch-through-cas",
      "repeat-external-output-validation",
      "persist-reviewed-qualified-live-smoke-capture",
    ],
  }));
  Deno.exit(0);
}

await runContainerPreflight(options.image);

async function runContainerPreflight(image: string): Promise<void> {
  const temporary = await Deno.makeTempDir({ prefix: "casys-modelica-gate-" });
  try {
    const inspected = await inspectWorkerImage(image);
    const frozenImage = inspected.localImageId;
    const probeDirectory = `${temporary}/probe`;
    const probeWorkDirectory = `${temporary}/probe-work`;
    const inputDirectory = `${temporary}/input`;
    const outputDirectory = `${temporary}/out`;
    const workDirectory = `${temporary}/work`;
    for (
      const path of [
        probeDirectory,
        probeWorkDirectory,
        inputDirectory,
        outputDirectory,
        workDirectory,
      ]
    ) {
      await Deno.mkdir(path, { mode: 0o777 });
      await Deno.chmod(path, 0o777);
    }
    const engine = await probeEngine(
      frozenImage,
      probeDirectory,
      probeWorkDirectory,
    );
    const qualificationKit = await createModelicaMicrosandboxQualificationKit(
      engine,
    );
    const bundle = await validateModelicaIsolatedInputBundle(
      qualificationKit.bundle.document,
    );
    const bundleBytes = Uint8Array.from(qualificationKit.bundle.bytes);
    const bundlePath = `${inputDirectory}/bundle.json`;
    await Deno.writeFile(bundlePath, bundleBytes, { mode: 0o444 });

    const execution = await docker([
      "run",
      "--rm",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      `--pids-limit=${CONTAINER_PID_LIMIT}`,
      "--memory=3g",
      "--cpus=2",
      "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=536870912",
      `--mount=type=bind,src=${bundlePath},dst=/input/bundle.json,readonly`,
      `--mount=type=bind,src=${outputDirectory},dst=/out`,
      `--mount=type=bind,src=${workDirectory},dst=/work`,
      frozenImage,
    ]);
    if (!execution.success) {
      throw new Error(
        `Modelica worker container preflight failed: ${
          decode(execution.stderr).slice(-2_000)
        }`,
      );
    }

    const names: string[] = [];
    for await (const entry of Deno.readDir(outputDirectory)) names.push(entry.name);
    names.sort(compareAscii);
    const expectedNames = MODELICA_ISOLATED_OUTPUT_MANIFEST.map((entry) =>
      entry.basename
    ).sort(compareAscii);
    if (deterministicJson(names) !== deterministicJson(expectedNames)) {
      throw new Error("The Modelica worker emitted an unexpected output set.");
    }
    const outputs = new Map<string, Uint8Array>();
    for (const declaration of MODELICA_ISOLATED_OUTPUT_MANIFEST) {
      const path = `${outputDirectory}/${declaration.basename}`;
      const info = await Deno.lstat(path);
      if (!info.isFile || info.isSymlink || info.nlink !== 1) {
        throw new Error(`${declaration.basename} is not one regular output file.`);
      }
      if (info.size < 1 || info.size > 16 * 1_048_576) {
        throw new Error(`${declaration.basename} exceeds its gate bound.`);
      }
      const bytes = await Deno.readFile(path);
      validateModelicaIsolatedOutput(declaration, bytes);
      outputs.set(declaration.role, bytes);
    }
    const evidenceBytes = outputs.get("evidence");
    const resultBytes = outputs.get("result");
    if (!evidenceBytes || !resultBytes || outputs.size !== 2) {
      throw new Error("The Modelica output role set is incomplete.");
    }
    const evidence = await validateModelicaIsolatedRun({
      bundle,
      evidenceBytes,
      resultBytes,
    });
    const finalTemperature = evidence.metrics.find((metric) =>
      metric.id === "temperature_final"
    );
    if (
      !finalTemperature || finalTemperature.unit !== "degC" ||
      Math.abs(finalTemperature.value - 22) > 1e-8
    ) {
      throw new Error("The real OMC conformance ramp did not reach 22 degC.");
    }
    await assertControlEvidence(workDirectory);

    const wrapperSha256 = await fingerprintResourceBytes(
      await Deno.readFile(WRAPPER),
    );
    const denoLockSha256 = await fingerprintResourceBytes(
      await Deno.readFile(DENO_LOCK),
    );
    const workerContractSha256 = await fingerprintResourceBytes(
      await Deno.readFile(WORKER_CONTRACT),
    );
    if (
      wrapperSha256 !== MODELICA_QUALIFIED_KIT_WRAPPER_SHA256 ||
      inspected.wrapperSha256 !== wrapperSha256 ||
      denoLockSha256 !== DENO_LOCK_SHA256 ||
      inspected.denoLockSha256 !== denoLockSha256 ||
      workerContractSha256 !== WORKER_CONTRACT_SHA256 ||
      inspected.workerContractSha256 !== workerContractSha256
    ) {
      throw new Error(
        "The worker image does not bind the reviewed wrapper and lock bytes.",
      );
    }

    console.log(deterministicJson({
      schemaVersion: "modelica-container-preflight/1.0",
      status: "passed-container-preflight-not-microvm-qualified",
      image,
      localImageId: inspected.localImageId,
      repoDigests: inspected.repoDigests,
      imageUser: inspected.user,
      imageEntrypoint: inspected.entrypoint,
      engine,
      wrapperSha256,
      workerContractSha256,
      denoLockSha256,
      bundleSha256: await fingerprintResourceBytes(bundleBytes),
      outputs: {
        evidence: {
          byteCount: evidenceBytes.byteLength,
          sha256: await fingerprintResourceBytes(evidenceBytes),
        },
        result: {
          byteCount: resultBytes.byteLength,
          sha256: await fingerprintResourceBytes(resultBytes),
        },
      },
      metrics: evidence.metrics,
      isolationObserved: {
        backend: "docker-container-preflight-only",
        network: "none",
        rootFilesystem: "read-only",
        linuxCapabilities: "none",
        privilegeEscalation: "disabled",
        processLimit: CONTAINER_PID_LIMIT,
      },
      remainingActivationGate:
        "same-image execution and CAS reread through Microsandbox 0.6.8 local MicroVM",
    }));
  } finally {
    await Deno.remove(temporary, { recursive: true }).catch(() => undefined);
  }
}

async function assertControlEvidence(workDirectory: string): Promise<void> {
  const expected = MODELICA_MICROSANDBOX_WORKER_CONTRACT.controlFiles;
  const controlDirectory = `${workDirectory}/.casys`;
  const names: string[] = [];
  for await (const entry of Deno.readDir(controlDirectory)) {
    if (!entry.isFile || entry.isSymlink) {
      throw new Error("The worker control evidence is not regular files.");
    }
    names.push(entry.name);
  }
  names.sort(compareAscii);
  if (
    deterministicJson(names) !==
      deterministicJson(["quiesced.json", "stderr.bin", "stdout.bin"])
  ) throw new Error("The worker control evidence set is not exact.");
  if (
    await Deno.readTextFile(`${controlDirectory}/quiesced.json`) !==
      expected.quiescenceText ||
    (await Deno.readFile(`${controlDirectory}/stdout.bin`)).byteLength !== 0 ||
    (await Deno.readFile(`${controlDirectory}/stderr.bin`)).byteLength !== 0
  ) throw new Error("The worker control evidence failed exact reread.");
}

interface InspectedWorkerImage {
  readonly localImageId: string;
  readonly repoDigests: readonly string[];
  readonly user: "65532:65532";
  readonly entrypoint: readonly string[];
  readonly wrapperSha256: string;
  readonly workerContractSha256: string;
  readonly denoLockSha256: string;
}

async function inspectWorkerImage(image: string): Promise<InspectedWorkerImage> {
  const output = await docker(["image", "inspect", image]);
  if (!output.success) throw new Error("The worker image identity is unavailable.");
  const parsed: unknown = JSON.parse(decode(output.stdout));
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("Docker returned an ambiguous worker image identity.");
  }
  const detail = record(parsed[0], "image inspection");
  const config = record(detail.Config, "image Config");
  const localImageId = string(detail.Id, "image Id");
  if (!/^sha256:[0-9a-f]{64}$/.test(localImageId)) {
    throw new Error("The worker local image ID is not immutable SHA-256.");
  }
  const repoDigests = detail.RepoDigests === null
    ? []
    : stringArray(detail.RepoDigests, "image RepoDigests");
  const requestedDigest = image.match(/@sha256:([0-9a-f]{64})$/)?.[1];
  if (
    requestedDigest &&
    !repoDigests.some((digest) => digest.endsWith(`@sha256:${requestedDigest}`))
  ) {
    throw new Error("Docker did not reopen the requested OCI repository digest.");
  }
  if (config.User !== "65532:65532") {
    throw new Error("The worker image is not configured for uid:gid 65532:65532.");
  }
  const entrypoint = stringArray(config.Entrypoint, "image Entrypoint");
  if (deterministicJson(entrypoint) !== deterministicJson(EXPECTED_ENTRYPOINT)) {
    throw new Error("The worker image entrypoint is not the reviewed direct wrapper.");
  }
  const labels = record(config.Labels, "image labels");
  exactLabel(labels, "io.casys.execution-profile", "modelica-qualified-kit-v1");
  exactLabel(labels, "io.casys.modelica.kit", "linear-thermal-ramp-v1@0.1.0");
  exactLabel(
    labels,
    "io.casys.modelica.admitted-profile",
    "modelica-closed-subset-v2@2.0.0",
  );
  exactLabel(labels, "io.casys.lowering", "modelica-omc-lowering@1.0.0");
  exactLabel(
    labels,
    "io.casys.result-normalizer",
    "linear-thermal-ramp-result-normalizer@1.0.0",
  );
  exactLabel(
    labels,
    "io.casys.modelica.admitted-result-normalizer",
    "modelica-closed-subset-v2-result-normalizer@2.0.0",
  );
  const wrapperSha256 = digestLabel(labels, "io.casys.wrapper.sha256");
  const workerContractSha256 = digestLabel(
    labels,
    "io.casys.worker-contract.sha256",
  );
  const denoLockSha256 = digestLabel(labels, "io.casys.deno-lock.sha256");
  return Object.freeze({
    localImageId,
    repoDigests: Object.freeze(repoDigests),
    user: "65532:65532",
    entrypoint: Object.freeze(entrypoint),
    wrapperSha256,
    workerContractSha256,
    denoLockSha256,
  });
}

async function probeEngine(
  image: string,
  probeDirectory: string,
  probeWorkDirectory: string,
): Promise<{ name: "OpenModelica"; version: string; mslVersion: string }> {
  const versionOutput = await docker([
    "run",
    "--rm",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--entrypoint=/usr/bin/omc",
    image,
    "--version",
  ]);
  if (!versionOutput.success) throw new Error("The image OMC version probe failed.");
  const versionLine = decode(versionOutput.stdout).trim();
  const version = versionLine.match(/^OpenModelica\s+(.+)$/)?.[1];
  if (!version) throw new Error("The image OMC version line is unsupported.");

  const probePath = `${probeDirectory}/probe.mos`;
  await Deno.writeTextFile(
    probePath,
    "loadModel(Modelica);\ngetVersion(Modelica);\n",
    { mode: 0o444 },
  );
  const libraryOutput = await docker([
    "run",
    "--rm",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=67108864",
    `--mount=type=bind,src=${probePath},dst=/input/probe.mos,readonly`,
    `--mount=type=bind,src=${probeWorkDirectory},dst=/work`,
    "--workdir=/work",
    "--entrypoint=/usr/bin/omc",
    image,
    "/input/probe.mos",
  ]);
  if (!libraryOutput.success) throw new Error("The image MSL version probe failed.");
  const quoted = decode(libraryOutput.stdout).trim().split(/\r?\n/)
    .findLast((line) => /^"[^"]+"$/.test(line));
  if (!quoted) throw new Error("The image MSL version probe returned no version.");
  const mslVersion = JSON.parse(quoted);
  if (typeof mslVersion !== "string" || mslVersion.length === 0) {
    throw new Error("The image MSL version is invalid.");
  }
  return Object.freeze({ name: "OpenModelica", version, mslVersion });
}

interface Options {
  readonly runContainerPreflight: boolean;
  readonly image: string;
}

function parseArgs(args: readonly string[]): Options {
  let runContainerPreflight = false;
  let image = DEFAULT_IMAGE;
  for (const argument of args) {
    if (argument === "--run-container-preflight") runContainerPreflight = true;
    else if (argument.startsWith("--image=")) image = argument.slice(8);
    else throw new TypeError(`Unsupported argument ${argument}.`);
  }
  if (!image || image !== image.trim() || image.includes("\0")) {
    throw new TypeError("image must be a canonical non-empty reference.");
  }
  return Object.freeze({ runContainerPreflight, image });
}

function docker(args: readonly string[]): Promise<Deno.CommandOutput> {
  return new Deno.Command("docker", {
    args: [...args],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return [...value] as string[];
}

function exactLabel(
  labels: Record<string, unknown>,
  name: string,
  expected: string,
): void {
  if (labels[name] !== expected) {
    throw new Error(`The worker image label ${name} is not ${expected}.`);
  }
}

function digestLabel(labels: Record<string, unknown>, name: string): string {
  const value = labels[name];
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`The worker image label ${name} is not a SHA-256 digest.`);
  }
  return value;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
