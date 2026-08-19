import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  BUILD123D_EXECUTION_PROFILE,
} from "../../../domain/cad/isolated/build123d-execution-proposal.ts";
import {
  createMicrosandboxRuntimeAttestation,
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import {
  INITIAL_QUALIFIED_BUILD123D_MAX_SOURCE_BYTES,
} from "../../compile/captures/initial-technical-source-analysis-composition.ts";
import {
  INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG,
} from "../../compile/admission/fixed-technical-compilation-profile-catalog-provider.ts";
import {
  Build123dExecutionProfileNotRegisteredError,
  FixedBuild123dExecutionProfileCatalog,
  MICROSANDBOX_BUILD123D_OUTPUT_MANIFEST,
  validateBuild123dExecutionProfile,
} from "./fixed-build123d-execution-profile-catalog.ts";
import { OCCT_STEP_OUTPUT_VALIDATOR_REF } from "./occt-step-output-validator.ts";

const IMAGE_SHA256 = "1".repeat(64);
const IMAGE_REFERENCE = `ghcr.io/casys-ai/build123d-runtime@sha256:${IMAGE_SHA256}`;

Deno.test("fixed Build123d execution profile joins every code-owned contract", async () => {
  const catalog = new FixedBuild123dExecutionProfileCatalog(await options());
  const profile = await catalog.initial();
  const resolved = await catalog.resolve(BUILD123D_EXECUTION_PROFILE);
  const { profileFingerprint: _profileFingerprint, ...fingerprintBody } = profile;

  assertStrictEquals(profile, resolved);
  assertEquals(profile.executionProfile, BUILD123D_EXECUTION_PROFILE);
  assertEquals(profile.compilationTarget, "build123d-source");
  assertEquals(
    profile.compilationProfile,
    INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG.profiles[0],
  );
  assertEquals(
    profile.compilationProfileFingerprint,
    await sha256Fingerprint(profile.compilationProfile),
  );
  assertEquals(profile.runtimeBackend, {
    ...MICROSANDBOX_LOCAL_RUNTIME_REF,
    imageReference: IMAGE_REFERENCE,
    imageDigest: { algorithm: "sha256", digest: IMAGE_SHA256 },
  });
  assertEquals(
    profile.runtime,
    createMicrosandboxRuntimeAttestation({
      imageReference: IMAGE_REFERENCE,
      limits: limits(),
    }),
  );
  assertEquals(
    profile.outputManifest,
    MICROSANDBOX_BUILD123D_OUTPUT_MANIFEST,
  );
  assertEquals(profile.outputValidator, OCCT_STEP_OUTPUT_VALIDATOR_REF);
  assertEquals(
    profile.maximumSourceBytes,
    INITIAL_QUALIFIED_BUILD123D_MAX_SOURCE_BYTES,
  );
  assertEquals(profile.minimumDestructionAssurance, "proven");
  assertEquals(profile.profileFingerprint, await sha256Fingerprint(fingerprintBody));
  assertDeeplyFrozen(profile);
});

Deno.test("fixed catalogue resolves only the exact id and version without fallback", async () => {
  const catalog = new FixedBuild123dExecutionProfileCatalog(await options());

  await assertRejects(
    () =>
      catalog.resolve({
        id: BUILD123D_EXECUTION_PROFILE.id,
        version: "1.0.1",
      }),
    Build123dExecutionProfileNotRegisteredError,
  );
  await assertRejects(
    () => catalog.resolve({ id: "build123d-other", version: "1.0.0" }),
    Build123dExecutionProfileNotRegisteredError,
  );
  assertThrows(
    () => Reflect.apply(catalog.initial, catalog, [{}]),
    TypeError,
    "does not accept caller input",
  );
});

Deno.test("profile fingerprints are deterministic and expose every deployment drift", async () => {
  const first = await new FixedBuild123dExecutionProfileCatalog(await options())
    .initial();
  const second = await new FixedBuild123dExecutionProfileCatalog(await options())
    .initial();
  assertEquals(first, second);

  const imageDrift = await new FixedBuild123dExecutionProfileCatalog({
    ...await options(),
    imageReference: `ghcr.io/casys-ai/build123d-runtime@sha256:${"2".repeat(64)}`,
  }).initial();
  assertNotEquals(imageDrift.profileFingerprint, first.profileFingerprint);

  const policyDrift = await new FixedBuild123dExecutionProfileCatalog({
    ...await options(),
    policy: {
      id: "isolation.build123d-closed-v1",
      version: "1.0.1",
      fingerprint: await sha256Fingerprint({
        id: "isolation.build123d-closed-v1",
        version: "1.0.1",
        network: "deny-all",
      }),
    },
  }).initial();
  assertNotEquals(policyDrift.profileFingerprint, first.profileFingerprint);

  const limitDrift = await new FixedBuild123dExecutionProfileCatalog({
    ...await options(),
    limits: { ...limits(), maxCpuTimeMs: limits().maxCpuTimeMs + 1_000 },
  }).initial();
  assertNotEquals(limitDrift.profileFingerprint, first.profileFingerprint);
});

Deno.test("fixed profile runtime exactly matches the code-owned local Microsandbox contract", async () => {
  const raw = await options();
  const profile = await new FixedBuild123dExecutionProfileCatalog(raw).initial();

  assertEquals(
    profile.runtime,
    createMicrosandboxRuntimeAttestation({
      imageReference: raw.imageReference,
      limits: raw.limits,
    }),
  );
  assertEquals(profile.runtimeBackend, {
    ...MICROSANDBOX_LOCAL_RUNTIME_REF,
    imageReference: raw.imageReference,
    imageDigest: profile.runtime.imageDigest,
  });
  assertEquals(
    profile.runtime.isolationClass,
    MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  );
  assertEquals(profile.runtimeBackend.imageDigest, profile.runtime.imageDigest);
});

Deno.test("profile replay rejects structural, compilation, runtime and hash drift", async () => {
  const profile = await new FixedBuild123dExecutionProfileCatalog(await options())
    .initial();

  const foreignField = structuredClone(profile) as unknown as Record<string, unknown>;
  foreignField.provider = "caller-selected";
  await assertRejects(
    () => validateBuild123dExecutionProfile(foreignField),
    TypeError,
    "unsupported field provider",
  );

  const compilationDrift = structuredClone(profile);
  (compilationDrift.compilationProfile as { analysisPolicyProfile: string })
    .analysisPolicyProfile = "build123d-other";
  await assertRejects(
    () => validateBuild123dExecutionProfile(compilationDrift),
    TypeError,
    "compilationProfile does not match",
  );

  const assuranceDrift = structuredClone(profile);
  (assuranceDrift.runtime.limitAssurance as { maxCpuTimeMs: string })
    .maxCpuTimeMs = "backend-attested";
  await assertRejects(
    () => validateBuild123dExecutionProfile(assuranceDrift),
    TypeError,
    "runtime does not match",
  );

  const staleHash = structuredClone(profile);
  (staleHash.runtime.requestedLimits as { maxWallTimeMs: number })
    .maxWallTimeMs += 1_000;
  await assertRejects(
    () => validateBuild123dExecutionProfile(staleHash),
    TypeError,
    "profileFingerprint does not match",
  );

  const validatorDrift = structuredClone(profile);
  (validatorDrift.outputValidator as { version: string }).version = "1.0.1";
  const {
    profileFingerprint: _oldProfileFingerprint,
    ...validatorDriftBody
  } = validatorDrift;
  const validatorDriftFingerprint = await sha256Fingerprint(validatorDriftBody);
  await assertRejects(
    () =>
      validateBuild123dExecutionProfile({
        ...validatorDriftBody,
        profileFingerprint: validatorDriftFingerprint,
      }),
    TypeError,
    "outputValidator does not match",
  );

  const backendIdentityDrift = structuredClone(profile);
  (backendIdentityDrift.runtimeBackend as { network: string }).network = "bridge";
  await assertRejects(
    () => validateBuild123dExecutionProfile(backendIdentityDrift),
    TypeError,
    "runtimeBackend.network",
  );
});

Deno.test("catalogue rejects mutable, path-like and malformed OCI image references", async () => {
  const raw = await options();
  const invalidReferences = [
    `../build123d@sha256:${IMAGE_SHA256}`,
    `./build123d@sha256:${IMAGE_SHA256}`,
    `/build123d@sha256:${IMAGE_SHA256}`,
    `file:///tmp/build123d@sha256:${IMAGE_SHA256}`,
    `https://ghcr.io/casys-ai/build123d@sha256:${IMAGE_SHA256}`,
    `ghcr.io\\casys-ai\\build123d@sha256:${IMAGE_SHA256}`,
    `ghcr.io/Casys-AI/build123d@sha256:${IMAGE_SHA256}`,
    `ghcr.io/casys-ai/build123d:latest@sha256:${IMAGE_SHA256}`,
    `ghcr.io/casys-ai/build123d@sha256:${"A".repeat(64)}`,
    `ghcr.io:70000/casys-ai/build123d@sha256:${IMAGE_SHA256}`,
    "ghcr.io/casys-ai/build123d:latest",
  ];
  for (const imageReference of invalidReferences) {
    assertThrows(
      () =>
        new FixedBuild123dExecutionProfileCatalog({
          ...raw,
          imageReference,
        }),
      TypeError,
      "pinned",
    );
  }
});

Deno.test("catalogue options reject legacy handles and caller-selected runtime fields", async () => {
  const raw = await options();
  const forbiddenOptions = {
    sdk: "caller-capability",
    rootSnapshotId: "legacy-root",
    rootSnapshotSha256: IMAGE_SHA256,
    controlPlane: "http://localhost:9000",
    credentials: { token: "caller-secret" },
    provider: "caller-selected",
    runtimeBackend: "caller-selected",
    runtime: "caller-selected",
    isolationClass: "caller-selected",
    imageDigest: { algorithm: "sha256", digest: IMAGE_SHA256 },
    lifecycle: "detached",
    network: "bridge",
    command: ["caller-selected"],
  } as const;
  for (const [field, value] of Object.entries(forbiddenOptions)) {
    assertThrows(
      () =>
        new FixedBuild123dExecutionProfileCatalog(
          {
            ...raw,
            [field]: value,
          } as unknown as ConstructorParameters<
            typeof FixedBuild123dExecutionProfileCatalog
          >[0],
        ),
      TypeError,
      `unsupported field ${field}`,
    );
  }

  assertThrows(
    () =>
      new FixedBuild123dExecutionProfileCatalog({
        ...raw,
        limits: { ...raw.limits, maxProcesses: 0 },
      }),
    TypeError,
    "positive integer",
  );
  assertThrows(
    () =>
      new FixedBuild123dExecutionProfileCatalog({
        ...raw,
        limits: { ...raw.limits, maxMemoryBytes: raw.limits.maxMemoryBytes + 1 },
      }),
    TypeError,
    "whole MiB",
  );

  const profile = await new FixedBuild123dExecutionProfileCatalog(raw).initial();
  const keys = recursiveKeys(profile);
  for (
    const forbidden of [
      "provider",
      "tool",
      "operation",
      "arguments",
      "endpoint",
      "credential",
      "token",
      "secret",
      "sdk",
      "rootSnapshotId",
      "rootSnapshotSha256",
      "controlPlane",
      "command",
      "path",
    ]
  ) {
    assertEquals(
      keys.has(forbidden),
      false,
      `unexpected capability field ${forbidden}`,
    );
  }
});

async function options() {
  return {
    imageReference: IMAGE_REFERENCE,
    policy: {
      id: "isolation.build123d-closed-v1",
      version: "1.0.0",
      fingerprint: await sha256Fingerprint({
        id: "isolation.build123d-closed-v1",
        version: "1.0.0",
        network: "deny-all",
      }),
    },
    limits: limits(),
  } as const;
}

function limits() {
  return {
    maxWallTimeMs: 30_000,
    maxCpuTimeMs: 20_000,
    maxMemoryBytes: 1_073_741_824,
    maxProcesses: 32,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
    maxOutputFileBytes: 33_554_432,
    maxOutputTotalBytes: 33_554_432,
  };
}

function recursiveKeys(value: unknown, seen = new Set<unknown>()): Set<string> {
  const keys = new Set<string>();
  if (value === null || typeof value !== "object" || seen.has(value)) return keys;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    for (const nested of recursiveKeys(child, seen)) keys.add(nested);
  }
  return keys;
}

function assertDeeplyFrozen(value: unknown, seen = new Set<unknown>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assertEquals(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeeplyFrozen(child, seen);
}
