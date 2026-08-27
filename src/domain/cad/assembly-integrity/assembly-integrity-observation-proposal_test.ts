import { assert, assertEquals, assertThrows } from "@std/assert";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import {
  ASSEMBLY_INTEGRITY_OBSERVATION_ADMISSION_SCHEMA,
  encodeAssemblyIntegrityObservationAdmissionParameters,
  parseAssemblyIntegrityObservationAdmissionParameters,
  validateAssemblyIntegrityObservationAdmission,
} from "./assembly-integrity-observation-proposal.ts";
import { VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION } from "./assembly-integrity-observation.ts";

function fingerprint(character: string) {
  return { algorithm: "sha256", digest: character.repeat(64) } as const;
}

function admission(): Record<string, unknown> {
  const geometryFingerprint = fingerprint("a");
  return {
    schemaVersion: ASSEMBLY_INTEGRITY_OBSERVATION_ADMISSION_SCHEMA,
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    projectId: "project.assembly-integrity",
    basis: {
      kind: "thread-snapshot",
      snapshotId: "thread.snapshot.12",
      revision: 12,
      subjectId: "subject.assembly",
    },
    geometryModule: {
      artifactId: `geometry-${geometryFingerprint.digest}`,
      fingerprint: geometryFingerprint,
    },
    observer: {
      profile: {
        id: "assembly-integrity-observation",
        version: "1.0.0",
        fingerprint: fingerprint("b"),
      },
      method: {
        id: "occt-assembly-observer",
        version: "1.0.0",
        linearToleranceMm: 0.01,
      },
      configuredRuntime: {
        kind: "image-digest",
        imageDigest: fingerprint("c"),
      },
    },
  };
}

function mutableParameters(): EngineeringDecisionProposalParameter[] {
  return structuredClone(
    encodeAssemblyIntegrityObservationAdmissionParameters(admission()),
  ) as EngineeringDecisionProposalParameter[];
}

function replaceValue(
  parameters: EngineeringDecisionProposalParameter[],
  key: string,
  value: string | number | boolean,
): void {
  const index = parameters.findIndex((parameter) => parameter.key === key);
  if (index < 0) throw new Error(`No fixture parameter named ${key}.`);
  parameters[index] = { ...parameters[index], value };
}

Deno.test("assembly-integrity observation admission round-trips as one closed factual MRTR grammar", () => {
  const encoded = encodeAssemblyIntegrityObservationAdmissionParameters(admission());
  const parsed = parseAssemblyIntegrityObservationAdmissionParameters(encoded);

  assertEquals(encoded.length, 17);
  assertEquals(
    encoded.find((parameter) =>
      parameter.key === "verify.assemblyIntegrity.observation.operation"
    )?.value,
    "verify.observe-assembly-integrity@1",
  );
  assertEquals(parsed.geometryModule.artifactId, `geometry-${"a".repeat(64)}`);
  assertEquals(parsed.observer.configuredRuntime, {
    kind: "image-digest",
    imageDigest: fingerprint("c"),
  });
  assertEquals(encodeAssemblyIntegrityObservationAdmissionParameters(parsed), encoded);
  assert(Object.isFrozen(encoded));
  assert(Object.isFrozen(parsed));

  const serialized = JSON.stringify(encoded).toLowerCase();
  for (
    const forbidden of [
      "provider",
      "tool",
      "endpoint",
      "command",
      "args",
      "children",
      "transform",
    ]
  ) {
    assert(!serialized.includes(forbidden), `${forbidden} must stay absent.`);
  }
});

Deno.test("assembly-integrity observation admission refuses provider, runtime, and caller-only extras", () => {
  const valid = admission();
  for (
    const extra of [
      "provider",
      "tool",
      "runtime",
      "children",
      "transform",
      "tolerance",
    ]
  ) {
    assertThrows(() =>
      validateAssemblyIntegrityObservationAdmission({ ...valid, [extra]: "caller" })
    );
  }

  for (const key of ["provider", "runtime"]) {
    assertThrows(() =>
      parseAssemblyIntegrityObservationAdmissionParameters([
        ...mutableParameters(),
        { key, label: "Forbidden", value: "caller" },
      ])
    );
  }
});

Deno.test("assembly-integrity observation admission refuses latest aliases and noncanonical geometry identifiers", () => {
  const profileAlias = structuredClone(admission()) as {
    observer: { profile: { id: string } };
  };
  profileAlias.observer.profile.id = "LATEST";
  assertThrows(() => validateAssemblyIntegrityObservationAdmission(profileAlias));

  const moduleAlias = structuredClone(admission()) as {
    geometryModule: { artifactId: string };
  };
  moduleAlias.geometryModule.artifactId = "geometry-latest";
  assertThrows(() => validateAssemblyIntegrityObservationAdmission(moduleAlias));

  const parameterAlias = mutableParameters();
  replaceValue(
    parameterAlias,
    "verify.assemblyIntegrity.observation.basis.snapshotId",
    "Latest",
  );
  assertThrows(() =>
    parseAssemblyIntegrityObservationAdmissionParameters(parameterAlias)
  );

  const labelAlias = mutableParameters();
  labelAlias[0] = { ...labelAlias[0]!, label: "Different schema" };
  assertThrows(() => parseAssemblyIntegrityObservationAdmissionParameters(labelAlias));
});
