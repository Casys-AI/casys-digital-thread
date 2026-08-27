/**
 * Opt-in, destructive-to-temporary-state qualification of the local worker.
 *
 * Run from the repository root:
 * deno run --allow-read --allow-write=/tmp --allow-run=docker,npx \
 *   scripts/gates/verify-build123d-microsandbox-worker.ts --run [--keep-image]
 */

const MICROSANDBOX_VERSION = "0.6.8";
const IMAGE_TAG_PREFIX = "casys/build123d-microsandbox-worker:gate";
const GATE_LABEL_KEY = "io.casys.gate";
const QUIESCENCE_PATH = "/run/casys/quiesced.json";
const STDOUT_CAPTURE_PATH = "/run/casys/stdout.bin";
const STDERR_CAPTURE_PATH = "/run/casys/stderr.bin";
const QUIESCENCE_CONTENT =
  '{"schemaVersion":"casys-build123d-worker-quiescence/1.0","status":"descendants-killed-and-reaped"}\n';
const STEP_DECLARATION = Object.freeze({
  role: "geometry",
  basename: "geometry.step",
  mediaType: "model/step",
  format: "step-ap214",
});

const keepImage = Deno.args.includes("--keep-image");
const acceptedArguments = new Set(["--run", "--keep-image"]);
if (
  !Deno.args.includes("--run") ||
  Deno.args.some((argument) => !acceptedArguments.has(argument)) ||
  new Set(Deno.args).size !== Deno.args.length ||
  Deno.args.length !== (keepImage ? 2 : 1)
) {
  console.log(JSON.stringify({
    schemaVersion: "build123d-microsandbox-worker-gate/1.0",
    status: "skipped",
    reason:
      "Pass --run to qualify the local arm64 worker; add --keep-image to provision it for a vertical smoke.",
  }));
  Deno.exit(0);
}

if (Deno.build.arch !== "aarch64") {
  throw new Error(
    "The local Microsandbox qualification gate requires an arm64 host.",
  );
}

const repositoryRootUrl = new URL("../../", import.meta.url);
const imageContextUrl = new URL(
  "images/build123d-microsandbox-worker/",
  repositoryRootUrl,
);
const temporaryDirectory = await Deno.makeTempDir({
  dir: "/tmp",
  prefix: "casys-build123d-microsandbox-gate-",
});
const runIdentity = crypto.randomUUID().replaceAll("-", "");
const sandboxName = `casys-build123d-gate-${runIdentity.slice(0, 20)}`;
const gateLabel = `${GATE_LABEL_KEY}=${runIdentity}`;
let imageTag = `${IMAGE_TAG_PREFIX}-${runIdentity.slice(0, 12)}`;
const temporaryCacheReference = `gate-${runIdentity.slice(0, 12)}`;
const ociArchivePath = `${temporaryDirectory}/worker-arm64.oci.tar`;
const metadataPath = `${temporaryDirectory}/build-metadata.json`;
const sourcePath = `${temporaryDirectory}/source.py`;
const outputPath = `${temporaryDirectory}/geometry.step`;
const quiescencePath = `${temporaryDirectory}/quiesced.json`;
const stdoutCapturePath = `${temporaryDirectory}/stdout.bin`;
const stderrCapturePath = `${temporaryDirectory}/stderr.bin`;

let sandboxCreated = false;
const loadedImageReferences = new Set<string>();
let initialCacheReference = "";
let imageDigest = "";
let exactImageReference = "";
let durableImageAlias = "";
let stepDigest = "";
let stepByteCount = 0;
let gateError: unknown;
let cleanupError: unknown;

try {
  await Deno.writeTextFile(
    sourcePath,
    "from build123d import Box\n" +
      "import os, signal, subprocess, sys\n" +
      "try:\n" +
      "    os.kill(os.getppid(), signal.SIGKILL)\n" +
      "except PermissionError:\n" +
      "    pass\n" +
      "else:\n" +
      "    raise RuntimeError('untrusted child killed its supervisor')\n" +
      "try:\n" +
      "    open('/run/casys/forged', 'wb').write(b'forged')\n" +
      "except PermissionError:\n" +
      "    pass\n" +
      "else:\n" +
      "    raise RuntimeError('untrusted child wrote supervisor control state')\n" +
      "print('qualified-build123d-source', flush=True)\n" +
      "subprocess.Popen([sys.executable, '-I', '-B', '-c', " +
      "\"import time; time.sleep(0.75); open('/out/geometry.step', 'wb').write(b'corrupt')\"" +
      "], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, " +
      "stderr=subprocess.DEVNULL, close_fds=True, start_new_session=True)\n" +
      "result = Box(10, 20, 30)\n",
    { createNew: true, mode: 0o400 },
  );

  await runCommand("docker", [
    "buildx",
    "build",
    "--platform",
    "linux/arm64",
    "--provenance=false",
    "--sbom=false",
    "--tag",
    imageTag,
    "--output",
    `type=oci,dest=${ociArchivePath}`,
    "--metadata-file",
    metadataPath,
    filePath(imageContextUrl),
  ]);

  const metadata = JSON.parse(await Deno.readTextFile(metadataPath));
  imageDigest = requireSha256Digest(
    metadata["containerimage.digest"],
    "Docker Buildx metadata",
  );

  await runMicrosandbox([
    "load",
    "--quiet",
    "--input",
    ociArchivePath,
    "--tag",
    imageTag,
  ]);
  const initiallyCachedImage = JSON.parse(
    (await runMicrosandbox([
      "image",
      "inspect",
      "--format",
      "json",
      imageTag,
    ])).stdout,
  );
  const initiallyCachedDigest = requireSha256Digest(
    initiallyCachedImage?.digest,
    "Microsandbox image inspection",
  );
  if (initiallyCachedDigest !== imageDigest) {
    throw new Error(
      "Docker and Microsandbox resolved different arm64 image manifests.",
    );
  }
  initialCacheReference = initiallyCachedImage?.reference;
  if (
    initialCacheReference !== imageTag &&
    initialCacheReference !== temporaryCacheReference
  ) {
    throw new Error(
      "Microsandbox exposed an unexpected temporary cache identity.",
    );
  }
  loadedImageReferences.add(initialCacheReference);

  // Production requests are digest-pinned. Microsandbox local cache keys are
  // exact references, so re-load the already verified archive under the exact
  // repo@digest identity and use that key with pull=never.
  const temporaryReferences = new Set([initialCacheReference]);
  for (const temporaryReference of temporaryReferences) {
    await runMicrosandbox([
      "image",
      "remove",
      "--force",
      "--quiet",
      temporaryReference,
    ]);
    loadedImageReferences.delete(temporaryReference);
  }
  exactImageReference = `casys/build123d-microsandbox-worker@${imageDigest}`;
  await runMicrosandbox([
    "load",
    "--quiet",
    "--input",
    ociArchivePath,
    "--tag",
    exactImageReference,
  ]);
  imageTag = exactImageReference;
  loadedImageReferences.add(exactImageReference);
  const exactlyCachedImage = JSON.parse(
    (await runMicrosandbox([
      "image",
      "inspect",
      "--format",
      "json",
      imageTag,
    ])).stdout,
  );
  if (
    requireSha256Digest(
        exactlyCachedImage?.digest,
        "Exact Microsandbox image inspection",
      ) !== imageDigest ||
    exactlyCachedImage?.architecture !== "arm64" ||
    exactlyCachedImage?.os !== "linux"
  ) {
    throw new Error(
      "The exact Microsandbox cache identity did not attest the expected manifest and platform.",
    );
  }

  await runMicrosandbox([
    "create",
    "--quiet",
    "--name",
    sandboxName,
    "--cpus",
    "1",
    "--max-cpus",
    "1",
    "--memory",
    "1G",
    "--max-memory",
    "1G",
    "--root-disk",
    "tmpfs:1G",
    "--max-duration",
    "2m",
    "--idle-timeout",
    "90s",
    "--no-net",
    "--security",
    "restricted",
    "--pull",
    "never",
    "--user",
    "0:0",
    "--label",
    gateLabel,
    imageTag,
  ]);
  sandboxCreated = true;

  const inspection = JSON.parse(
    (await runMicrosandbox([
      "inspect",
      "--format",
      "json",
      sandboxName,
    ])).stdout,
  );
  assertRestrictedLocalConfiguration(
    inspection,
    exactImageReference,
    imageDigest,
  );

  await runMicrosandbox([
    "copy",
    "--quiet",
    sourcePath,
    `${sandboxName}:/input/source.py`,
  ]);

  const execution = await runMicrosandbox([
    "exec",
    "--quiet",
    "--no-tty",
    "--timeout",
    "35s",
    "--user",
    "0:0",
    "--rlimit",
    "cpu=20",
    "--rlimit",
    "nproc=32",
    "--rlimit",
    "nofile=128",
    "--rlimit",
    "fsize=33554432",
    sandboxName,
    "--",
    "/usr/local/bin/python3",
    "-I",
    "-B",
    "/opt/casys/bin/run-build123d.py",
  ]);
  const workerStatus = parseBoundedWorkerStatus(execution.stdout);

  await runMicrosandbox([
    "copy",
    "--quiet",
    `${sandboxName}:${QUIESCENCE_PATH}`,
    quiescencePath,
  ]);
  if (await Deno.readTextFile(quiescencePath) !== QUIESCENCE_CONTENT) {
    throw new Error("The worker did not publish the exact quiescence marker.");
  }
  await runMicrosandbox([
    "copy",
    "--quiet",
    `${sandboxName}:${STDOUT_CAPTURE_PATH}`,
    stdoutCapturePath,
  ]);
  await runMicrosandbox([
    "copy",
    "--quiet",
    `${sandboxName}:${STDERR_CAPTURE_PATH}`,
    stderrCapturePath,
  ]);
  const capturedStdout = await Deno.readFile(stdoutCapturePath);
  const capturedStderr = await Deno.readFile(stderrCapturePath);
  await assertCaptureReceipt(capturedStdout, workerStatus.logs.stdout);
  await assertCaptureReceipt(capturedStderr, workerStatus.logs.stderr);

  // The source spawned a setsid descendant that would corrupt the STEP after
  // 750 ms. Waiting beyond that delay proves subreaper kill/reap happened
  // before the quiescence marker and no late mutation remained possible.
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  await runMicrosandbox([
    "copy",
    "--quiet",
    `${sandboxName}:/out/geometry.step`,
    outputPath,
  ]);

  const stepBytes = await Deno.readFile(outputPath);
  const { OcctStepOutputValidator } = await import(
    "../../src/adapters/cad/isolated/occt-step-output-validator.ts"
  );
  await new OcctStepOutputValidator().validateOutput(
    STEP_DECLARATION,
    stepBytes,
  );
  stepDigest = await sha256Hex(stepBytes);
  stepByteCount = stepBytes.byteLength;

  if (keepImage) {
    durableImageAlias = `casys/build123d-microsandbox-worker:qualified-arm64-${
      imageDigest.slice("sha256:".length, "sha256:".length + 12)
    }`;
    await runMicrosandbox([
      "load",
      "--quiet",
      "--input",
      ociArchivePath,
      "--tag",
      durableImageAlias,
    ]);
    loadedImageReferences.add(durableImageAlias);
    const durableCachedImage = JSON.parse(
      (await runMicrosandbox([
        "image",
        "inspect",
        "--format",
        "json",
        durableImageAlias,
      ])).stdout,
    );
    if (
      requireSha256Digest(
          durableCachedImage?.digest,
          "Durable Microsandbox image inspection",
        ) !== imageDigest ||
      durableCachedImage?.architecture !== "arm64" ||
      durableCachedImage?.os !== "linux"
    ) {
      throw new Error(
        "The durable local alias did not attest the expected manifest and platform.",
      );
    }
  }
} catch (error) {
  gateError = error;
} finally {
  if (sandboxCreated) {
    const removal = await tryRunMicrosandbox([
      "remove",
      "--force",
      "--quiet",
      sandboxName,
    ]);
    if (!removal.success) cleanupError = removal.error;
  }

  const remaining = await tryRunMicrosandbox([
    "list",
    "--quiet",
    "--label",
    gateLabel,
  ]);
  if (!remaining.success) {
    cleanupError ??= remaining.error;
  } else if (remaining.stdout.trim() !== "") {
    cleanupError ??= new Error(
      "The Microsandbox qualification gate left a sandbox behind.",
    );
  }

  const preserveImage = gateError === undefined &&
    cleanupError === undefined && keepImage;
  if (!preserveImage) {
    for (const imageReference of loadedImageReferences) {
      const imageRemoval = await tryRunMicrosandbox([
        "image",
        "remove",
        "--force",
        "--quiet",
        imageReference,
      ]);
      if (!imageRemoval.success) cleanupError ??= imageRemoval.error;
    }
  }

  if (imageDigest !== "") {
    const listedImages = await tryRunMicrosandbox([
      "image",
      "list",
      "--format",
      "json",
    ]);
    if (!listedImages.success) {
      cleanupError ??= listedImages.error;
    } else {
      const images = JSON.parse(listedImages.stdout);
      if (Array.isArray(images)) {
        for (const image of images) {
          if (
            typeof image?.reference !== "string" ||
            !image.reference.startsWith("gate-") ||
            image?.digest !== imageDigest
          ) continue;
          const imageRemoval = await tryRunMicrosandbox([
            "image",
            "remove",
            "--force",
            "--quiet",
            image.reference,
          ]);
          if (!imageRemoval.success) cleanupError ??= imageRemoval.error;
        }
      }
    }
  }

  try {
    await Deno.remove(temporaryDirectory, { recursive: true });
  } catch (error) {
    cleanupError ??= error;
  }
}

if (cleanupError !== undefined) throw cleanupError;
if (gateError !== undefined) throw gateError;

console.log(JSON.stringify({
  schemaVersion: "build123d-microsandbox-worker-gate/1.0",
  status: "passed",
  platform: "linux/arm64",
  microsandboxVersion: MICROSANDBOX_VERSION,
  imageDigest,
  imageReference: exactImageReference,
  localAlias: keepImage ? durableImageAlias : null,
  step: {
    byteCount: stepByteCount,
    sha256: stepDigest,
    validator: "occt-step-ap214@1.0.0",
  },
  cleanup: keepImage
    ? "no-sandbox-and-qualified-image-provisioned"
    : "no-sandbox-and-local-tag-removed",
}));

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

async function runMicrosandbox(args: readonly string[]): Promise<CommandResult> {
  return await runCommand("npx", [
    "-y",
    `microsandbox@${MICROSANDBOX_VERSION}`,
    ...args,
  ]);
}

async function tryRunMicrosandbox(
  args: readonly string[],
): Promise<
  | { readonly success: true; readonly stdout: string }
  | { readonly success: false; readonly error: unknown }
> {
  try {
    const result = await runMicrosandbox(args);
    return { success: true, stdout: result.stdout };
  } catch (error) {
    return { success: false, error };
  }
}

async function runCommand(
  executable: string,
  args: readonly string[],
): Promise<CommandResult> {
  const output = await new Deno.Command(executable, {
    args: [...args],
    cwd: filePath(repositoryRootUrl),
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  if (!output.success) {
    const diagnostic = bounded(stderr || stdout);
    throw new Error(
      `${executable} failed with exit code ${output.code}: ${diagnostic}`,
    );
  }
  return { stdout, stderr };
}

function assertRestrictedLocalConfiguration(
  value: unknown,
  expectedImageReference: string,
  expectedImageDigest: string,
): void {
  const inspected = asRecord(value, "inspection");
  const config = asRecord(inspected.active_config, "active_config");
  const image = asRecord(config.image, "active_config.image");
  const oci = asRecord(image.Oci, "active_config.image.Oci");
  const rootDisk = asRecord(
    oci.root_disk,
    "active_config.image.Oci.root_disk",
  );
  const network = asRecord(config.network, "active_config.network");
  const networkPolicy = asRecord(
    network.policy,
    "active_config.network.policy",
  );
  const secrets = asRecord(network.secrets, "active_config.network.secrets");
  const tls = asRecord(network.tls, "active_config.network.tls");
  const dns = asRecord(network.dns, "active_config.network.dns");
  const resources = asRecord(config.resources, "active_config.resources");
  const runtime = asRecord(config.runtime, "active_config.runtime");
  const lifecycle = asRecord(config.lifecycle, "active_config.lifecycle");
  const labels = asRecord(config.labels, "active_config.labels");
  const mounts = asArray(config.mounts, "active_config.mounts");
  const defaultTmp = mounts.length === 1
    ? asRecord(mounts[0], "active_config.mounts[0]")
    : undefined;

  const valid = oci.reference === expectedImageReference &&
    config.manifest_digest === expectedImageDigest &&
    rootDisk.kind === "tmpfs" &&
    rootDisk.size_mib === 1_024 &&
    config.pull_policy === "Never" &&
    config.security_profile === "restricted" &&
    config.init === null &&
    network.enabled === true &&
    Object.keys(asRecord(network.interface, "active_config.network.interface"))
        .length === 0 &&
    networkPolicy.default_egress === "deny" &&
    networkPolicy.default_ingress === "deny" &&
    isEmptyArray(networkPolicy.rules) &&
    isEmptyArray(network.ports) &&
    isEmptyArray(secrets.secrets) &&
    secrets.on_violation === "block-and-log" &&
    tls.enabled === false &&
    network.trust_host_cas === false &&
    isEmptyArray(dns.nameservers) &&
    resources.cpus === 1 &&
    resources.max_cpus === 1 &&
    resources.memory_mib === 1_024 &&
    resources.max_memory_mib === 1_024 &&
    lifecycle.ephemeral === false &&
    lifecycle.max_duration_secs === 120 &&
    lifecycle.idle_timeout_secs === 90 &&
    labels[GATE_LABEL_KEY] === runIdentity &&
    labels["io.casys.execution-profile"] === "build123d-closed-subset-v1" &&
    labels["io.casys.python.version"] === "3.12.11" &&
    labels["io.casys.build123d.version"] === "0.11.1" &&
    labels["io.casys.cadquery-ocp-novtk.version"] === "7.9.3.1.1" &&
    labels["io.casys.debian.libgl1.version"] === "1.6.0-1" &&
    runtime.user === "0:0" &&
    runtime.workdir === "/work" &&
    JSON.stringify(runtime.entrypoint) === JSON.stringify([
        "/usr/local/bin/python3",
        "-I",
        "-B",
        "/opt/casys/bin/run-build123d.py",
      ]) &&
    runtime.cmd === null &&
    runtime.shell === null &&
    Object.keys(asRecord(runtime.scripts, "active_config.runtime.scripts"))
        .length === 0 &&
    isEmptyArray(config.patches) &&
    defaultTmp?.guest === "/tmp" &&
    defaultTmp.type === "Tmpfs" &&
    defaultTmp.size_mib === 256;
  if (!valid) {
    throw new Error(
      "Microsandbox inspection did not attest the exact local restricted execution profile.",
    );
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

interface WorkerCaptureReceipt {
  readonly byteCount: number;
  readonly sha256: string;
  readonly truncated: boolean;
}

interface WorkerStatus {
  readonly logs: {
    readonly stdout: WorkerCaptureReceipt;
    readonly stderr: WorkerCaptureReceipt;
  };
}

function parseBoundedWorkerStatus(stdout: string): WorkerStatus {
  if (new TextEncoder().encode(stdout).byteLength > 4_096) {
    throw new Error("The worker emitted an unbounded host-visible status.");
  }
  const lines = stdout.trim().split("\n");
  if (lines.length !== 1) {
    throw new Error("The worker must emit exactly one structured status line.");
  }
  const status = JSON.parse(lines[0]);
  if (
    status?.schemaVersion !== "casys-build123d-worker-status/1.0" ||
    status?.status !== "ok" ||
    status?.childExitCode !== 0 ||
    typeof status?.logs?.stdout?.byteCount !== "number" ||
    status.logs.stdout.byteCount > 65_536 ||
    typeof status?.logs?.stderr?.byteCount !== "number" ||
    status.logs.stderr.byteCount > 65_536 ||
    status?.logs?.stdout?.truncated !== false ||
    status?.logs?.stderr?.truncated !== false
  ) {
    throw new Error(
      `The worker returned a non-canonical execution status: ${bounded(stdout)}`,
    );
  }
  return status as WorkerStatus;
}

async function assertCaptureReceipt(
  bytes: Uint8Array,
  receipt: WorkerCaptureReceipt,
): Promise<void> {
  if (
    bytes.byteLength !== receipt.byteCount ||
    await sha256Hex(bytes) !== receipt.sha256
  ) {
    throw new Error("A bounded worker log did not match its capture receipt.");
  }
}

function requireSha256Digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} did not expose one immutable OCI digest.`);
  }
  return value;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", copy.buffer),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bounded(value: string): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  return normalized.slice(-4_096);
}

function filePath(url: URL): string {
  if (url.protocol !== "file:") throw new Error("A local file URL is required.");
  return decodeURIComponent(url.pathname);
}
