import { assertEquals } from "@std/assert";
import {
  capabilityRuntimeNonpersistentRemovalIntentId,
  createCapabilityRuntimeNonpersistentMaterialRemovalIntent,
  createCapabilityRuntimeNonpersistentMaterialRemovalPlan,
} from "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts";
import { authorizeDurableNonpersistentMaterialRemoval } from "../../application/control-plane/capability-runtime-nonpersistent-material-removal-authorization.ts";
import {
  createNativeMicrosandboxSdk,
  type MicrosandboxImageInspection,
  type MicrosandboxSdk,
} from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import { InMemoryCapabilityRuntimeNonpersistentMaterialRemovalJournal } from "./in-memory-capability-runtime-nonpersistent-material-removal.ts";
import { MicrosandboxCacheCapabilityRuntimeMaterialRemovalHost } from "./microsandbox-cache-capability-runtime-material-removal.ts";

const DIGEST = "a".repeat(64);
const REFERENCE = `casys/calculix-worker@sha256:${DIGEST}`;
const CANONICAL = `docker.io/casys/calculix-worker@sha256:${DIGEST}`;
const CLOCK = "2026-08-31T00:00:01.000Z";
const EXPECTATION = {
  material: { unitId: "casys.calculix-worker", materialId: "calculix-worker-image" },
  image: {
    reference: CANONICAL,
    manifestDigest: `sha256:${DIGEST}`,
    os: "linux" as const,
    architecture: "arm64",
    user: "65532:65532",
    entrypoint: ["/usr/local/bin/deno", "run"],
  },
};

Deno.test("Microsandbox cache removal uses exact Image.remove(ref,{force:false}) and never prune", async () => {
  const sdk = new FakeRemovalSdk({ present: true });
  const host = hostFor(sdk);
  const { authorization, plan } = await granted(host, "owned");
  const result = await host.mutate({ authorization, plan });
  assertEquals(result.status, "succeeded");
  assertEquals(sdk.removeCalls, [{ reference: CANONICAL, force: false }]);
  assertEquals(sdk.pruneCalls, 0);
});

Deno.test("Microsandbox cache already-absent is a no-op without Image.remove", async () => {
  const sdk = new FakeRemovalSdk({ present: false });
  const host = hostFor(sdk);
  const observed = await host.inspect({ material: fixtureMaterial() });
  assertEquals(observed.state, "absent");
  assertEquals(observed.safety, "exact");
  const { authorization, plan } = await granted(host, "absent");
  sdk.removeCalls.length = 0;
  const result = await host.mutate({ authorization, plan });
  assertEquals(result.status, "succeeded");
  assertEquals(sdk.removeCalls, []);
  assertEquals(sdk.pruneCalls, 0);
});

Deno.test("Microsandbox cache remaining after in-use refusal is failed", async () => {
  const sdk = new FakeRemovalSdk({ present: true, refuseRemove: true });
  const host = hostFor(sdk);
  const { authorization, plan } = await granted(host, "owned");
  const result = await host.mutate({ authorization, plan });
  assertEquals(result.status, "failed");
  assertEquals(result.observedState, "owned");
  assertEquals(sdk.removeCalls, [{ reference: CANONICAL, force: false }]);
});

Deno.test("Microsandbox cache unreadable post-state is uncertain", async () => {
  const sdk = new FakeRemovalSdk({
    present: true,
    inspectAfterRemove: "error",
  });
  const host = hostFor(sdk);
  const { authorization, plan } = await granted(host, "owned");
  const result = await host.mutate({ authorization, plan });
  assertEquals(result.status, "uncertain");
});

Deno.test("native Microsandbox SDK calls Image.remove(reference,{force:false}) after the local backend assertion", async () => {
  const removeCalls: { readonly reference: string; readonly force?: boolean }[] = [];
  let pruneCalls = 0;
  let backendKind = "local";
  class ImageNotFoundError extends Error {
    readonly code = "imageNotFound";
  }
  const sdk = createNativeMicrosandboxSdk({
    defaultBackendKind: () => backendKind,
    ImageNotFoundError,
    Image: {
      remove: (reference: string, opts?: { force?: boolean }) => {
        removeCalls.push({ reference, force: opts?.force });
        return Promise.resolve();
      },
      prune: () => {
        pruneCalls += 1;
        return Promise.resolve({});
      },
    },
  } as never);
  sdk.assertLocalBackend();
  await sdk.removeExactCachedImage(REFERENCE);
  assertEquals(removeCalls, [{ reference: REFERENCE, force: false }]);
  assertEquals(pruneCalls, 0);
  backendKind = "cloud";
  let refused = false;
  try {
    sdk.assertLocalBackend();
  } catch {
    refused = true;
  }
  assertEquals(refused, true);
});

function hostFor(sdk: FakeRemovalSdk) {
  return new MicrosandboxCacheCapabilityRuntimeMaterialRemovalHost({
    sdk: () => Promise.resolve(sdk),
    expectations: [EXPECTATION],
    clock: () => CLOCK,
  });
}

async function granted(
  _host: MicrosandboxCacheCapabilityRuntimeMaterialRemovalHost,
  observedState: "owned" | "absent",
) {
  const plan = await createCapabilityRuntimeNonpersistentMaterialRemovalPlan({
    unit: {
      id: "casys.calculix-worker",
      version: "1.0.0",
      manifestFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    },
    material: fixtureMaterial(),
    backend: "microsandbox-cache",
    observedState,
  });
  const intent = await createCapabilityRuntimeNonpersistentMaterialRemovalIntent({
    id: capabilityRuntimeNonpersistentRemovalIntentId({
      planFingerprint: plan.fingerprint,
      generation: 1,
    }),
    unit: plan.unit,
    material: plan.material,
    backend: plan.backend,
    generation: 1,
    planFingerprint: plan.fingerprint,
    previousObservation: observedState,
    plannedAt: "2026-08-31T00:00:00.000Z",
  });
  const journal = new InMemoryCapabilityRuntimeNonpersistentMaterialRemovalJournal();
  await journal.appendIntent(intent);
  return {
    plan,
    journal,
    authorization: await authorizeDurableNonpersistentMaterialRemoval(
      intent,
      plan,
      journal,
    ),
  };
}

function fixtureMaterial() {
  return {
    unitId: "casys.calculix-worker",
    materialId: "calculix-worker-image",
    imageReference: CANONICAL,
    imageDigest: DIGEST,
    launchGroup: null,
  };
}

class ImageNotFoundError extends Error {
  readonly code = "imageNotFound";
  constructor() {
    super("image not found");
    this.name = "ImageNotFoundError";
  }
}

class FakeRemovalSdk implements MicrosandboxSdk {
  readonly removeCalls: { readonly reference: string; readonly force: false }[] = [];
  pruneCalls = 0;
  #present: boolean;
  readonly #refuseRemove: boolean;
  readonly #inspectAfterRemove: "absent" | "error" | undefined;

  constructor(options: {
    readonly present: boolean;
    readonly refuseRemove?: boolean;
    readonly inspectAfterRemove?: "absent" | "error";
  }) {
    this.#present = options.present;
    this.#refuseRemove = options.refuseRemove === true;
    this.#inspectAfterRemove = options.inspectAfterRemove;
  }

  assertLocalBackend(): void {}

  isImageNotFound(error: unknown): boolean {
    return error instanceof ImageNotFoundError;
  }

  inspectImage(reference: string): Promise<MicrosandboxImageInspection> {
    if (!this.#present) {
      return Promise.reject(new ImageNotFoundError());
    }
    return Promise.resolve({
      reference,
      manifestDigest: `sha256:${DIGEST}`,
      architecture: "arm64",
      os: "linux",
      user: "65532:65532",
      entrypoint: ["/usr/local/bin/deno", "run"],
      command: null,
      environment: {},
      labels: {},
    });
  }

  removeExactCachedImage(reference: string): Promise<void> {
    this.removeCalls.push({ reference, force: false });
    if (this.#refuseRemove) {
      return Promise.reject(new Error("image in use"));
    }
    if (this.#inspectAfterRemove === "error") {
      this.#present = true;
      const original = this.inspectImage.bind(this);
      this.inspectImage = () => Promise.reject(new Error("unreadable"));
      void original;
    } else {
      this.#present = false;
    }
    return Promise.resolve();
  }

  create(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }
  listByLabels(): Promise<readonly never[]> {
    return Promise.resolve([]);
  }
  getByName(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}
