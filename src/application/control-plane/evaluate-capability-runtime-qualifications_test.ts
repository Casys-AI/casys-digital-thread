import { assertEquals, assertRejects } from "@std/assert";
import { FileCapabilityRuntimeQualificationAttestationStore } from "../../adapters/control-plane/file-capability-runtime-qualification-attestation-store.ts";
import { FileCapabilityRuntimeHostIdentityStore } from "../../adapters/control-plane/file-capability-runtime-host-identity-store.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../adapters/control-plane/first-party-capability-binding-catalog.ts";
import {
  CAPABILITY_RUNTIME_BINDING_QUALIFICATION_ATTESTATION_SCHEMA_VERSION,
  type CapabilityRuntimeBindingQualificationAttestation,
  createCapabilityRuntimeBindingQualificationAttestation,
  fingerprintCapabilityRuntimeBindingQualificationAttestation,
  fingerprintCapabilityRuntimeObservedHost,
  validateCapabilityRuntimeBindingQualificationAttestation,
} from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import type {
  CapabilityRuntimeCatalog,
  CapabilityRuntimeHostObservation,
  QualifiedCapabilityRuntimeBinding,
} from "./read-model/capability-runtime-catalog.ts";
import { evaluateCapabilityRuntimeQualifications } from "./evaluate-capability-runtime-qualifications.ts";

const HOST_A = { algorithm: "sha256" as const, digest: "a".repeat(64) };
const HOST_B = { algorithm: "sha256" as const, digest: "b".repeat(64) };
const FIXTURE = { algorithm: "sha256" as const, digest: "c".repeat(64) };
const OUTCOME = { algorithm: "sha256" as const, digest: "d".repeat(64) };

Deno.test("an exact Chrono emulation attestation qualifies only its binding and material", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const host = observedHost(HOST_A);
  const chrono = await attestation(catalog, "chrono-prescribed-kinematics", host);

  const effective = evaluateCapabilityRuntimeQualifications({
    catalog,
    host,
    attestations: [chrono],
  });

  const chronoBinding = binding(effective, "chrono-prescribed-kinematics");
  assertEquals(chronoBinding.qualification, "qualified");
  assertEquals(chronoBinding.runtimeModes, [{
    material: chrono.material,
    targetPlatform: "linux/amd64",
    mode: "emulated",
    qualificationAttestationFingerprint: chrono.fingerprint,
  }]);
  assertEquals(
    binding(effective, "calculix-http-static-sensitivity").qualification,
    "unqualified",
  );
  assertEquals(
    binding(effective, "calculix-http-static-sensitivity").runtimeModes,
    [],
  );
});

Deno.test("qualification matching rejects every changed runtime identity axis", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const host = observedHost(HOST_A);
  const exact = await attestation(catalog, "chrono-prescribed-kinematics", host);
  const variants = [
    ["digest", (event: MutableAttestation) => {
      event.material.imageDigest = "e".repeat(64);
    }],
    ["profile", (event: MutableAttestation) => {
      event.profile = { id: "other-profile", version: "1", fingerprint: null };
    }],
    ["launch group", (event: MutableAttestation) => {
      event.launchGroup = {
        id: "other-group",
        version: "1",
        fingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
      };
    }],
    ["contract", (event: MutableAttestation) => {
      event.contract.source = "src/adapters/other.ts";
    }],
    ["binding", (event: MutableAttestation) => {
      event.binding.id = "other-binding";
    }],
    ["manifest", (event: MutableAttestation) => {
      event.unit.manifestFingerprint = { algorithm: "sha256", digest: "1".repeat(64) };
    }],
    ["host", (event: MutableAttestation) => {
      event.observedHost.identityFingerprint = HOST_B;
    }],
  ] as const;

  for (const [label, mutate] of variants) {
    const mismatch = await reattest(exact, mutate);
    const effective = evaluateCapabilityRuntimeQualifications({
      catalog,
      host,
      attestations: [mismatch],
    });
    assertEquals(
      binding(effective, "chrono-prescribed-kinematics").qualification,
      "unqualified",
      label,
    );
    assertEquals(
      binding(effective, "chrono-prescribed-kinematics").runtimeModes,
      [],
      label,
    );
  }
});

Deno.test("an exact revocation remains a monotone block and historic code-owned native qualification remains usable", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const host = observedHost(HOST_A);
  const qualified = await attestation(catalog, "chrono-prescribed-kinematics", host);
  const revoked = await reattest(qualified, (event) => {
    event.state = "revoked";
    event.recordedAt = "2026-08-29T00:00:01.000Z";
  });

  const effective = evaluateCapabilityRuntimeQualifications({
    catalog,
    host,
    attestations: [qualified, revoked],
  });
  assertEquals(
    binding(effective, "chrono-prescribed-kinematics").qualification,
    "revoked",
  );
  assertEquals(binding(effective, "chrono-prescribed-kinematics").runtimeModes, []);

  const staticBinding = binding(effective, "calculix-static-structural");
  assertEquals(staticBinding.qualification, "qualified");
  assertEquals(staticBinding.runtimeModes.length, 1);
  assertEquals(staticBinding.runtimeModes[0]?.mode, "native");
  assertEquals(
    staticBinding.runtimeModes[0]?.qualificationAttestationFingerprint,
    null,
  );
});

Deno.test("the local qualification store is canonical, append-only, and rejects secret-shaped fields", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-qualification-" });
  try {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const value = await attestation(
      catalog,
      "chrono-prescribed-kinematics",
      observedHost(HOST_A),
    );
    const store = new FileCapabilityRuntimeQualificationAttestationStore(directory);
    await store.append(value);
    await store.append(value);
    assertEquals(await store.read(value.fingerprint), value);
    assertEquals(await store.list(), [value]);
    assertEquals(JSON.stringify(value).includes("headers"), false);
    assertEquals(JSON.stringify(value).includes("payload"), false);
    assertEquals(JSON.stringify(value).includes("token"), false);

    await assertRejects(
      () =>
        validateCapabilityRuntimeBindingQualificationAttestation({
          ...value,
          headers: { authorization: "secret" },
        } as unknown),
      TypeError,
      "headers",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("host qualification identity is stable and opaque rather than a platform fingerprint", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-host-identity-" });
  try {
    const firstStore = new FileCapabilityRuntimeHostIdentityStore(
      `${directory}/host-identity.json`,
    );
    const first = await firstStore.read();
    assertEquals(await firstStore.read(), first);

    const second = await new FileCapabilityRuntimeHostIdentityStore(
      `${directory}/another-host-identity.json`,
    ).read();
    assertEquals(first.algorithm, "sha256");
    assertEquals(first.digest.length, 64);
    assertEquals(first.digest === second.digest, false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function observedHost(
  identityFingerprint: typeof HOST_A,
): CapabilityRuntimeHostObservation {
  return {
    schemaVersion: "capability-runtime-host-observation/1.0",
    identityFingerprint,
    platform: "linux/arm64",
    images: [],
  };
}

async function attestation(
  catalog: CapabilityRuntimeCatalog,
  bindingId: string,
  host: CapabilityRuntimeHostObservation,
): Promise<CapabilityRuntimeBindingQualificationAttestation> {
  const selected = binding(catalog, bindingId);
  const unit = catalog.units.find((candidate) => candidate.id === selected.unitIds[0])!;
  const material = unit.materials[0]!;
  const body = {
    schemaVersion: CAPABILITY_RUNTIME_BINDING_QUALIFICATION_ATTESTATION_SCHEMA_VERSION,
    state: "qualified" as const,
    recordedAt: "2026-08-29T00:00:00.000Z",
    binding: { id: selected.id, version: selected.version },
    selector: {
      capability: selected.capability,
      use: selected.use,
    },
    contract: selected.adapter,
    profile: selected.profile,
    unit: {
      id: unit.id,
      version: unit.version,
      manifestFingerprint: unit.manifestFingerprint,
    },
    material: {
      unitId: unit.id,
      materialId: material.id,
      imageDigest: digest(material.imageReference),
    },
    targetPlatform: "linux/amd64" as const,
    mode: "emulated" as const,
    launchGroup: material.launchGroup,
    observedHost: {
      identityFingerprint: host.identityFingerprint,
      platform: host.platform,
      fingerprint: await fingerprintCapabilityRuntimeObservedHost(
        host.platform,
        host.identityFingerprint,
      ),
    },
    fixture: { id: "chrono-arm64-fixture", fingerprint: FIXTURE },
    outcome: { id: "chrono-arm64-outcome", fingerprint: OUTCOME },
  };
  return await createCapabilityRuntimeBindingQualificationAttestation({
    ...body,
    fingerprint: await fingerprintCapabilityRuntimeBindingQualificationAttestation(
      body,
    ),
  });
}

type MutableAttestation = {
  -readonly [Key in keyof CapabilityRuntimeBindingQualificationAttestation]:
    CapabilityRuntimeBindingQualificationAttestation[Key] extends object
      ? Record<string, unknown>
      : CapabilityRuntimeBindingQualificationAttestation[Key];
};

async function reattest(
  source: CapabilityRuntimeBindingQualificationAttestation,
  mutate: (event: MutableAttestation) => void,
): Promise<CapabilityRuntimeBindingQualificationAttestation> {
  const event = structuredClone(source) as unknown as MutableAttestation;
  mutate(event);
  const observedHost = event.observedHost as unknown as {
    identityFingerprint: typeof HOST_A;
    platform: "linux/arm64" | "linux/amd64";
    fingerprint: typeof HOST_A;
  };
  observedHost.fingerprint = await fingerprintCapabilityRuntimeObservedHost(
    observedHost.platform,
    observedHost.identityFingerprint,
  );
  const { fingerprint: _previous, ...body } = event as unknown as
    & Omit<
      CapabilityRuntimeBindingQualificationAttestation,
      "fingerprint"
    >
    & { fingerprint: typeof HOST_A };
  return await createCapabilityRuntimeBindingQualificationAttestation({
    ...body,
    fingerprint: await fingerprintCapabilityRuntimeBindingQualificationAttestation(
      body,
    ),
  });
}

function binding(
  catalog: CapabilityRuntimeCatalog,
  id: string,
): QualifiedCapabilityRuntimeBinding {
  const selected = catalog.bindings.find((candidate) => candidate.id === id);
  if (!selected) throw new Error(`Missing test binding ${id}.`);
  return selected;
}

function digest(reference: string): string {
  const value = reference.slice(reference.lastIndexOf("@sha256:") + 8);
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("Test image is not digest pinned.");
  }
  return value;
}
