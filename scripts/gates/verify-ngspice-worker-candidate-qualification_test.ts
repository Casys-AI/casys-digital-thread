import { assertEquals, assertMatch, assertThrows } from "@std/assert";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../src/adapters/control-plane/first-party-capability-binding-catalog.ts";
import { buildFirstPartyMicrosandboxImageCandidateReceipt } from "../../src/adapters/control-plane/first-party-microsandbox-image-candidate-receipt.ts";
import { buildFirstPartyMicrosandboxImageCandidateImportRecord } from "../../src/adapters/control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
} from "../../src/adapters/control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";
import {
  NGSPICE_WORKER_CANDIDATE_QUALIFICATION_USAGE,
  parseNgspiceWorkerCandidateQualificationCli,
} from "./verify-ngspice-worker-candidate-qualification.ts";

const SCRIPT = new URL(
  "./verify-ngspice-worker-candidate-qualification.ts",
  import.meta.url,
).pathname;
const GIT_SHA = "a".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"c".repeat(64)}`;
const MICROSANDBOX_DIGEST = `sha256:${"9".repeat(64)}`;

Deno.test("ngspice candidate qualification CLI is planning by default and refuses selector flags", () => {
  assertEquals(
    parseNgspiceWorkerCandidateQualificationCli(["--help"]),
    { mode: "help" },
  );
  assertEquals(
    parseNgspiceWorkerCandidateQualificationCli([
      "--import-record=record.json",
    ]),
    { mode: "plan", importRecordPath: "record.json" },
  );
  assertEquals(
    parseNgspiceWorkerCandidateQualificationCli([
      "--import-record=record.json",
      "--run",
    ]),
    { mode: "run", importRecordPath: "record.json" },
  );
  assertEquals(
    parseNgspiceWorkerCandidateQualificationCli([
      "--import-record=record.json",
      "--recover",
    ]),
    { mode: "recover", importRecordPath: "record.json" },
  );
  assertThrows(
    () => parseNgspiceWorkerCandidateQualificationCli([]),
    TypeError,
    "eligibleForPromotion remains false",
  );
  assertThrows(
    () =>
      parseNgspiceWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--image=caller",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseNgspiceWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--digest=sha256:00",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseNgspiceWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--provider=ngspice",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseNgspiceWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--profile=spice-circuit-closed-subset-v1",
      ]),
    TypeError,
    "is not valid for first-party candidate qualification",
  );
  assertThrows(
    () =>
      parseNgspiceWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--source=divider.cir",
      ]),
    TypeError,
    "is not valid for first-party candidate qualification",
  );
  assertThrows(
    () =>
      parseNgspiceWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--netlist=divider.cir",
      ]),
    TypeError,
    "is not valid for first-party candidate qualification",
  );
  assertThrows(
    () =>
      parseNgspiceWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--command=/usr/bin/ngspice",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseNgspiceWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--args=--batch",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseNgspiceWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--endpoint=http://127.0.0.1",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseNgspiceWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--tool=ngspice",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseNgspiceWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--worker=ngspice-worker",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseNgspiceWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--binding=ngspice-admitted-circuit",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseNgspiceWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--unit-id=casys.spice-worker",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseNgspiceWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--run",
        "--recover",
      ]),
    TypeError,
    "only one of --run or --recover",
  );
  assertMatch(
    NGSPICE_WORKER_CANDIDATE_QUALIFICATION_USAGE,
    /eligibleForPromotion remains false/u,
  );
  assertMatch(
    NGSPICE_WORKER_CANDIDATE_QUALIFICATION_USAGE,
    /resistor-divider/u,
  );
});

Deno.test("ngspice candidate qualification CLI plan validates the import record without mutation", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-ngspice-candidate-cli-",
  });
  try {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
    const receipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
      matrix,
      matrixFingerprint: await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(
        matrix,
      ),
      physicalImageId: "ngspice-worker",
      ociIndexDigest: OCI_INDEX_DIGEST,
      platformManifestDigest: PLATFORM_MANIFEST_DIGEST,
      locatorTag: `git-${GIT_SHA}-run-1-1`,
      gitSha: GIT_SHA,
      gitTag: "first-party-microvm-v0.1.0",
      buildMetadata: { "containerimage.digest": OCI_INDEX_DIGEST },
    });
    const record = await buildFirstPartyMicrosandboxImageCandidateImportRecord({
      receipt,
      microsandboxManifestDigest: MICROSANDBOX_DIGEST,
      status: "imported",
    });
    const recordPath = `${directory}/import-record.json`;
    await Deno.writeTextFile(recordPath, `${deterministicJson(record)}\n`);
    const success = await invokeCli(directory, [`--import-record=${recordPath}`]);
    assertEquals(success.code, 0, new TextDecoder().decode(success.stderr));
    const stdout = new TextDecoder().decode(success.stdout);
    assertMatch(stdout, /"mode":"plan"/u);
    assertMatch(stdout, /"mutation":false/u);
    assertMatch(stdout, /"kind":"candidate-qualification"/u);
    assertMatch(stdout, /ngspice-admitted-circuit/u);
    assertMatch(stdout, /eligibleForPromotion=false/u);
    assertEquals((await Array.fromAsync(Deno.readDir(directory))).length, 1);

    const modelicaReceipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
      matrix,
      matrixFingerprint: await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(
        matrix,
      ),
      physicalImageId: "modelica-microsandbox-worker",
      ociIndexDigest: OCI_INDEX_DIGEST,
      platformManifestDigest: PLATFORM_MANIFEST_DIGEST,
      locatorTag: `git-${GIT_SHA}-run-1-1`,
      gitSha: GIT_SHA,
      gitTag: "first-party-microvm-v0.1.0",
      buildMetadata: { "containerimage.digest": OCI_INDEX_DIGEST },
    });
    const modelica = await buildFirstPartyMicrosandboxImageCandidateImportRecord({
      receipt: modelicaReceipt,
      microsandboxManifestDigest: MICROSANDBOX_DIGEST,
      status: "imported",
    });
    const modelicaPath = `${directory}/modelica-record.json`;
    await Deno.writeTextFile(modelicaPath, `${deterministicJson(modelica)}\n`);
    const rejected = await invokeCli(directory, [`--import-record=${modelicaPath}`]);
    assertEquals(rejected.code !== 0, true);
    assertMatch(
      new TextDecoder().decode(rejected.stderr),
      /physicalImageId=ngspice-worker/u,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function invokeCli(
  directory: string,
  args: readonly string[],
): Promise<Deno.CommandOutput> {
  return new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--no-prompt",
      "--frozen",
      `--allow-read=.,${directory}`,
      "--allow-env=LOG",
      SCRIPT,
      ...args,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
}
