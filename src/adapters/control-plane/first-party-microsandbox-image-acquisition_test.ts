import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { MicrosandboxImageInspection } from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import {
  acquireFirstPartyMicrosandboxImage,
  assertAllowedFirstPartyBootstrapTempPath,
  assertExactDockerSourceImage,
  assertNoCallerSelectedFirstPartyBootstrapArguments,
  type FirstPartyMicrosandboxImageAcquisitionPorts,
  parseDockerSourceInspection,
} from "./first-party-microsandbox-image-acquisition.ts";
import {
  createFirstPartyMicrosandboxImageBootstrapDescriptors,
  FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID,
  type FirstPartyMicrosandboxImageBootstrapDescriptor,
  type FirstPartyOciDigestSource,
} from "./first-party-microsandbox-image-bootstrap.ts";

class CachedImageAbsentError extends Error {
  constructor() {
    super("cached image absent");
    this.name = "CachedImageAbsentError";
  }
}

Deno.test("exact Microsandbox cache hit does no Docker build or import", async () => {
  const descriptor = await descriptorById(FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID);
  const ports = fakePorts({ cached: runtimeInspection(descriptor) });
  const result = await acquireFirstPartyMicrosandboxImage({ descriptor, ports });
  assertEquals(result.status, "already-cached");
  assertEquals(result.builtDockerSource, false);
  assertEquals(result.pullPolicy, "never");
  assertEquals(ports.inspectReferences, [descriptor.targetImageReference]);
  assertEquals(ports.dockerInspects, []);
  assertEquals(ports.builds, []);
  assertEquals(ports.pulls, []);
  assertEquals(ports.saves, []);
  assertEquals(ports.loads, []);
  assertEquals(ports.tempCreated, 0);
  assertEquals(ports.cleaned, 0);
  assertEquals(ports.removes, []);
  assertEquals(ports.exactCachedImageRemoves, []);
});

Deno.test("cache miss builds, inspects, saves, loads, then inspects the exact target", async () => {
  const descriptor = await descriptorById(FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID);
  if (descriptor.source.kind !== "trusted-dockerfile") {
    throw new Error("ngspice bootstrap must be a trusted Dockerfile");
  }
  const ports = fakePorts({ cached: undefined });
  const result = await acquireFirstPartyMicrosandboxImage({ descriptor, ports });
  assertEquals(result.status, "imported");
  assertEquals(result.builtDockerSource, true);
  assertEquals(ports.inspectReferences, [
    descriptor.targetImageReference,
    descriptor.targetImageReference,
  ]);
  assertEquals(ports.dockerInspects, [
    descriptor.source.dockerSourceReference,
    descriptor.source.dockerImageName,
    descriptor.source.dockerImageName,
  ]);
  assertEquals(ports.builds, [{
    dockerfile: ports.builds[0]?.dockerfile,
    context: ports.builds[0]?.context,
    platform: "linux/arm64",
    tag: descriptor.source.dockerImageName,
  }]);
  assertEquals(
    ports.builds[0]?.dockerfile.endsWith(
      "images/ngspice-microsandbox-worker/Dockerfile",
    ),
    true,
  );
  assertEquals(ports.pulls, []);
  assertEquals(ports.saves, [descriptor.source.dockerImageName]);
  assertEquals(ports.loads, [{
    archivePath: "/tmp/casys-first-party-microsandbox-cache-test/worker.tar",
    tag: descriptor.targetImageReference,
  }]);
  assertEquals(ports.tempCreated, 1);
  assertEquals(ports.cleaned, 1);
  assertEquals(ports.removes, [descriptor.source.dockerImageName]);
  assertEquals(ports.exactCachedImageRemoves, []);
});

Deno.test("present Docker source skips build and imports under the exact target", async () => {
  const descriptor = await descriptorById(FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID);
  if (descriptor.source.kind !== "trusted-dockerfile") {
    throw new Error("ngspice bootstrap must be a trusted Dockerfile");
  }
  const ports = fakePorts({
    cached: undefined,
    docker: dockerInspectJson(descriptor, descriptor.source.dockerSourceReference),
  });
  const result = await acquireFirstPartyMicrosandboxImage({ descriptor, ports });
  assertEquals(result.status, "imported");
  assertEquals(result.builtDockerSource, false);
  assertEquals(ports.builds, []);
  assertEquals(ports.saves, [descriptor.source.dockerSourceReference]);
  assertEquals(ports.loads[0]?.tag, descriptor.targetImageReference);
  assertEquals(ports.cleaned, 1);
  assertEquals(ports.removes, []);
  assertEquals(ports.exactCachedImageRemoves, []);
});

Deno.test("save failure still removes the temporary archive and the created Docker tag", async () => {
  const descriptor = await descriptorById(FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID);
  if (descriptor.source.kind !== "trusted-dockerfile") {
    throw new Error("ngspice bootstrap must be a trusted Dockerfile");
  }
  const ports = fakePorts({
    cached: undefined,
    saveError: new Error("docker image save failed"),
  });
  await assertRejects(
    () => acquireFirstPartyMicrosandboxImage({ descriptor, ports }),
    Error,
    "docker image save failed",
  );
  assertEquals(ports.tempCreated, 1);
  assertEquals(ports.cleaned, 1);
  assertEquals(ports.loads, []);
  assertEquals(ports.removes, [descriptor.source.dockerImageName]);
  assertEquals(ports.exactCachedImageRemoves, []);
});

Deno.test("cached image absence uses the port predicate, not an SDK error shape", async () => {
  const descriptor = await descriptorById(FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID);
  const ports = fakePorts({ cached: undefined });
  const result = await acquireFirstPartyMicrosandboxImage({ descriptor, ports });
  assertEquals(result.status, "imported");
  assertEquals(
    ports.inspectCachedErrors.every((error) =>
      error instanceof CachedImageAbsentError &&
      !("code" in error) &&
      error.name !== "ImageNotFoundError"
    ),
    true,
  );
});

Deno.test("cached image lookup does not swallow errors the port does not classify as absent", async () => {
  const descriptor = await descriptorById(FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID);
  const ports = fakePorts({
    cached: undefined,
    inspectError: new Error("disk full"),
  });
  await assertRejects(
    () => acquireFirstPartyMicrosandboxImage({ descriptor, ports }),
    Error,
    "disk full",
  );
  assertEquals(ports.builds, []);
  assertEquals(ports.removes, []);
  assertEquals(ports.exactCachedImageRemoves, []);
});

Deno.test("docker source mismatch fails before save and leaves no temp archive", async () => {
  const descriptor = await descriptorById(FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID);
  const ports = fakePorts({
    cached: undefined,
    docker: {
      ...dockerInspectJson(descriptor),
      Architecture: "amd64",
    },
  });
  await assertRejects(
    () => acquireFirstPartyMicrosandboxImage({ descriptor, ports }),
    Error,
    "reviewed first-party worker",
  );
  assertEquals(ports.saves, []);
  assertEquals(ports.loads, []);
  assertEquals(ports.tempCreated, 0);
  assertEquals(ports.cleaned, 0);
  assertEquals(ports.removes, []);
});

Deno.test("preexisting drifted cache fails closed without cached-image removal", async () => {
  const descriptor = await descriptorById(FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID);
  const ports = fakePorts({
    cached: {
      ...runtimeInspection(descriptor),
      architecture: "amd64",
    },
  });
  await assertRejects(
    () => acquireFirstPartyMicrosandboxImage({ descriptor, ports }),
    Error,
    "does not match the reviewed image",
  );
  assertEquals(ports.dockerInspects, []);
  assertEquals(ports.builds, []);
  assertEquals(ports.saves, []);
  assertEquals(ports.loads, []);
  assertEquals(ports.exactCachedImageRemoves, []);
});

Deno.test("wrong host architecture fails closed before Docker", async () => {
  const descriptor = await descriptorById(FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID);
  const ports = fakePorts({ cached: undefined, hostArchitecture: "amd64" });
  await assertRejects(
    () => acquireFirstPartyMicrosandboxImage({ descriptor, ports }),
    Error,
    "native linux/arm64",
  );
  assertEquals(ports.dockerInspects, []);
  assertEquals(ports.builds, []);
});

Deno.test("oci-digest source pulls by digest and never builds", async () => {
  const base = await descriptorById(FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID);
  const source: FirstPartyOciDigestSource = {
    kind: "oci-digest",
    reference: base.targetImageReference,
  };
  const descriptor: FirstPartyMicrosandboxImageBootstrapDescriptor = {
    ...base,
    source,
  };
  const ports = fakePorts({ cached: undefined });
  const result = await acquireFirstPartyMicrosandboxImage({ descriptor, ports });
  assertEquals(result.status, "imported");
  assertEquals(result.builtDockerSource, false);
  assertEquals(ports.pulls, [base.targetImageReference]);
  assertEquals(ports.builds, []);
  assertEquals(ports.saves, [base.targetImageReference]);
  assertEquals(ports.removes, []);
  assertEquals(ports.exactCachedImageRemoves, []);
});

Deno.test("post-import target mismatch removes exactly the imported cache image", async () => {
  const descriptor = await descriptorById(FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID);
  if (descriptor.source.kind !== "trusted-dockerfile") {
    throw new Error("ngspice bootstrap must be a trusted Dockerfile");
  }
  const ports = fakePorts({
    cached: undefined,
    imported: {
      ...runtimeInspection(descriptor),
      architecture: "amd64",
    },
  });
  await assertRejects(
    () => acquireFirstPartyMicrosandboxImage({ descriptor, ports }),
    Error,
    "does not match the reviewed image",
  );
  assertEquals(ports.loads, [{
    archivePath: "/tmp/casys-first-party-microsandbox-cache-test/worker.tar",
    tag: descriptor.targetImageReference,
  }]);
  assertEquals(ports.exactCachedImageRemoves, [descriptor.targetImageReference]);
  assertEquals(ports.removes, [descriptor.source.dockerImageName]);
});

Deno.test("load failure before a proven imported target does not remove a cached image", async () => {
  const descriptor = await descriptorById(FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID);
  const ports = fakePorts({
    cached: undefined,
    loadError: new Error("microsandbox load failed"),
  });
  await assertRejects(
    () => acquireFirstPartyMicrosandboxImage({ descriptor, ports }),
    Error,
    "microsandbox load failed",
  );
  assertEquals(ports.loads, []);
  assertEquals(ports.exactCachedImageRemoves, []);
  assertEquals(ports.saves.length, 1);
});

Deno.test("failed post-import quarantine exposes the inspection error and the removal error", async () => {
  const descriptor = await descriptorById(FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID);
  const ports = fakePorts({
    cached: undefined,
    imported: {
      ...runtimeInspection(descriptor),
      architecture: "amd64",
    },
    removeExactCachedImageError: new Error("image in use"),
  });
  const error = await assertRejects(
    () => acquireFirstPartyMicrosandboxImage({ descriptor, ports }),
    AggregateError,
    "exact cached-image quarantine also failed",
  );
  assertEquals(error.errors.length, 2);
  assertEquals(
    error.errors[0] instanceof Error &&
      error.errors[0].message.includes("does not match the reviewed image"),
    true,
  );
  assertEquals(
    error.errors[1] instanceof Error && error.errors[1].message === "image in use",
    true,
  );
  assertEquals(
    error.cause instanceof Error &&
      error.cause.message.includes("does not match the reviewed image"),
    true,
  );
  assertEquals(ports.exactCachedImageRemoves, [descriptor.targetImageReference]);
});

Deno.test("bootstrap operator refuses caller-selected arguments and temp paths", () => {
  assertNoCallerSelectedFirstPartyBootstrapArguments([]);
  assertThrows(
    () => assertNoCallerSelectedFirstPartyBootstrapArguments(["--image=caller"]),
    TypeError,
    "no caller-selected image, path, or arguments",
  );
  assertEquals(
    assertAllowedFirstPartyBootstrapTempPath("/tmp/casys-first-party-a"),
    "/tmp/casys-first-party-a",
  );
  assertThrows(
    () => assertAllowedFirstPartyBootstrapTempPath("/var/tmp/caller"),
    Error,
    "must stay under /tmp",
  );
});

Deno.test("docker inspect parser attests the pinned source digest when present", async () => {
  const descriptor = await descriptorById(FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID);
  if (descriptor.source.kind !== "trusted-dockerfile") {
    throw new Error("ngspice bootstrap must be a trusted Dockerfile");
  }
  const parsed = parseDockerSourceInspection(
    dockerInspectJson(descriptor, descriptor.source.dockerSourceReference),
  );
  assertExactDockerSourceImage(
    parsed,
    descriptor,
    descriptor.source.dockerSourceReference,
  );
  assertExactDockerSourceImage(
    parseDockerSourceInspection(
      dockerInspectJson(
        descriptor,
        `docker.io/${descriptor.source.dockerSourceReference}`,
      ),
    ),
    descriptor,
    descriptor.source.dockerSourceReference,
  );
});

interface FakePorts extends FirstPartyMicrosandboxImageAcquisitionPorts {
  readonly inspectReferences: string[];
  readonly inspectCachedErrors: unknown[];
  readonly dockerInspects: string[];
  readonly builds: Array<{
    readonly dockerfile: string;
    readonly context: string;
    readonly platform: string;
    readonly tag: string;
  }>;
  readonly pulls: string[];
  readonly saves: string[];
  readonly loads: Array<{ archivePath: string; tag: string }>;
  readonly removes: string[];
  readonly exactCachedImageRemoves: string[];
  tempCreated: number;
  cleaned: number;
}

function fakePorts(options: {
  readonly cached: MicrosandboxImageInspection | undefined;
  readonly imported?: MicrosandboxImageInspection;
  readonly docker?: unknown;
  readonly hostArchitecture?: string;
  readonly saveError?: Error;
  readonly inspectError?: Error;
  readonly loadError?: Error;
  readonly removeExactCachedImageError?: Error;
}): FakePorts {
  const inspectReferences: string[] = [];
  const inspectCachedErrors: unknown[] = [];
  const dockerInspects: string[] = [];
  const builds: FakePorts["builds"] = [];
  const pulls: string[] = [];
  const saves: string[] = [];
  const loads: FakePorts["loads"] = [];
  const removes: string[] = [];
  const exactCachedImageRemoves: string[] = [];
  const loaded = new Map<string, MicrosandboxImageInspection>();
  const ports: FakePorts = {
    hostArchitecture: options.hostArchitecture ?? "arm64",
    inspectReferences,
    inspectCachedErrors,
    dockerInspects,
    builds,
    pulls,
    saves,
    loads,
    removes,
    exactCachedImageRemoves,
    tempCreated: 0,
    cleaned: 0,
    inspectCachedImage(reference) {
      inspectReferences.push(reference);
      const loadedImage = loaded.get(reference);
      if (loadedImage) return Promise.resolve(loadedImage);
      if (options.cached !== undefined && options.cached.reference === reference) {
        return Promise.resolve(options.cached);
      }
      if (options.cached !== undefined && loads.length === 0) {
        return Promise.resolve(options.cached);
      }
      const error = options.inspectError ?? new CachedImageAbsentError();
      inspectCachedErrors.push(error);
      return Promise.reject(error);
    },
    isImageNotFound(error) {
      return error instanceof CachedImageAbsentError;
    },
    inspectDockerImage(reference) {
      dockerInspects.push(reference);
      if (options.docker !== undefined) return Promise.resolve(options.docker);
      if (builds.length === 0 && pulls.length === 0) return Promise.resolve(undefined);
      return Promise.resolve(dockerInspectJson(lastDescriptor, reference));
    },
    buildDockerImage(input) {
      builds.push(input);
      return Promise.resolve();
    },
    pullByDigest(reference) {
      pulls.push(reference);
      return Promise.resolve();
    },
    saveDockerImage(reference, archivePath) {
      if (options.saveError) return Promise.reject(options.saveError);
      saves.push(reference);
      assertEquals(archivePath.endsWith("/worker.tar"), true);
      return Promise.resolve();
    },
    loadImageFromArchive(archivePath, tag) {
      if (options.loadError) return Promise.reject(options.loadError);
      const inspection = options.imported ??
        inspectionsByTarget.get(tag) ??
        runtimeInspection(lastDescriptor);
      loaded.set(tag, inspection);
      loads.push({ archivePath, tag });
      return Promise.resolve();
    },
    removeExactCachedImage(reference) {
      exactCachedImageRemoves.push(reference);
      if (options.removeExactCachedImageError) {
        return Promise.reject(options.removeExactCachedImageError);
      }
      return Promise.resolve();
    },
    removeBuiltDockerImage(reference) {
      removes.push(reference);
      return Promise.resolve();
    },
    createTemporaryArchiveDirectory() {
      ports.tempCreated++;
      return Promise.resolve({
        directory: "/tmp/casys-first-party-microsandbox-cache-test",
        archivePath: "/tmp/casys-first-party-microsandbox-cache-test/worker.tar",
        cleanup: () => {
          ports.cleaned++;
          return Promise.resolve();
        },
      });
    },
  };
  return ports;
}

let lastDescriptor: FirstPartyMicrosandboxImageBootstrapDescriptor;
const inspectionsByTarget = new Map<string, MicrosandboxImageInspection>();

function rememberDescriptor(
  descriptor: FirstPartyMicrosandboxImageBootstrapDescriptor,
): void {
  lastDescriptor = descriptor;
  inspectionsByTarget.set(
    descriptor.targetImageReference,
    runtimeInspection(descriptor),
  );
}

async function descriptorById(
  recipeId: string,
): Promise<FirstPartyMicrosandboxImageBootstrapDescriptor> {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const descriptor = createFirstPartyMicrosandboxImageBootstrapDescriptors(catalog)
    .find((candidate) => candidate.recipeId === recipeId);
  if (!descriptor) throw new Error(`bootstrap descriptor ${recipeId} is absent`);
  rememberDescriptor(descriptor);
  return descriptor;
}

function runtimeInspection(
  descriptor: FirstPartyMicrosandboxImageBootstrapDescriptor,
): MicrosandboxImageInspection {
  return {
    reference: descriptor.target.reference,
    manifestDigest: descriptor.target.manifestDigest,
    os: descriptor.target.os,
    architecture: descriptor.target.architecture,
    user: descriptor.target.user,
    entrypoint: [...descriptor.target.entrypoint],
    command: null,
    environment: {},
    labels: {},
  };
}

function dockerInspectJson(
  descriptor: FirstPartyMicrosandboxImageBootstrapDescriptor,
  repoDigest = descriptor.source.kind === "trusted-dockerfile"
    ? descriptor.source.dockerSourceReference
    : descriptor.targetImageReference,
): Record<string, unknown> {
  return {
    RepoDigests: [repoDigest],
    Os: descriptor.buildRecipe.os,
    Architecture: descriptor.buildRecipe.architecture,
    Config: {
      User: descriptor.buildRecipe.user,
      Entrypoint: [...descriptor.buildRecipe.entrypoint],
      Labels: descriptor.buildRecipe.labels === undefined
        ? {}
        : { ...descriptor.buildRecipe.labels },
    },
  };
}
