import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { fingerprintCapabilityRuntimeObservedHost } from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import type { CapabilityRuntimeHostObservation } from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import { buildFirstPartyMicrosandboxImageCandidateReceipt } from "./first-party-microsandbox-image-candidate-receipt.ts";
import {
  buildFirstPartyMicrosandboxImageCandidateImportRecord,
  fingerprintFirstPartyMicrosandboxImageCandidateImportRecord,
  type FirstPartyMicrosandboxImageCandidateImportRecord,
  firstPartyMicrosandboxImageCandidateReference,
} from "./first-party-microsandbox-image-candidate-import-record.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
} from "./first-party-microsandbox-image-distribution-matrix.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  assertBoundCandidateImportPhysicalImageId,
  BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID,
  buildFirstPartyMicrosandboxImageCandidateQualificationRecord,
  FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_DIRECTORY,
  firstPartyMicrosandboxImageCandidateQualificationRoot,
  GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID,
  parseFirstPartyMicrosandboxImageCandidateQualificationCli,
  parseFirstPartyMicrosandboxImageCandidateQualificationRecord,
  persistFirstPartyMicrosandboxImageCandidateQualificationRecord,
  readObservedLinuxArm64Host,
} from "./first-party-microsandbox-image-candidate-qualification.ts";

const GIT_SHA = "a".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"c".repeat(64)}`;
const MICROSANDBOX_DIGEST = `sha256:${"9".repeat(64)}`;
const USAGE = "Usage: candidate-qualification --import-record=<path> [--run]";

Deno.test("candidate qualification CLI accepts only --import-record and boolean action flags", () => {
  assertEquals(
    parseFirstPartyMicrosandboxImageCandidateQualificationCli(["--help"], {
      usage: USAGE,
    }),
    { mode: "help" },
  );
  assertEquals(
    parseFirstPartyMicrosandboxImageCandidateQualificationCli(
      ["--import-record=record.json"],
      { usage: USAGE },
    ),
    { mode: "plan", importRecordPath: "record.json" },
  );
  assertEquals(
    parseFirstPartyMicrosandboxImageCandidateQualificationCli(
      ["--import-record=record.json", "--run"],
      { usage: USAGE },
    ),
    { mode: "run", importRecordPath: "record.json" },
  );
  assertEquals(
    parseFirstPartyMicrosandboxImageCandidateQualificationCli(
      ["--import-record=record.json", "--recover"],
      { usage: USAGE, allowRecover: true },
    ),
    { mode: "recover", importRecordPath: "record.json" },
  );
  assertThrows(
    () =>
      parseFirstPartyMicrosandboxImageCandidateQualificationCli([], {
        usage: USAGE,
      }),
    TypeError,
    USAGE,
  );
  assertThrows(
    () =>
      parseFirstPartyMicrosandboxImageCandidateQualificationCli(
        ["--import-record=record.json", "--image=caller"],
        { usage: USAGE },
      ),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseFirstPartyMicrosandboxImageCandidateQualificationCli(
        ["--import-record=record.json", "--digest=sha256:00"],
        { usage: USAGE },
      ),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseFirstPartyMicrosandboxImageCandidateQualificationCli(
        ["--import-record=record.json", "--worker=build123d"],
        { usage: USAGE },
      ),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertThrows(
    () =>
      parseFirstPartyMicrosandboxImageCandidateQualificationCli(
        ["--import-record=record.json", "--run=true"],
        { usage: USAGE },
      ),
    TypeError,
    "boolean acknowledgement and takes no value",
  );
  assertThrows(
    () =>
      parseFirstPartyMicrosandboxImageCandidateQualificationCli(
        ["--import-record=record.json", "--recover"],
        { usage: USAGE },
      ),
    TypeError,
    "is not valid for first-party candidate qualification",
  );
  assertEquals(
    parseFirstPartyMicrosandboxImageCandidateQualificationCli(
      ["--import-record=record.json", "--retry-infrastructure-failure"],
      { usage: USAGE, allowRetryInfrastructureFailure: true },
    ),
    { mode: "retry-infrastructure-failure", importRecordPath: "record.json" },
  );
  assertThrows(
    () =>
      parseFirstPartyMicrosandboxImageCandidateQualificationCli(
        ["--import-record=record.json", "--retry-infrastructure-failure"],
        { usage: USAGE },
      ),
    TypeError,
    "is not valid for first-party candidate qualification",
  );
  assertThrows(
    () =>
      parseFirstPartyMicrosandboxImageCandidateQualificationCli(
        ["--import-record=record.json", "--run", "--retry-infrastructure-failure"],
        { usage: USAGE, allowRetryInfrastructureFailure: true },
      ),
    TypeError,
    "only one of --run, --recover, or --retry-infrastructure-failure",
  );
  assertThrows(
    () =>
      parseFirstPartyMicrosandboxImageCandidateQualificationCli(
        ["--import-record=record.json", "--retry-infrastructure-failure=true"],
        { usage: USAGE, allowRetryInfrastructureFailure: true },
      ),
    TypeError,
    "boolean acknowledgement and takes no value",
  );
  assertThrows(
    () =>
      parseFirstPartyMicrosandboxImageCandidateQualificationCli(
        ["--import-record=record.json", "--image=caller"],
        { usage: USAGE, allowRetryInfrastructureFailure: true },
      ),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
});

Deno.test("candidate qualification record binds host identity and the exact run/receipt", async () => {
  const record = await importRecord(BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID);
  const evidence = qualificationEvidence();
  const qualification =
    await buildFirstPartyMicrosandboxImageCandidateQualificationRecord(
      record,
      evidence,
    );
  assertEquals(qualification.kind, "candidate-qualification");
  assertEquals(
    qualification.physicalImageId,
    BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID,
  );
  assertEquals(
    qualification.candidateReference,
    firstPartyMicrosandboxImageCandidateReference(
      BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID,
      MICROSANDBOX_DIGEST,
    ),
  );
  assertEquals(qualification.identities, record.identities);
  assertEquals(
    qualification.importRecord.fingerprint,
    await fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(record),
  );
  assertEquals(qualification.observedHost.platform, "linux/arm64");
  assertEquals(
    qualification.observedHost.identityFingerprint,
    evidence.observedHost.identityFingerprint,
  );
  assertEquals(
    qualification.observedHost.fingerprint,
    await fingerprintCapabilityRuntimeObservedHost(
      "linux/arm64",
      evidence.observedHost.identityFingerprint,
    ),
  );
  assertEquals(qualification.execution.runId, evidence.runId);
  assertEquals(qualification.execution.receiptFingerprint, evidence.receiptFingerprint);
  assertEquals(qualification.eligibleForPromotion, false);
  assertEquals(qualification.evidence, "host-runtime-only");
  assertEquals(qualification.engineeringLevels, { l3: false, l4: false, l5: false });
  const parsed = await parseFirstPartyMicrosandboxImageCandidateQualificationRecord(
    JSON.parse(deterministicJson(qualification)),
  );
  assertEquals(deterministicJson(parsed), deterministicJson(qualification));
  assertEquals(
    firstPartyMicrosandboxImageCandidateQualificationRoot(
      qualification.physicalImageId,
      qualification.importRecord.fingerprint,
    ),
    `${FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_DIRECTORY}/${BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID}/${
      qualification.importRecord.fingerprint.replace(":", "-")
    }`,
  );
});

Deno.test("candidate qualification record refuses promotion or a swapped candidate reference", async () => {
  const record = await importRecord(GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID);
  const qualification =
    await buildFirstPartyMicrosandboxImageCandidateQualificationRecord(
      record,
      qualificationEvidence(),
    );
  const promoted = JSON.parse(deterministicJson(qualification)) as Record<
    string,
    unknown
  >;
  promoted.eligibleForPromotion = true;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateQualificationRecord(promoted),
    TypeError,
    "eligibleForPromotion=false",
  );
  const swapped = JSON.parse(deterministicJson(qualification)) as Record<
    string,
    unknown
  >;
  swapped.candidateReference = firstPartyMicrosandboxImageCandidateReference(
    BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID,
    MICROSANDBOX_DIGEST,
  );
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateQualificationRecord(swapped),
    TypeError,
    "casys/first-party-candidate-<physicalImageId>",
  );
});

Deno.test("candidate qualification record refuses a non-arm64 host or a self-attested host fingerprint", async () => {
  const record = await importRecord(BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID);
  const evidence = qualificationEvidence();
  await assertRejects(
    () =>
      buildFirstPartyMicrosandboxImageCandidateQualificationRecord(record, {
        ...evidence,
        observedHost: { ...evidence.observedHost, platform: "linux/amd64" },
      }),
    TypeError,
    "linux/arm64",
  );
  const qualification =
    await buildFirstPartyMicrosandboxImageCandidateQualificationRecord(
      record,
      evidence,
    );
  const forgedHost = JSON.parse(deterministicJson(qualification)) as Record<
    string,
    unknown
  >;
  const observedHost = forgedHost.observedHost as Record<string, unknown>;
  const fingerprint = observedHost.fingerprint as Record<string, unknown>;
  fingerprint.digest = "0".repeat(64);
  observedHost.fingerprint = fingerprint;
  forgedHost.observedHost = observedHost;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateQualificationRecord(forgedHost),
    TypeError,
    "exact rebuilt first-party qualification record",
  );
  const swappedIdentity = JSON.parse(deterministicJson(qualification)) as Record<
    string,
    unknown
  >;
  const swappedHost = swappedIdentity.observedHost as Record<string, unknown>;
  swappedHost.identityFingerprint = {
    algorithm: "sha256",
    digest: "e".repeat(64),
  };
  swappedIdentity.observedHost = swappedHost;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateQualificationRecord(swappedIdentity),
    TypeError,
    "exact rebuilt first-party qualification record",
  );
});

Deno.test("candidate qualification host observation refuses anything other than linux/arm64 before later work", async () => {
  let reads = 0;
  await assertRejects(
    () =>
      readObservedLinuxArm64Host({
        read: () => {
          reads += 1;
          return Promise.resolve({
            ...qualificationEvidence().observedHost,
            platform: "linux/amd64" as const,
          });
        },
      }),
    Error,
    "linux/arm64",
  );
  assertEquals(reads, 1);
});

Deno.test("candidate qualification record persist is idempotent for the exact rebuilt document", async () => {
  const record = await importRecord(BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID);
  const qualification =
    await buildFirstPartyMicrosandboxImageCandidateQualificationRecord(
      record,
      qualificationEvidence(),
    );
  const directory = await Deno.makeTempDir({
    prefix: "casys-candidate-qualification-record-",
  });
  try {
    const first = await persistFirstPartyMicrosandboxImageCandidateQualificationRecord(
      directory,
      qualification,
    );
    const second = await persistFirstPartyMicrosandboxImageCandidateQualificationRecord(
      directory,
      qualification,
    );
    assertEquals(deterministicJson(first), deterministicJson(qualification));
    assertEquals(deterministicJson(second), deterministicJson(qualification));
    const swapped = JSON.parse(deterministicJson(qualification)) as Record<
      string,
      unknown
    >;
    swapped.execution = {
      ...(swapped.execution as Record<string, unknown>),
      runId: "other-run",
    };
    await assertRejects(
      () =>
        persistFirstPartyMicrosandboxImageCandidateQualificationRecord(
          directory,
          swapped as never,
        ),
      Error,
      "already occupies this import-record identity",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("bound candidate import physicalImageId is rejected before any other effect", async () => {
  const record = await importRecord(BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID);
  assertThrows(
    () =>
      assertBoundCandidateImportPhysicalImageId(
        record,
        GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID,
      ),
    TypeError,
    "physicalImageId=geometry-module-assembler-worker",
  );
});

function qualificationEvidence(): {
  readonly observedHost: CapabilityRuntimeHostObservation;
  readonly runId: string;
  readonly receiptFingerprint: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
} {
  return {
    observedHost: {
      schemaVersion: "capability-runtime-host-observation/1.0",
      identityFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
      platform: "linux/arm64",
      images: [],
    },
    runId: "build123d-isolated-worker-candidate-qualification-test",
    receiptFingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
  };
}

async function importRecord(
  physicalImageId: string,
): Promise<FirstPartyMicrosandboxImageCandidateImportRecord> {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const receipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
    matrix,
    matrixFingerprint: await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(
      matrix,
    ),
    physicalImageId,
    ociIndexDigest: OCI_INDEX_DIGEST,
    platformManifestDigest: PLATFORM_MANIFEST_DIGEST,
    locatorTag: `git-${GIT_SHA}-run-1-1`,
    gitSha: GIT_SHA,
    gitTag: "first-party-microvm-v0.1.0",
    buildMetadata: { "containerimage.digest": OCI_INDEX_DIGEST },
  });
  return await buildFirstPartyMicrosandboxImageCandidateImportRecord({
    receipt,
    microsandboxManifestDigest: MICROSANDBOX_DIGEST,
    status: "imported",
  });
}
