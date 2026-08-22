/**
 * Docker smoke for the generic ngspice Microsandbox worker image.
 *
 * Default mode is read-only planning. `--run` builds one local image tag,
 * executes two generic circuits and one forbidden-directive case with
 * network/capabilities removed, and validates the output contract outside
 * the container. This is not Microsandbox cache preparation and not product
 * IsolatedCodeRunner wiring.
 */

import {
  parseSpiceIsolatedEvidence,
  parseSpiceOperatingPointResult,
} from "../../src/domain/electrical/spice/admitted/isolated-output.ts";
import { SPICE_ADMITTED_OUTPUT_MANIFEST } from "../../src/domain/electrical/spice/admitted/contract.ts";
import { NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT } from "../../src/adapters/electrical/spice/admitted/worker-contract.ts";
import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";

const DEFAULT_IMAGE = "casys/ngspice-microsandbox-worker:local";
const DOCKERFILE = "images/ngspice-microsandbox-worker/Dockerfile";
const DIVIDER =
  "src/testing/fixtures/electrical/spice/operating-point/resistor-divider.cir";
const DIODE = "src/testing/fixtures/electrical/spice/operating-point/diode-clamp.cir";
const EXPECTED_ENTRYPOINT = Object.freeze([
  NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.executable,
  ...NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.args,
]);

const options = parseArgs(Deno.args);
if (!options.run) {
  console.log(deterministicJson({
    schemaVersion: "ngspice-microsandbox-worker-gate-plan/1.0",
    status: "not-run",
    image: options.image,
    checks: [
      "docker-network-none",
      "read-only-rootfs",
      "capabilities-dropped",
      "entrypoint-has-no-caller-arguments",
      "resistor-divider-operating-point",
      "diode-model-operating-point",
      "forbidden-directive-rejection",
      "exact-result-and-evidence-outputs",
    ],
  }));
  Deno.exit(0);
}

await runSmoke(options);

async function runSmoke(options: Options): Promise<void> {
  const image = options.build ? await buildImage(options.image) : options.image;
  const inspected = await inspectImage(image);
  if (
    deterministicJson(inspected.entrypoint) !== deterministicJson(EXPECTED_ENTRYPOINT)
  ) {
    throw new Error("The ngspice worker ENTRYPOINT is not the registered command.");
  }
  if (
    inspected.user !== NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser
  ) {
    throw new Error("The ngspice worker user is not 65532:65532.");
  }
  const ngspiceVersion = await readNgspiceVersion(image);
  const divider = await runCircuit(image, DIVIDER, "divider");
  const diode = await runCircuit(image, DIODE, "diode");
  const rejected = await runForbidden(image);
  const dividerOut = divider.vOut;
  const dividerIin = divider.iVin;
  if (dividerOut !== 2.5 || dividerIin !== -0.0025) {
    throw new Error(
      `Divider OP is not the proven 2.5 V / -2.5 mA pair: v(out)=${dividerOut} i(vin)=${dividerIin}`,
    );
  }
  if (diode.vIn !== 5 || diode.diodeCurrent === undefined || diode.diodeCurrent <= 0) {
    throw new Error("Diode OP did not expose a positive @d1[id] with v(in)=5.");
  }
  console.log(deterministicJson({
    schemaVersion: "ngspice-microsandbox-worker-smoke/1.0",
    status: "passed",
    image,
    imageId: inspected.imageId,
    repoDigest: inspected.repoDigest,
    ngspiceVersion,
    entrypoint: inspected.entrypoint,
    divider: {
      vOut: divider.vOut,
      iVin: divider.iVin,
      observables: divider.observables,
    },
    diode: {
      vIn: diode.vIn,
      diodeCurrent: diode.diodeCurrent,
      observables: diode.observables,
    },
    forbiddenDirectiveRejected: rejected,
  }));
}

async function buildImage(tag: string): Promise<string> {
  const output = await docker([
    "build",
    "-f",
    DOCKERFILE,
    "-t",
    tag,
    ".",
  ]);
  if (!output.success) {
    throw new Error(`docker build failed: ${decode(output.stderr).slice(-4_000)}`);
  }
  return tag;
}

async function inspectImage(image: string): Promise<{
  readonly imageId: string;
  readonly repoDigest: string | null;
  readonly entrypoint: readonly string[];
  readonly user: string;
}> {
  const output = await docker([
    "image",
    "inspect",
    "--format",
    "{{json .}}",
    image,
  ]);
  if (!output.success) {
    throw new Error(`docker inspect failed: ${decode(output.stderr).slice(-2_000)}`);
  }
  const inspected = JSON.parse(decode(output.stdout)) as {
    Id?: string;
    RepoDigests?: string[];
    Config?: { Entrypoint?: string[] | null; User?: string };
  };
  const imageId = inspected.Id;
  if (typeof imageId !== "string" || !imageId.startsWith("sha256:")) {
    throw new Error("docker inspect did not return an image id.");
  }
  const repoDigest = inspected.RepoDigests?.[0] ?? null;
  return {
    imageId,
    repoDigest,
    entrypoint: Object.freeze([...(inspected.Config?.Entrypoint ?? [])]),
    user: inspected.Config?.User ?? "",
  };
}

async function readNgspiceVersion(image: string): Promise<string> {
  const output = await docker([
    "run",
    "--rm",
    "--network=none",
    "--entrypoint",
    "ngspice",
    image,
    "--version",
  ]);
  if (!output.success) {
    throw new Error(`ngspice --version failed: ${decode(output.stderr).slice(-2_000)}`);
  }
  const text = `${decode(output.stdout)}\n${decode(output.stderr)}`;
  const match = text.match(/\bngspice-(\d+)\b/i);
  if (!match) throw new Error("Could not read ngspice --version from the image.");
  return match[1]!;
}

async function runCircuit(
  image: string,
  sourceRelative: string,
  label: string,
): Promise<{
  readonly vIn?: number;
  readonly vOut?: number;
  readonly iVin?: number;
  readonly diodeCurrent?: number;
  readonly observables: number;
}> {
  const temporary = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: `casys-ngspice-${label}-`,
  });
  try {
    const sourceBytes = await Deno.readFile(sourceRelative);
    const output = await runWorker(image, temporary, sourceBytes);
    if (!output.success) {
      throw new Error(
        `${label} worker failed: ${decode(output.stderr).slice(-2_000)}`,
      );
    }
    const resultBytes = await Deno.readFile(`${temporary}/out/result.json`);
    const evidenceBytes = await Deno.readFile(`${temporary}/out/evidence.json`);
    const result = parseSpiceOperatingPointResult(resultBytes);
    const evidence = parseSpiceIsolatedEvidence(evidenceBytes);
    if (evidence.result.byteCount !== resultBytes.byteLength) {
      throw new Error(`${label} evidence result byteCount does not match.`);
    }
    const names: string[] = [];
    for await (const entry of Deno.readDir(`${temporary}/out`)) names.push(entry.name);
    names.sort();
    const expected = SPICE_ADMITTED_OUTPUT_MANIFEST.map((entry) => entry.basename)
      .slice()
      .sort();
    if (deterministicJson(names) !== deterministicJson(expected)) {
      throw new Error(`${label} did not emit the exact two-file output set.`);
    }
    return {
      vIn: result.observables.find((item) => item.nativeName === "v(in)")?.value,
      vOut: result.observables.find((item) => item.nativeName === "v(out)")?.value,
      iVin: result.observables.find((item) => item.nativeName === "i(vin)")?.value,
      diodeCurrent: result.observables.find((item) => item.nativeName === "@d1[id]")
        ?.value,
      observables: result.observables.length,
    };
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
}

async function runForbidden(image: string): Promise<true> {
  const temporary = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "casys-ngspice-forbidden-",
  });
  try {
    const source = "Vin in 0 DC 5\nR1 in 0 1k\n.op\n.end\n";
    const output = await runWorker(
      image,
      temporary,
      new TextEncoder().encode(source),
    );
    if (output.success) {
      throw new Error("Forbidden .op/.end source was accepted.");
    }
    for await (const _entry of Deno.readDir(`${temporary}/out`)) {
      throw new Error("Forbidden source wrote an output file.");
    }
    return true;
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
}

async function runWorker(
  image: string,
  temporary: string,
  sourceBytes: Uint8Array,
): Promise<Deno.CommandOutput> {
  const inputDirectory = `${temporary}/input`;
  const outputDirectory = `${temporary}/out`;
  const workDirectory = `${temporary}/work`;
  await Deno.mkdir(inputDirectory, { mode: 0o700 });
  for (const directory of [outputDirectory, workDirectory]) {
    await Deno.mkdir(directory, { mode: 0o777 });
    await Deno.chmod(directory, 0o777);
  }
  const sourcePath = `${inputDirectory}/source.cir`;
  await Deno.writeFile(sourcePath, sourceBytes, { mode: 0o444 });
  return await docker([
    "run",
    "--rm",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=32",
    "--memory=512m",
    "--cpus=1",
    "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=67108864",
    `--mount=type=bind,src=${sourcePath},dst=/input/source.cir,readonly`,
    `--mount=type=bind,src=${outputDirectory},dst=/out`,
    `--mount=type=bind,src=${workDirectory},dst=/work`,
    image,
  ]);
}

async function docker(args: string[]): Promise<Deno.CommandOutput> {
  return await new Deno.Command("docker", {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
}

interface Options {
  readonly run: boolean;
  readonly build: boolean;
  readonly image: string;
}

function parseArgs(args: readonly string[]): Options {
  let run = false;
  let build = true;
  let image = DEFAULT_IMAGE;
  for (const argument of args) {
    if (argument === "--run") {
      run = true;
      continue;
    }
    if (argument === "--no-build") {
      build = false;
      continue;
    }
    if (argument.startsWith("--image=")) {
      image = argument.slice("--image=".length);
      continue;
    }
    throw new Error(`Unsupported argument ${argument}.`);
  }
  return { run, build, image };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
