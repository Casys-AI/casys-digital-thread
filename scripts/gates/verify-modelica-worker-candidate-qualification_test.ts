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
  MODELICA_WORKER_CANDIDATE_QUALIFICATION_USAGE,
  parseModelicaWorkerCandidateQualificationCli,
} from "./verify-modelica-worker-candidate-qualification.ts";

const SCRIPT = new URL(
  "./verify-modelica-worker-candidate-qualification.ts",
  import.meta.url,
).pathname;
const GIT_SHA = "a".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"c".repeat(64)}`;
const MICROSANDBOX_DIGEST = `sha256:${"9".repeat(64)}`;

Deno.test("Modelica candidate qualification CLI is planning by default and refuses selector flags", () => {
  assertEquals(
    parseModelicaWorkerCandidateQualificationCli(["--help"]),
    { mode: "help" },
  );
  assertEquals(
    parseModelicaWorkerCandidateQualificationCli([
      "--import-record=record.json",
    ]),
    { mode: "plan", importRecordPath: "record.json" },
  );
  assertEquals(
    parseModelicaWorkerCandidateQualificationCli([
      "--import-record=record.json",
      "--run",
    ]),
    { mode: "run", importRecordPath: "record.json" },
  );
  assertEquals(
    parseModelicaWorkerCandidateQualificationCli([
      "--import-record=record.json",
      "--recover",
    ]),
    { mode: "recover", importRecordPath: "record.json" },
  );
  assertThrows(
    () => parseModelicaWorkerCandidateQualificationCli([]),
    TypeError,
    "eligibleForPromotion remains false",
  );
  assertThrows(
    () =>
      parseModelicaWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--image=caller",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseModelicaWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--digest=sha256:00",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseModelicaWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--provider=openmodelica",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseModelicaWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--profile=openmodelica-qualified-kit",
      ]),
    TypeError,
    "is not valid for first-party candidate qualification",
  );
  assertThrows(
    () =>
      parseModelicaWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--source=model.mo",
      ]),
    TypeError,
    "is not valid for first-party candidate qualification",
  );
  assertEquals(
    parseModelicaWorkerCandidateQualificationCli([
      "--import-record=record.json",
      "--retry-infrastructure-failure",
    ]),
    {
      mode: "retry-infrastructure-failure",
      importRecordPath: "record.json",
    },
  );
  assertThrows(
    () =>
      parseModelicaWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--run",
        "--recover",
      ]),
    TypeError,
    "only one of --run, --recover, or --retry-infrastructure-failure",
  );
  assertThrows(
    () =>
      parseModelicaWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--image=caller",
        "--retry-infrastructure-failure",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertMatch(
    MODELICA_WORKER_CANDIDATE_QUALIFICATION_USAGE,
    /eligibleForPromotion remains false/u,
  );
  assertMatch(
    MODELICA_WORKER_CANDIDATE_QUALIFICATION_USAGE,
    /openmodelica-qualified-kit and openmodelica-admitted-modelica/u,
  );
  assertMatch(
    MODELICA_WORKER_CANDIDATE_QUALIFICATION_USAGE,
    /If successor\.json exists, --recover reconciles that canonical successor without a worker call/u,
  );
});

Deno.test("Modelica candidate qualification CLI plan validates the import record without mutation", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-modelica-candidate-cli-",
  });
  try {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
    const receipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
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
    assertMatch(stdout, /openmodelica-qualified-kit/u);
    assertMatch(stdout, /openmodelica-admitted-modelica/u);
    assertMatch(stdout, /eligibleForPromotion=false/u);
    assertEquals((await Array.fromAsync(Deno.readDir(directory))).length, 1);

    const calculixReceipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
      matrix,
      matrixFingerprint: await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(
        matrix,
      ),
      physicalImageId: "calculix-worker",
      ociIndexDigest: OCI_INDEX_DIGEST,
      platformManifestDigest: PLATFORM_MANIFEST_DIGEST,
      locatorTag: `git-${GIT_SHA}-run-1-1`,
      gitSha: GIT_SHA,
      gitTag: "first-party-microvm-v0.1.0",
      buildMetadata: { "containerimage.digest": OCI_INDEX_DIGEST },
    });
    const calculix = await buildFirstPartyMicrosandboxImageCandidateImportRecord({
      receipt: calculixReceipt,
      microsandboxManifestDigest: MICROSANDBOX_DIGEST,
      status: "imported",
    });
    const calculixPath = `${directory}/calculix-record.json`;
    await Deno.writeTextFile(calculixPath, `${deterministicJson(calculix)}\n`);
    const rejected = await invokeCli(directory, [`--import-record=${calculixPath}`]);
    assertEquals(rejected.code !== 0, true);
    assertMatch(
      new TextDecoder().decode(rejected.stderr),
      /physicalImageId=modelica-microsandbox-worker/u,
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
