import {
  BEHAVE_FOUNDATION_REVIEW_SCHEMA_VERSION,
  type BehaveFoundationCandidateReview,
  type BehaveFoundationReviewDocument,
  type VerifiedBehaveFoundationCandidateReview,
} from "../../application/control-plane/read-model/behave-foundation-review.ts";
import type { RuntimePlatform } from "../../application/control-plane/read-model/capability-pack.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyArray,
  rejectDuplicates,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import { fingerprintResourceBytes } from "../../domain/kernel/resource-bytes.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";

const DEFAULT_REVIEW_PATH = "config/capability-packs/behave-foundation.review.json";
const SHA256_HEX = /^[a-f0-9]{64}$/;

export interface LoadBehaveFoundationCandidateReviewOptions {
  readonly path?: string;
  readonly readTextFile?: (path: string) => Promise<string>;
}

export async function loadBehaveFoundationCandidateReview(
  options: LoadBehaveFoundationCandidateReviewOptions = {},
): Promise<VerifiedBehaveFoundationCandidateReview> {
  const readTextFile = options.readTextFile ?? Deno.readTextFile;
  const path = options.path ?? DEFAULT_REVIEW_PATH;
  const source = await readTextFile(path);
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new TypeError(
      `Invalid JSON in ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const review = parseReview(value);
  const documents = [
    review.platformEvidence,
    review.reviews.licences,
    review.reviews.volumes,
    review.reviews.security,
  ];
  await Promise.all(
    documents.map((document) => verifyDocument(document, readTextFile)),
  );
  return deepFreeze({
    ...review,
    platformsByMaterialId: Object.fromEntries(
      review.platformClaims.map((claim) => [claim.materialId, claim.platforms]),
    ),
    reviewEvidence: {
      licences: review.reviews.licences.fingerprint,
      volumes: review.reviews.volumes.fingerprint,
      security: review.reviews.security.fingerprint,
    },
  });
}

function parseReview(value: unknown): BehaveFoundationCandidateReview {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "pack",
      "scope",
      "productionEligible",
      "platformClaims",
      "platformEvidence",
      "reviews",
    ],
    "$review",
  );
  literalValue(
    root.schemaVersion,
    BEHAVE_FOUNDATION_REVIEW_SCHEMA_VERSION,
    "$review.schemaVersion",
  );
  literalValue(root.scope, "local-developer-candidate", "$review.scope");
  literalValue(root.productionEligible, false, "$review.productionEligible");
  const pack = exactRecord(root.pack, ["id", "version"], "$review.pack");
  literalValue(pack.id, "casys.behave-foundation", "$review.pack.id");
  literalValue(pack.version, "0.1.0", "$review.pack.version");
  const platformClaims = nonEmptyArray(
    root.platformClaims,
    "$review.platformClaims",
  ).map((claim, index) => {
    const path = `$review.platformClaims[${index}]`;
    const entry = exactRecord(claim, ["materialId", "platforms"], path);
    const platforms = nonEmptyArray(entry.platforms, `${path}.platforms`).map(
      (platform, platformIndex) =>
        runtimePlatform(platform, `${path}.platforms[${platformIndex}]`),
    );
    rejectDuplicates(platforms, `${path}.platforms`);
    return deepFreeze({
      materialId: safeId(entry.materialId, `${path}.materialId`),
      platforms,
    });
  });
  rejectDuplicates(
    platformClaims.map((claim) => claim.materialId),
    "$review.platformClaims[].materialId",
  );
  const reviews = exactRecord(
    root.reviews,
    ["licences", "volumes", "security"],
    "$review.reviews",
  );
  return deepFreeze({
    schemaVersion: BEHAVE_FOUNDATION_REVIEW_SCHEMA_VERSION,
    pack: { id: "casys.behave-foundation", version: "0.1.0" },
    scope: "local-developer-candidate",
    productionEligible: false,
    platformClaims,
    platformEvidence: reviewDocument(
      root.platformEvidence,
      "$review.platformEvidence",
    ),
    reviews: {
      licences: reviewDocument(reviews.licences, "$review.reviews.licences"),
      volumes: reviewDocument(reviews.volumes, "$review.reviews.volumes"),
      security: reviewDocument(reviews.security, "$review.reviews.security"),
    },
  });
}

function reviewDocument(value: unknown, path: string): BehaveFoundationReviewDocument {
  const root = exactRecord(value, ["path", "fingerprint"], path);
  return deepFreeze({
    path: repositoryReviewPath(root.path, `${path}.path`),
    fingerprint: fingerprint(root.fingerprint, `${path}.fingerprint`),
  });
}

function repositoryReviewPath(value: unknown, path: string): string {
  if (
    typeof value !== "string" || !value.startsWith("docs/") ||
    value.includes("..") || value.includes("\\") || value.includes("\0") ||
    value !== value.trim()
  ) {
    throw new TypeError(`${path} must be a repository-relative docs/ path.`);
  }
  return value;
}

function runtimePlatform(value: unknown, path: string): RuntimePlatform {
  if (value !== "linux/amd64" && value !== "linux/arm64") {
    throw new TypeError(`${path} must be linux/amd64 or linux/arm64.`);
  }
  return value;
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  if (typeof root.digest !== "string" || !SHA256_HEX.test(root.digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return deepFreeze({ algorithm: "sha256", digest: root.digest });
}

async function verifyDocument(
  document: BehaveFoundationReviewDocument,
  readTextFile: (path: string) => Promise<string>,
): Promise<void> {
  const source = await readTextFile(document.path);
  const actual = await fingerprintResourceBytes(new TextEncoder().encode(source));
  if (actual !== document.fingerprint.digest) {
    throw new TypeError(
      `${document.path} no longer matches its reviewed SHA-256 fingerprint.`,
    );
  }
}
