import { assertEquals, assertRejects } from "@std/assert";
import { fingerprintResourceBytes } from "../../domain/kernel/resource-bytes.ts";
import { loadBehaveFoundationCandidateReview } from "./behave-foundation-review.ts";

const REVIEW_PATH = "config/capability-packs/test.review.json";
const PLATFORM_PATH = "docs/test/platforms.md";
const LICENCES_PATH = "docs/test/licences.md";
const VOLUMES_PATH = "docs/test/volumes.md";
const SECURITY_PATH = "docs/test/security.md";

Deno.test("candidate review verifies exact documents and projects platform claims", async () => {
  const files = await reviewFiles();
  const review = await loadBehaveFoundationCandidateReview({
    path: REVIEW_PATH,
    readTextFile: readFrom(files),
  });

  assertEquals(review.productionEligible, false);
  assertEquals(review.platformsByMaterialId, {
    "syson-db": ["linux/arm64"],
    "calculix-worker": ["linux/arm64"],
  });
  assertEquals(
    review.reviewEvidence.security,
    JSON.parse(files.get(REVIEW_PATH)!).reviews.security.fingerprint,
  );
});

Deno.test("candidate review rejects stale document evidence", async () => {
  const files = await reviewFiles();
  files.set(SECURITY_PATH, "changed\n");

  await assertRejects(
    () =>
      loadBehaveFoundationCandidateReview({
        path: REVIEW_PATH,
        readTextFile: readFrom(files),
      }),
    TypeError,
    "no longer matches its reviewed SHA-256 fingerprint",
  );
});

async function reviewFiles(): Promise<Map<string, string>> {
  const files = new Map([
    [PLATFORM_PATH, "platform evidence\n"],
    [LICENCES_PATH, "licence review\n"],
    [VOLUMES_PATH, "volume review\n"],
    [SECURITY_PATH, "security review\n"],
  ]);
  const document = async (path: string) => ({
    path,
    fingerprint: {
      algorithm: "sha256",
      digest: await fingerprintResourceBytes(
        new TextEncoder().encode(files.get(path)!),
      ),
    },
  });
  files.set(
    REVIEW_PATH,
    JSON.stringify({
      schemaVersion: "behave-foundation-candidate-review/0.1",
      pack: { id: "casys.behave-foundation", version: "0.1.0" },
      scope: "local-developer-candidate",
      productionEligible: false,
      platformClaims: [
        { materialId: "syson-db", platforms: ["linux/arm64"] },
        { materialId: "calculix-worker", platforms: ["linux/arm64"] },
      ],
      platformEvidence: await document(PLATFORM_PATH),
      reviews: {
        licences: await document(LICENCES_PATH),
        volumes: await document(VOLUMES_PATH),
        security: await document(SECURITY_PATH),
      },
    }),
  );
  return files;
}

function readFrom(files: ReadonlyMap<string, string>) {
  return (path: string): Promise<string> => {
    const source = files.get(path);
    if (source === undefined) throw new Deno.errors.NotFound(path);
    return Promise.resolve(source);
  };
}
