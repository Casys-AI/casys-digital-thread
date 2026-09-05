/**
 * Render one candidate OCI receipt from the complete server-owned distribution
 * matrix and exact Docker Buildx outputs. This script only writes the two
 * named receipt files; it does not publish, qualify, import, or promote an
 * image.
 */

import { join } from "node:path";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../src/adapters/control-plane/first-party-capability-binding-catalog.ts";
import {
  buildFirstPartyMicrosandboxImageCandidateReceipt,
  type FirstPartyMicrosandboxCandidateBuildMetadata,
  renderFirstPartyMicrosandboxImageCandidateReceiptText,
} from "../../src/adapters/control-plane/first-party-microsandbox-image-candidate-receipt.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
  type FirstPartyMicrosandboxImageDistributionMatrix,
} from "../../src/adapters/control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";

export interface WriteFirstPartyMicrosandboxImageCandidateReceiptArguments {
  readonly matrixPath: string;
  readonly buildMetadataPath: string;
  readonly physicalImageId: string;
  readonly ociIndexDigest: string;
  readonly platformManifestDigest: string;
  readonly locatorTag: string;
  readonly gitSha: string;
  readonly gitTag: string;
  readonly outputDirectory: string;
}

export async function writeFirstPartyMicrosandboxImageCandidateReceipt(
  arguments_: WriteFirstPartyMicrosandboxImageCandidateReceiptArguments,
): Promise<void> {
  const matrixSource = await Deno.readTextFile(arguments_.matrixPath);
  const matrix = await exactServerOwnedMatrix(matrixSource);
  const buildMetadata = parseBuildMetadata(
    await Deno.readTextFile(arguments_.buildMetadataPath),
  );
  const receipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
    matrix,
    matrixFingerprint: await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(
      matrix,
    ),
    physicalImageId: arguments_.physicalImageId,
    ociIndexDigest: arguments_.ociIndexDigest,
    platformManifestDigest: arguments_.platformManifestDigest,
    locatorTag: arguments_.locatorTag,
    gitSha: arguments_.gitSha,
    gitTag: arguments_.gitTag,
    buildMetadata,
  });
  await Promise.all([
    Deno.writeTextFile(
      join(arguments_.outputDirectory, "receipt.json"),
      `${deterministicJson(receipt)}\n`,
    ),
    Deno.writeTextFile(
      join(arguments_.outputDirectory, "receipt.txt"),
      renderFirstPartyMicrosandboxImageCandidateReceiptText(receipt),
    ),
  ]);
}

export function parseWriteFirstPartyMicrosandboxImageCandidateReceiptArguments(
  args: readonly string[],
): WriteFirstPartyMicrosandboxImageCandidateReceiptArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      flag === undefined || value === undefined || !flag.startsWith("--") ||
      values.has(flag)
    ) {
      throw new TypeError(
        "Candidate receipt arguments must be unique --flag value pairs.",
      );
    }
    values.set(flag, value);
  }
  const required = (flag: string): string => {
    const value = values.get(flag);
    if (value === undefined || value.length === 0) {
      throw new TypeError(`Candidate receipt requires ${flag}.`);
    }
    return value;
  };
  const expected = new Set([
    "--matrix",
    "--build-metadata",
    "--physical-image-id",
    "--oci-index-digest",
    "--platform-manifest-digest",
    "--locator-tag",
    "--git-sha",
    "--git-tag",
    "--output-directory",
  ]);
  for (const flag of values.keys()) {
    if (!expected.has(flag)) {
      throw new TypeError(`Candidate receipt does not accept ${flag}.`);
    }
  }
  return Object.freeze({
    matrixPath: required("--matrix"),
    buildMetadataPath: required("--build-metadata"),
    physicalImageId: required("--physical-image-id"),
    ociIndexDigest: required("--oci-index-digest"),
    platformManifestDigest: required("--platform-manifest-digest"),
    locatorTag: required("--locator-tag"),
    gitSha: required("--git-sha"),
    gitTag: required("--git-tag"),
    outputDirectory: required("--output-directory"),
  });
}

async function exactServerOwnedMatrix(
  source: string,
): Promise<FirstPartyMicrosandboxImageDistributionMatrix> {
  const parsed = parseJsonObject(
    source,
    "distribution matrix",
  ) as unknown as FirstPartyMicrosandboxImageDistributionMatrix;
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const expected = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  if (deterministicJson(parsed) !== deterministicJson(expected)) {
    throw new TypeError(
      "Candidate receipt matrix is not the complete server-owned distribution matrix for this commit.",
    );
  }
  return parsed;
}

function parseBuildMetadata(
  source: string,
): FirstPartyMicrosandboxCandidateBuildMetadata {
  return parseJsonObject(
    source,
    "Buildx metadata",
  ) as unknown as FirstPartyMicrosandboxCandidateBuildMetadata;
}

function parseJsonObject(source: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new TypeError(`${label} must be valid JSON: ${detail}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

if (import.meta.main) {
  await writeFirstPartyMicrosandboxImageCandidateReceipt(
    parseWriteFirstPartyMicrosandboxImageCandidateReceiptArguments(Deno.args),
  );
}
