import { assertEquals, assertMatch, assertThrows } from "@std/assert";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../src/adapters/control-plane/first-party-capability-binding-catalog.ts";
import { buildFirstPartyMicrosandboxImageCandidateReceipt } from "../../src/adapters/control-plane/first-party-microsandbox-image-candidate-receipt.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
} from "../../src/adapters/control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";
import {
  FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_USAGE,
  parseFirstPartyMicrosandboxImageCandidateImportCli,
} from "./import-first-party-microsandbox-image-candidate.ts";

const SCRIPT = new URL(
  "./import-first-party-microsandbox-image-candidate.ts",
  import.meta.url,
).pathname;
const GIT_SHA = "b".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"c".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"d".repeat(64)}`;

Deno.test("candidate import CLI is planning by default and requires an explicit --run", () => {
  assertEquals(
    parseFirstPartyMicrosandboxImageCandidateImportCli(["--help"]),
    { mode: "help" },
  );
  assertEquals(
    parseFirstPartyMicrosandboxImageCandidateImportCli(["--receipt=receipt.json"]),
    { mode: "plan", receiptPath: "receipt.json" },
  );
  assertEquals(
    parseFirstPartyMicrosandboxImageCandidateImportCli([
      "--receipt=receipt.json",
      "--run",
    ]),
    { mode: "run", receiptPath: "receipt.json" },
  );
  assertThrows(
    () => parseFirstPartyMicrosandboxImageCandidateImportCli([]),
    TypeError,
    "Domain qualification is not run. Promotion is false.",
  );
  assertThrows(
    () =>
      parseFirstPartyMicrosandboxImageCandidateImportCli([
        "--receipt=receipt.json",
        "--image=caller",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseFirstPartyMicrosandboxImageCandidateImportCli([
        "--receipt=receipt.json",
        "--digest=sha256:00",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertMatch(
    FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_USAGE,
    /runtimeQualification remains not-run/u,
  );
  assertMatch(
    FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_USAGE,
    /eligibleForPromotion remains false/u,
  );
});

Deno.test("candidate import CLI plan validates the receipt without mutation", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-candidate-import-cli-" });
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
      locatorTag: `git-${GIT_SHA}-run-9-1`,
      gitSha: GIT_SHA,
      gitTag: "first-party-microvm-v0.1.0",
      buildMetadata: { "containerimage.digest": OCI_INDEX_DIGEST },
    });
    const receiptPath = `${directory}/receipt.json`;
    await Deno.writeTextFile(receiptPath, `${deterministicJson(receipt)}\n`);
    const success = await invokeCli(directory, ["--receipt=" + receiptPath]);
    assertEquals(success.code, 0, new TextDecoder().decode(success.stderr));
    const stdout = new TextDecoder().decode(success.stdout);
    assertMatch(stdout, /"mode":"plan"/u);
    assertMatch(stdout, /"mutation":false/u);
    assertMatch(stdout, /runtimeQualification=not-run/u);
    assertMatch(stdout, /eligibleForPromotion=false/u);
    assertMatch(stdout, /Domain qualification remains not-run/u);
    assertMatch(stdout, /Promotion is false/u);

    const stale = await invokeCli(directory, [
      "--receipt=" + receiptPath,
      "--image=ngspice",
    ]);
    assertEquals(stale.code !== 0, true);
    assertMatch(
      new TextDecoder().decode(stale.stderr),
      /does not accept provider, image, digest, platform/u,
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
      SCRIPT,
      ...args,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
}
