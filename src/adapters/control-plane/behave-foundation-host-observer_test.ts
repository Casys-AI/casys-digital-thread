import { assertEquals } from "@std/assert";
import { createLocalCalculixIsolatedExecutionServerOptions } from "../fea/isolated-v3/local-calculix-isolated-execution-options.ts";
import { loadWorkspaceBehaveFoundationCensus } from "./behave-foundation-census.ts";
import { observeBehaveFoundationHost } from "./behave-foundation-host-observer.ts";
import { diagnoseBehaveFoundation } from "../../application/control-plane/diagnose-behave-foundation.ts";

Deno.test("host observer distinguishes Docker images from an absent microVM cache entry", async () => {
  const calculix = await createLocalCalculixIsolatedExecutionServerOptions();
  const census = await loadWorkspaceBehaveFoundationCensus({
    calculix: {
      imageReference: calculix.profile.imageReference,
      policyFingerprint: calculix.profile.policy.fingerprint,
    },
  });
  const observed = await observeBehaveFoundationHost(census, {
    platform: "linux/arm64",
    runDocker: (args) =>
      Promise.resolve({
        success: true,
        stdout: args[0] === "compose"
          ? "5.3.1\n"
          : args[0] === "version"
          ? "28.0.0\n"
          : JSON.stringify({
            RepoDigests: [args.at(-1)!],
            Os: "linux",
            Architecture: "arm64",
            Size: 123,
          }),
        stderr: "",
      }),
    inspectMicrosandboxImage: () => Promise.resolve(undefined),
  });

  assertEquals(observed.mutatesRuntime, false);
  assertEquals(observed.blockers, []);
  assertEquals(observed.prerequisites.map((item) => item.status), [
    "available",
    "available",
  ]);
  assertEquals(observed.images.length, 4);
  assertEquals(observed.cachedExactMaterialIds, [
    "syson-db",
    "syson-app",
    "mcp-syson",
    "mcp-build123d-sandbox",
  ]);
  assertEquals(
    observed.materialObservations.map((observation) => observation.status),
    ["cached-exact", "cached-exact", "cached-exact", "cached-exact", "unavailable"],
  );
  assertEquals(
    observed.images.some((image) =>
      image.reference === calculix.profile.imageReference
    ),
    false,
  );
  assertEquals(
    observed.materialObservations[0]?.matchedRepoDigest,
    census.materials[0]?.image,
  );
});

Deno.test("host observer reports the RepoDigest actually matched among aliases", async () => {
  const calculix = await createLocalCalculixIsolatedExecutionServerOptions();
  const census = await loadWorkspaceBehaveFoundationCensus({
    calculix: {
      imageReference: calculix.profile.imageReference,
      policyFingerprint: calculix.profile.policy.fingerprint,
    },
  });
  const observed = await observeBehaveFoundationHost(census, {
    platform: "linux/arm64",
    runDocker: (args) =>
      Promise.resolve({
        ...dockerResult(args),
        stdout: args[0] === "image"
          ? JSON.stringify({
            RepoDigests: [
              "docker.io/library/alias@sha256:" + "a".repeat(64),
              args.at(-1)!,
            ],
            Os: "linux",
            Architecture: "arm64",
          })
          : dockerResult(args).stdout,
      }),
    inspectMicrosandboxImage: () => Promise.resolve(undefined),
  });

  assertEquals(
    observed.materialObservations[0]?.matchedRepoDigest,
    census.materials[0]?.image,
  );
});

Deno.test("host observer retains labels from an exact dedicated SysON image", async () => {
  const calculix = await createLocalCalculixIsolatedExecutionServerOptions();
  const census = await loadWorkspaceBehaveFoundationCensus({
    calculix: {
      imageReference: calculix.profile.imageReference,
      policyFingerprint: calculix.profile.policy.fingerprint,
    },
  });
  const observed = await observeBehaveFoundationHost(census, {
    platform: "linux/arm64",
    runDocker: (args) =>
      Promise.resolve({
        ...dockerResult(args),
        stdout: args[0] === "image"
          ? JSON.stringify({
            RepoDigests: [args.at(-1)!],
            Os: "linux",
            Architecture: "arm64",
            Config: {
              Labels: String(args.at(-1)).startsWith("ghcr.io/casys-ai/mcp-syson")
                ? {
                  "org.opencontainers.image.source":
                    "https://github.com/Casys-AI/mcp-syson",
                  "org.opencontainers.image.revision":
                    "cf22348d1f91ba7329e0dbc04db814bca32ff17e",
                  "org.opencontainers.image.version": "0.8.3",
                }
                : {},
            },
          })
          : dockerResult(args).stdout,
      }),
    inspectMicrosandboxImage: () => Promise.resolve(undefined),
  });

  assertEquals(
    observed.materialObservations.find((entry) => entry.materialId === "mcp-syson")
      ?.labels,
    {
      "org.opencontainers.image.revision": "cf22348d1f91ba7329e0dbc04db814bca32ff17e",
      "org.opencontainers.image.source": "https://github.com/Casys-AI/mcp-syson",
      "org.opencontainers.image.version": "0.8.3",
    },
  );
});

Deno.test("doctor reports cached-exact without promoting it to a vertical qualification", async () => {
  const calculix = await createLocalCalculixIsolatedExecutionServerOptions();
  const census = await loadWorkspaceBehaveFoundationCensus({
    calculix: {
      imageReference: calculix.profile.imageReference,
      policyFingerprint: calculix.profile.policy.fingerprint,
    },
  });
  const host = await observeBehaveFoundationHost(census, {
    platform: "linux/arm64",
    runDocker: (args) => Promise.resolve(dockerResult(args)),
    inspectMicrosandboxImage: (reference) =>
      Promise.resolve({
        reference,
        manifestDigest: reference.slice(reference.lastIndexOf("@sha256:") + 1),
        architecture: "arm64",
        os: "linux",
        user: null,
        entrypoint: null,
        command: null,
        environment: {},
        labels: {},
      }),
  });
  const report = diagnoseBehaveFoundation(census, host);

  assertEquals(report.status, "ready");
  assertEquals(report.evidenceLevel, "cached-exact");
  assertEquals(report.verticalQualification, "not-observed");
});

Deno.test("doctor rejects a same-length cache list with a duplicate and missing material", async () => {
  const calculix = await createLocalCalculixIsolatedExecutionServerOptions();
  const census = await loadWorkspaceBehaveFoundationCensus({
    calculix: {
      imageReference: calculix.profile.imageReference,
      policyFingerprint: calculix.profile.policy.fingerprint,
    },
  });
  const fullHost = await observeBehaveFoundationHost(census, {
    platform: "linux/arm64",
    runDocker: (args) => Promise.resolve(dockerResult(args)),
    inspectMicrosandboxImage: (reference) =>
      Promise.resolve({
        reference,
        manifestDigest: reference.slice(reference.lastIndexOf("@sha256:") + 1),
        architecture: "arm64",
        os: "linux",
        user: null,
        entrypoint: null,
        command: null,
        environment: {},
        labels: {},
      }),
  });
  const malformedHost = {
    ...fullHost,
    cachedExactMaterialIds: [
      fullHost.cachedExactMaterialIds[0]!,
      ...fullHost.cachedExactMaterialIds.slice(1, -1),
      fullHost.cachedExactMaterialIds[0]!,
    ],
  };
  const report = diagnoseBehaveFoundation(census, malformedHost);

  assertEquals(
    malformedHost.cachedExactMaterialIds.length,
    census.materials.length,
  );
  assertEquals(report.status, "ready");
  assertEquals(report.evidenceLevel, "declared");
});

Deno.test("host observer excludes an OCI cache entry with another digest", async () => {
  const calculix = await createLocalCalculixIsolatedExecutionServerOptions();
  const census = await loadWorkspaceBehaveFoundationCensus({
    calculix: {
      imageReference: calculix.profile.imageReference,
      policyFingerprint: calculix.profile.policy.fingerprint,
    },
  });
  const observed = await observeBehaveFoundationHost(census, {
    platform: "linux/arm64",
    runDocker: (args) =>
      Promise.resolve({
        ...dockerResult(args),
        stdout: args[0] === "image"
          ? JSON.stringify({
            RepoDigests: ["ghcr.io/casys-ai/other@sha256:" + "a".repeat(64)],
            Os: "linux",
            Architecture: "arm64",
          })
          : dockerResult(args).stdout,
      }),
    inspectMicrosandboxImage: () => Promise.resolve(undefined),
  });

  assertEquals(observed.cachedExactMaterialIds, []);
  assertEquals(
    observed.materialObservations.filter((observation) =>
      observation.materialId !== "calculix-worker"
    )
      .every((observation) => observation.status === "mismatch"),
    true,
  );
});

function dockerResult(args: readonly string[]) {
  return {
    success: true,
    stdout: args[0] === "compose"
      ? "5.3.1\n"
      : args[0] === "version"
      ? "28.0.0\n"
      : JSON.stringify({
        RepoDigests: [args.at(-1)!],
        Os: "linux",
        Architecture: "arm64",
        Size: 123,
      }),
    stderr: "",
  };
}
