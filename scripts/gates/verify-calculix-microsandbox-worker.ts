/**
 * Explicit native prequalification smoke for the CalculiX worker image.
 *
 * Default mode is read-only planning. `--run` builds one exact reviewed bundle,
 * executes the already-built image with network/capabilities removed, and
 * validates the complete nine-file output profile outside the container.
 */

import {
  CALCULIX_ISOLATED_OUTPUT_MANIFEST,
  createCalculixIsolatedInputBundle,
  validateCalculixIsolatedOutput,
  validateCalculixIsolatedOutputBatch,
  validateCalculixIsolatedRequestDocument,
  validateCalculixIsolatedStaticResult,
} from "../../src/domain/fea/isolated-v3/calculix-isolated-execution.ts";
import { CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR } from "../../src/adapters/fea/isolated-v3/calculix-isolated-output-batch-inspector.ts";
import { validateMechanicalProofCase } from "../../src/domain/fea/seal-case/mechanical-proof-case.ts";
import { fingerprintResourceBytes } from "../../src/domain/compile/source/provider-resource-reader.ts";
import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";
import { CALCULIX_MICROSANDBOX_WORKER_CONTRACT } from "../../src/adapters/fea/isolated-v3/calculix-static-proof-v1/worker-contract.ts";

const DEFAULT_IMAGE = "casys/calculix-microsandbox-worker:gate";
const DEFAULT_PROOF =
  "src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl04-arm-cantilever.json";
const DEFAULT_STEP =
  "state/local/thread-assets/c2f04aa6660caad85bc1a179d64ab2f68cd966781a2646a5c8e8be308fbe187f.step";
const WRAPPER = "src/adapters/fea/isolated-v3/calculix-static-proof-v1/run.ts";
const WORKER_CONTRACT =
  "src/adapters/fea/isolated-v3/calculix-static-proof-v1/worker-contract.ts";
const DENO_LOCK = "images/calculix-microsandbox-worker/deno.lock";
const MAXIMUM_OUTPUT_FILE_BYTES = 128 * 1_048_576;
const MAXIMUM_OUTPUT_TOTAL_BYTES = 256 * 1_048_576;

const options = parseArgs(Deno.args);
if (!options.run) {
  console.log(deterministicJson({
    schemaVersion: "calculix-worker-prequalification-plan/1.0",
    status: "not-run",
    image: options.image,
    proof: options.proof,
    step: options.step,
    checks: [
      "docker-network-none",
      "read-only-rootfs",
      "capabilities-dropped",
      "exact-reviewed-bundle",
      "gmsh-and-ccx-success",
      "exact-quiescence-and-log-control-files",
      "nine-regular-bounded-outputs",
      "external-format-and-proof-binding-validation",
    ],
  }));
  Deno.exit(0);
}

await runGate(options);

async function runGate(options: Options): Promise<void> {
  const proof = validateMechanicalProofCase(
    JSON.parse(await Deno.readTextFile(options.proof)),
  );
  const stepBytes = await Deno.readFile(options.step);
  if (
    stepBytes.byteLength !== proof.expectedCadArtifact.bytes ||
    await fingerprintResourceBytes(stepBytes) !== proof.expectedCadArtifact.sha256
  ) throw new Error("The gate STEP does not match the reviewed proof case.");
  const bundle = await createCalculixIsolatedInputBundle({
    requestId: "qualification:calculix-static-proof-v1",
    proof,
    stepBytes,
    elementOrder: 2,
    timeoutMs: 120_000,
  });
  const temporary = await Deno.makeTempDir({ prefix: "casys-calculix-gate-" });
  try {
    const inputDirectory = `${temporary}/input`;
    const outputDirectory = `${temporary}/out`;
    const workDirectory = `${temporary}/work`;
    await Deno.mkdir(inputDirectory, { mode: 0o700 });
    for (const directory of [outputDirectory, workDirectory]) {
      await Deno.mkdir(directory, { mode: 0o777 });
      await Deno.chmod(directory, 0o777);
    }
    const bundlePath = `${inputDirectory}/calculix-static.bundle`;
    await Deno.writeFile(bundlePath, bundle.bytes.copy(), { mode: 0o444 });

    const output = await new Deno.Command("docker", {
      args: [
        "run",
        "--rm",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=64",
        "--memory=3g",
        "--cpus=2",
        "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=536870912",
        `--mount=type=bind,src=${bundlePath},dst=/input/calculix-static.bundle,readonly`,
        `--mount=type=bind,src=${outputDirectory},dst=/out`,
        `--mount=type=bind,src=${workDirectory},dst=/work`,
        options.image,
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!output.success) {
      throw new Error(
        `CalculiX worker failed: ${decode(output.stderr).slice(-2_000)}`,
      );
    }
    const names: string[] = [];
    for await (const entry of Deno.readDir(outputDirectory)) names.push(entry.name);
    names.sort(compareAscii);
    const expected = CALCULIX_ISOLATED_OUTPUT_MANIFEST
      .map((entry) => entry.basename).sort(compareAscii);
    if (deterministicJson(names) !== deterministicJson(expected)) {
      throw new Error("CalculiX worker did not emit the exact nine-file profile.");
    }
    const sizes: Record<string, number> = {};
    const outputBytes = new Map<string, Uint8Array>();
    let totalOutputBytes = 0;
    for (const declaration of CALCULIX_ISOLATED_OUTPUT_MANIFEST) {
      const path = `${outputDirectory}/${declaration.basename}`;
      const info = await Deno.lstat(path);
      if (!info.isFile || info.isSymlink || info.nlink !== 1) {
        throw new Error(`${declaration.basename} is not one regular output file.`);
      }
      if (info.size < 0 || info.size > MAXIMUM_OUTPUT_FILE_BYTES) {
        throw new Error(`${declaration.basename} exceeds the gate bound.`);
      }
      const bytes = await Deno.readFile(path);
      totalOutputBytes += bytes.byteLength;
      if (totalOutputBytes > MAXIMUM_OUTPUT_TOTAL_BYTES) {
        throw new Error("The CalculiX output batch exceeds the gate bound.");
      }
      validateCalculixIsolatedOutput(declaration, bytes);
      outputBytes.set(declaration.role, bytes);
      sizes[declaration.basename] = bytes.byteLength;
    }
    const observedStep = await Deno.readFile(`${outputDirectory}/input.step`);
    if (await fingerprintResourceBytes(observedStep) !== bundle.manifest.step.sha256) {
      throw new Error("The worker output STEP differs from the reviewed input.");
    }
    const requestText = await Deno.readTextFile(`${outputDirectory}/request.json`);
    const request = validateCalculixIsolatedRequestDocument(JSON.parse(requestText));
    if (
      requestText !== deterministicJson(request) ||
      request.requestId !== bundle.manifest.requestId ||
      request.proofFingerprint.digest !== bundle.manifest.proofFingerprint.digest ||
      deterministicJson(request.effective) !==
        deterministicJson(bundle.manifest.effective) ||
      deterministicJson(request.step) !== deterministicJson(bundle.manifest.step)
    ) throw new Error("The worker request evidence differs from its exact bundle.");
    const resultText = await Deno.readTextFile(`${outputDirectory}/result.json`);
    const result = validateCalculixIsolatedStaticResult(
      JSON.parse(resultText),
      bundle.manifest,
    );
    if (resultText !== deterministicJson(result)) {
      throw new Error("The worker result evidence is not canonical.");
    }
    validateCalculixIsolatedOutputBatch(
      bundle.manifest,
      outputBytes,
      result,
      CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR,
    );
    await assertControlEvidence(workDirectory);
    const wrapperSha256 = await fingerprintResourceBytes(
      await Deno.readFile(WRAPPER),
    );
    const workerContractSha256 = await fingerprintResourceBytes(
      await Deno.readFile(WORKER_CONTRACT),
    );
    const denoLockSha256 = await fingerprintResourceBytes(
      await Deno.readFile(DENO_LOCK),
    );
    const inspected = await inspectWorkerImage(options.image);
    if (
      inspected.wrapperSha256 !== wrapperSha256 ||
      inspected.workerContractSha256 !== workerContractSha256 ||
      inspected.denoLockSha256 !== denoLockSha256
    ) {
      throw new Error(
        "The worker image does not attest its reviewed wrapper, contract and lock.",
      );
    }
    console.log(deterministicJson({
      schemaVersion: "calculix-worker-prequalification/1.0",
      status: "passed",
      image: options.image,
      localImageId: inspected.localImageId,
      repoDigests: inspected.repoDigests,
      wrapperSha256,
      workerContractSha256,
      denoLockSha256,
      bundleSha256: bundle.fingerprint.digest,
      stepSha256: bundle.manifest.step.sha256,
      outputs: sizes,
      metrics: result.metrics,
      executionIdentity: result.executionIdentity,
      isolation: {
        network: "none",
        rootFilesystem: "read-only",
        linuxCapabilities: "none",
        privilegeEscalation: "disabled",
      },
    }));
  } finally {
    await Deno.remove(temporary, { recursive: true }).catch(() => undefined);
  }
}

async function assertControlEvidence(workDirectory: string): Promise<void> {
  const control = CALCULIX_MICROSANDBOX_WORKER_CONTRACT.controlFiles;
  const controlDirectory = `${workDirectory}/.casys`;
  const names: string[] = [];
  for await (const entry of Deno.readDir(controlDirectory)) {
    if (!entry.isFile || entry.isSymlink) {
      throw new Error("The CalculiX control evidence is not regular files.");
    }
    names.push(entry.name);
  }
  names.sort(compareAscii);
  if (
    deterministicJson(names) !==
      deterministicJson(["quiesced.json", "stderr.bin", "stdout.bin"]) ||
    await Deno.readTextFile(`${controlDirectory}/quiesced.json`) !==
      control.quiescenceText ||
    (await Deno.readFile(`${controlDirectory}/stdout.bin`)).byteLength !== 0 ||
    (await Deno.readFile(`${controlDirectory}/stderr.bin`)).byteLength !== 0
  ) throw new Error("The CalculiX control evidence failed exact reread.");
}

interface InspectedWorkerImage {
  readonly localImageId: string;
  readonly repoDigests: readonly string[];
  readonly wrapperSha256: string;
  readonly workerContractSha256: string;
  readonly denoLockSha256: string;
}

async function inspectWorkerImage(image: string): Promise<InspectedWorkerImage> {
  const output = await new Deno.Command("docker", {
    args: ["image", "inspect", image],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) throw new Error("The worker image identity is unavailable.");
  const parsed: unknown = JSON.parse(decode(output.stdout));
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("Docker returned an ambiguous worker image identity.");
  }
  const detail = record(parsed[0], "image inspection");
  const config = record(detail.Config, "image Config");
  const labels = record(config.Labels, "image labels");
  const localImageId = text(detail.Id, "image Id");
  if (!/^sha256:[0-9a-f]{64}$/.test(localImageId)) {
    throw new Error("The worker local image ID is not immutable SHA-256.");
  }
  const repoDigests = detail.RepoDigests === null
    ? []
    : stringArray(detail.RepoDigests, "image RepoDigests");
  const requestedDigest = image.match(/@sha256:([0-9a-f]{64})$/)?.[1];
  if (
    requestedDigest &&
    !repoDigests.some((value) => value.endsWith(`@sha256:${requestedDigest}`))
  ) throw new Error("Docker did not reopen the requested OCI repository digest.");
  const worker = CALCULIX_MICROSANDBOX_WORKER_CONTRACT;
  if (
    config.User !== worker.expectedImageUser ||
    deterministicJson(config.Entrypoint) !==
      deterministicJson([worker.executable, ...worker.args]) ||
    labels["io.casys.execution-profile"] !== "calculix-static-proof-v1" ||
    labels["io.casys.calculix.library"] !== "@casys/mcp-calculix@0.7.0" ||
    labels["io.casys.lowering"] !== "calculix.static.abaqus-deck@1.0"
  ) throw new Error("The worker image configuration is not the reviewed contract.");
  return Object.freeze({
    localImageId,
    repoDigests: Object.freeze(repoDigests),
    wrapperSha256: digestLabel(labels, "io.casys.wrapper.sha256"),
    workerContractSha256: digestLabel(
      labels,
      "io.casys.worker-contract.sha256",
    ),
    denoLockSha256: digestLabel(labels, "io.casys.deno-lock.sha256"),
  });
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${path} must be a string array.`);
  }
  return [...value] as string[];
}

function digestLabel(labels: Record<string, unknown>, name: string): string {
  const value = text(labels[name], name);
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${name} is not SHA-256.`);
  return value;
}

interface Options {
  readonly run: boolean;
  readonly image: string;
  readonly proof: string;
  readonly step: string;
}

function parseArgs(args: string[]): Options {
  let run = false;
  let image = DEFAULT_IMAGE;
  let proof = DEFAULT_PROOF;
  let step = DEFAULT_STEP;
  for (const argument of args) {
    if (argument === "--run") run = true;
    else if (argument.startsWith("--image=")) image = argument.slice(8);
    else if (argument.startsWith("--proof=")) proof = argument.slice(8);
    else if (argument.startsWith("--step=")) step = argument.slice(7);
    else throw new TypeError(`Unsupported argument ${argument}.`);
  }
  for (const [label, value] of Object.entries({ image, proof, step })) {
    if (!value || value !== value.trim() || value.includes("\0")) {
      throw new TypeError(`${label} must be non-empty and bounded.`);
    }
  }
  return Object.freeze({ run, image, proof, step });
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
