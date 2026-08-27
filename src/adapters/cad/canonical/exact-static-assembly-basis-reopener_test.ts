import { assertEquals, assertRejects } from "@std/assert";
import {
  ExactStaticAssemblyBasisReopener,
  ExactStaticAssemblyBasisResolutionError,
} from "./exact-static-assembly-basis-reopener.ts";
import type { ExactStaticAssemblyBasisRequest } from "../../../application/ports/out/cad/exact-static-assembly-basis-resolver.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function fingerprint(digest: string) {
  return { algorithm: "sha256" as const, digest };
}

function geometryModule(digest = DIGEST_A) {
  return {
    schemaVersion: "geometry-module-capture/1.0" as const,
    artifactId: `geometry-${digest}`,
    fingerprint: fingerprint(digest),
  };
}

function snapshot(overrides: Record<string, unknown> = {}): ThreadSnapshot {
  return {
    id: "snap-1",
    revision: 1,
    subject: { id: "subject-1" },
    artifacts: [{
      id: `geometry-${DIGEST_A}`,
      fingerprint: fingerprint(DIGEST_A),
    }],
    changeSet: { changes: [] },
    ...overrides,
  } as unknown as ThreadSnapshot;
}

function request(
  overrides: Record<string, unknown> = {},
): ExactStaticAssemblyBasisRequest {
  return {
    basis: { snapshotId: "snap-1", revision: 1, subjectId: "subject-1" },
    snapshot: snapshot(),
    geometryModule: geometryModule(),
    ...overrides,
  } as ExactStaticAssemblyBasisRequest;
}

function reopener(options: {
  readonly captureText?: string | undefined;
} = {}) {
  return new ExactStaticAssemblyBasisReopener({
    geometryCaptures: {
      read() {
        return Promise.resolve(options.captureText);
      },
    },
    stepAssets: {
      read() {
        return Promise.reject(new Error("assembly STEP must not be read"));
      },
    },
  });
}

async function rejectedCode(
  work: () => Promise<unknown>,
  code: ExactStaticAssemblyBasisResolutionError["code"],
): Promise<void> {
  const error = await assertRejects(work, ExactStaticAssemblyBasisResolutionError);
  assertEquals(error.code, code);
}

Deno.test("exact static assembly basis refuses a snapshot that lacks identity fields", async () => {
  await rejectedCode(
    () => reopener().resolve(request({ snapshot: { id: "snap-1", revision: 1 } })),
    "basis-mismatch",
  );
  await rejectedCode(
    () => reopener().resolve(request({ snapshot: [] })),
    "basis-mismatch",
  );
});

Deno.test("exact static assembly basis refuses a Thread identity that does not recross", async () => {
  await rejectedCode(
    () =>
      reopener().resolve(request({
        basis: { snapshotId: "snap-other", revision: 1, subjectId: "subject-1" },
      })),
    "basis-mismatch",
  );
});

Deno.test("exact static assembly basis fails closed on absent, archived, or fingerprint-divergent primaries", async () => {
  await rejectedCode(
    () => reopener().resolve(request({ snapshot: snapshot({ artifacts: [] }) })),
    "missing-evidence",
  );
  await rejectedCode(
    () =>
      reopener().resolve(request({
        snapshot: snapshot({
          changeSet: {
            changes: [{
              kind: "archived",
              target: { kind: "artifact", id: `geometry-${DIGEST_A}` },
            }],
          },
        }),
      })),
    "archived-evidence",
  );
  await rejectedCode(
    () =>
      reopener().resolve(request({
        snapshot: snapshot({
          artifacts: [{
            id: `geometry-${DIGEST_A}`,
            fingerprint: fingerprint(DIGEST_B),
          }],
        }),
      })),
    "identity-mismatch",
  );
});

Deno.test("exact static assembly basis does not treat a part capture schema as a module identity", async () => {
  await assertRejects(
    () =>
      reopener().resolve(request({
        geometryModule: {
          schemaVersion: "geometry-part-capture/1.0",
          artifactId: `geometry-${DIGEST_A}`,
          fingerprint: fingerprint(DIGEST_A),
        },
      })),
    TypeError,
    'schemaVersion must equal "geometry-module-capture/1.0"',
  );
});
