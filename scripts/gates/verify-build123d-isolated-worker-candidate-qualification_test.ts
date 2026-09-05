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
  BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_USAGE,
  parseBuild123dIsolatedWorkerCandidateQualificationCli,
} from "./verify-build123d-isolated-worker-candidate-qualification.ts";

const SCRIPT = new URL(
  "./verify-build123d-isolated-worker-candidate-qualification.ts",
  import.meta.url,
).pathname;
const GIT_SHA = "a".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"c".repeat(64)}`;
const MICROSANDBOX_DIGEST = `sha256:${"9".repeat(64)}`;

Deno.test("Build123d candidate qualification CLI is planning by default and refuses selector flags", () => {
  assertEquals(
    parseBuild123dIsolatedWorkerCandidateQualificationCli(["--help"]),
    { mode: "help" },
  );
  assertEquals(
    parseBuild123dIsolatedWorkerCandidateQualificationCli([
      "--import-record=record.json",
    ]),
    { mode: "plan", importRecordPath: "record.json" },
  );
  assertEquals(
    parseBuild123dIsolatedWorkerCandidateQualificationCli([
      "--import-record=record.json",
      "--run",
    ]),
    { mode: "run", importRecordPath: "record.json" },
  );
  assertThrows(
    () => parseBuild123dIsolatedWorkerCandidateQualificationCli([]),
    TypeError,
    "eligibleForPromotion remains false",
  );
  assertThrows(
    () =>
      parseBuild123dIsolatedWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--image=caller",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertEquals(
    parseBuild123dIsolatedWorkerCandidateQualificationCli([
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
      parseBuild123dIsolatedWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--recover",
      ]),
    TypeError,
    "is not valid for first-party candidate qualification",
  );
  assertThrows(
    () =>
      parseBuild123dIsolatedWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--run",
        "--retry-infrastructure-failure",
      ]),
    TypeError,
    "only one of --run, --recover, or --retry-infrastructure-failure",
  );
  assertThrows(
    () =>
      parseBuild123dIsolatedWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--image=caller",
        "--retry-infrastructure-failure",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertMatch(
    BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_USAGE,
    /eligibleForPromotion remains false/u,
  );
});

Deno.test("Build123d candidate qualification CLI plan validates the import record without mutation", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-build123d-candidate-cli-",
  });
  try {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
    const receipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
      matrix,
      matrixFingerprint: await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(
        matrix,
      ),
      physicalImageId: "build123d-isolated-worker",
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
    assertMatch(stdout, /eligibleForPromotion=false/u);
    assertMatch(stdout, /Candidate qualification only/u);

    const geometryReceipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
      matrix,
      matrixFingerprint: await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(
        matrix,
      ),
      physicalImageId: "geometry-module-assembler-worker",
      ociIndexDigest: OCI_INDEX_DIGEST,
      platformManifestDigest: PLATFORM_MANIFEST_DIGEST,
      locatorTag: `git-${GIT_SHA}-run-1-1`,
      gitSha: GIT_SHA,
      gitTag: "first-party-microvm-v0.1.0",
      buildMetadata: { "containerimage.digest": OCI_INDEX_DIGEST },
    });
    const geometry = await buildFirstPartyMicrosandboxImageCandidateImportRecord({
      receipt: geometryReceipt,
      microsandboxManifestDigest: MICROSANDBOX_DIGEST,
      status: "imported",
    });
    const geometryPath = `${directory}/geometry-record.json`;
    await Deno.writeTextFile(geometryPath, `${deterministicJson(geometry)}\n`);
    const rejected = await invokeCli(directory, [`--import-record=${geometryPath}`]);
    assertEquals(rejected.code !== 0, true);
    assertMatch(
      new TextDecoder().decode(rejected.stderr),
      /physicalImageId=build123d-isolated-worker/u,
    );

    const stale = JSON.parse(deterministicJson(record)) as Record<string, unknown>;
    const inputMatrix = stale.inputMatrix as Record<string, unknown>;
    inputMatrix.fingerprint = `sha256:${"0".repeat(64)}`;
    stale.inputMatrix = inputMatrix;
    const stalePath = `${directory}/stale.json`;
    await Deno.writeTextFile(stalePath, `${deterministicJson(stale)}\n`);
    const staleRun = await invokeCli(directory, [`--import-record=${stalePath}`]);
    assertEquals(staleRun.code !== 0, true);
    assertMatch(
      new TextDecoder().decode(staleRun.stderr),
      /exact rebuilt first-party import record|current server-owned distribution matrix/u,
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
