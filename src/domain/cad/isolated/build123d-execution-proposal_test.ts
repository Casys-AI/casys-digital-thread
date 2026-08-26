import { assert, assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import {
  BUILD123D_EXECUTION_ADMISSION_SCHEMA,
  BUILD123D_EXECUTION_COMPILATION_SCHEMA,
  BUILD123D_EXECUTION_COMPILED_ADMISSION_SCHEMA,
  BUILD123D_EXECUTION_OUTPUT,
  BUILD123D_EXECUTION_PROFILE,
  DESIGN_EXECUTE_BUILD123D_OPERATION,
  encodeBuild123dExecutionAdmissionParameters,
  parseBuild123dExecutionAdmissionParameters,
  validateBuild123dExecutionAdmission,
} from "./build123d-execution-proposal.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../compile/isolation/local-isolation-runtime.ts";

function fingerprint(character: string) {
  return { algorithm: "sha256", digest: character.repeat(64) } as const;
}

const OUTPUT_VALIDATOR = {
  id: "occt-step-ap214",
  version: "1.0.0",
} as const;

function admission(): Record<string, unknown> {
  const artifactFingerprint = fingerprint("a");
  return {
    schemaVersion: BUILD123D_EXECUTION_ADMISSION_SCHEMA,
    admissionArtifact: {
      schemaVersion: BUILD123D_EXECUTION_COMPILED_ADMISSION_SCHEMA,
      id: `technical-compilation-admission-${artifactFingerprint.digest}`,
      fingerprint: artifactFingerprint,
    },
    compilation: {
      document: {
        schemaVersion: BUILD123D_EXECUTION_COMPILATION_SCHEMA,
        fingerprint: fingerprint("b"),
        status: "ready-for-review",
      },
      projection: {
        target: "build123d-source",
        fingerprint: fingerprint("c"),
        status: "ready-for-review",
      },
      source: {
        id: "source.enclosure",
        sourceFingerprint: fingerprint("d"),
        captureFingerprint: fingerprint("e"),
        analysisFingerprint: fingerprint("f"),
      },
      profile: {
        id: "build123d-closed-subset-v1",
        version: "1.0.0",
        fingerprint: fingerprint("1"),
      },
    },
    execution: {
      profile: {
        ...BUILD123D_EXECUTION_PROFILE,
        fingerprint: fingerprint("2"),
      },
      isolationPolicy: {
        id: "isolation.build123d-deny-net",
        version: "1.0.0",
        fingerprint: fingerprint("3"),
      },
      runtimeBackend: {
        ...MICROSANDBOX_LOCAL_RUNTIME_REF,
        imageReference: `ghcr.io/casys-ai/build123d-runtime@sha256:${"4".repeat(64)}`,
        imageDigest: fingerprint("4"),
      },
      runtime: {
        imageDigest: fingerprint("4"),
        isolationClass: MICROSANDBOX_LOCAL_ISOLATION_CLASS,
        limits: {
          maxWallTimeMs: 30_000,
          maxCpuTimeMs: 20_000,
          maxMemoryBytes: 1_073_741_824,
          maxProcesses: 16,
          maxStdoutBytes: 65_536,
          maxStderrBytes: 65_536,
          maxOutputFileBytes: 16_777_216,
          maxOutputTotalBytes: 16_777_216,
        },
        limitAssurance: {
          maxWallTimeMs: "unattested",
          maxCpuTimeMs: "unattested",
          maxMemoryBytes: "backend-attested",
          maxProcesses: "unattested",
          maxStdoutBytes: "broker-observed-cap",
          maxStderrBytes: "broker-observed-cap",
          maxOutputFileBytes: "broker-observed-cap",
          maxOutputTotalBytes: "broker-observed-cap",
        },
      },
      outputValidator: OUTPUT_VALIDATOR,
      output: BUILD123D_EXECUTION_OUTPUT,
      minimumDestructionAssurance: "acknowledged-unattested",
    },
    status: "ready-for-execution-review",
  };
}

function mutableParameters(): EngineeringDecisionProposalParameter[] {
  return structuredClone(
    encodeBuild123dExecutionAdmissionParameters(admission()),
  ) as EngineeringDecisionProposalParameter[];
}

function parameter(
  parameters: readonly EngineeringDecisionProposalParameter[],
  key: string,
): EngineeringDecisionProposalParameter {
  const found = parameters.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`Fixture has no parameter ${key}.`);
  return found;
}

function replaceValue(
  parameters: EngineeringDecisionProposalParameter[],
  key: string,
  value: string | number | boolean,
): void {
  const index = parameters.findIndex((candidate) => candidate.key === key);
  if (index < 0) throw new Error(`Fixture has no parameter ${key}.`);
  parameters[index] = { ...parameters[index], value };
}

const PREFIX = "design.build123d.execution";

Deno.test("Build123d execution admission round-trip is canonical, singular, and authority-free", () => {
  const encoded = encodeBuild123dExecutionAdmissionParameters(admission());
  const parsed = parseBuild123dExecutionAdmissionParameters(encoded);

  assertEquals(encoded.length, 56);
  assertEquals(
    parameter(encoded, `${PREFIX}.operation`).value,
    `${DESIGN_EXECUTE_BUILD123D_OPERATION.id}@${DESIGN_EXECUTE_BUILD123D_OPERATION.version}`,
  );
  assertEquals(parsed.compilation.projection.target, "build123d-source");
  assertEquals(parsed.compilation.source.id, "source.enclosure");
  assertEquals(parsed.execution.profile, {
    ...BUILD123D_EXECUTION_PROFILE,
    fingerprint: fingerprint("2"),
  });
  assertEquals(parsed.execution.output, BUILD123D_EXECUTION_OUTPUT);
  assertEquals(parsed.execution.outputValidator, OUTPUT_VALIDATOR);
  assertEquals(parsed.status, "ready-for-execution-review");
  assertEquals(encodeBuild123dExecutionAdmissionParameters(parsed), encoded);
  assert(Object.isFrozen(encoded));
  assert(Object.isFrozen(encoded[0]));
  assert(Object.isFrozen(parsed));
  assert(Object.isFrozen(parsed.execution.runtime.limits));

  const serialized = JSON.stringify(encoded).toLowerCase();
  for (
    const forbidden of [
      "provider",
      "tool",
      "path",
      "command",
      "args",
      "endpoint",
      "credential",
      "sourcetext",
    ]
  ) {
    assert(!serialized.includes(forbidden), `${forbidden} must stay absent.`);
  }
});

Deno.test("Build123d execution admission uses safe versions without losing build metadata", () => {
  const candidate = structuredClone(admission()) as {
    compilation: { profile: { version: string } };
    execution: {
      isolationPolicy: { version: string };
      outputValidator: { version: string };
    };
  };
  candidate.compilation.profile.version = "1.0.0+occt";
  candidate.execution.isolationPolicy.version = "2026.08+deny-net";
  candidate.execution.outputValidator.version = "1.0.0+occt-7.8";

  const parsed = parseBuild123dExecutionAdmissionParameters(
    encodeBuild123dExecutionAdmissionParameters(candidate),
  );
  assertEquals(parsed.compilation.profile.version, "1.0.0+occt");
  assertEquals(
    parsed.execution.isolationPolicy.version,
    "2026.08+deny-net",
  );
  assertEquals(parsed.execution.outputValidator.version, "1.0.0+occt-7.8");

  for (const version of ["1.0.0 with prose", "1.0.0/escape"]) {
    const invalid = structuredClone(admission()) as {
      compilation: { profile: { version: string } };
    };
    invalid.compilation.profile.version = version;
    assertThrows(
      () => encodeBuild123dExecutionAdmissionParameters(invalid),
      TypeError,
      "safe ASCII version",
    );

    const invalidValidator = structuredClone(admission()) as {
      execution: { outputValidator: { version: string } };
    };
    invalidValidator.execution.outputValidator.version = version;
    assertThrows(
      () => encodeBuild123dExecutionAdmissionParameters(invalidValidator),
      TypeError,
      "safe ASCII version",
    );
  }
});

Deno.test("Build123d execution admission rejects non-canonical MRTR records, labels, order, and keys", () => {
  const extraRecordField = mutableParameters() as Array<
    EngineeringDecisionProposalParameter & { note?: string }
  >;
  extraRecordField[0] = { ...extraRecordField[0], note: "unsigned" };
  assertThrows(
    () => parseBuild123dExecutionAdmissionParameters(extraRecordField),
    TypeError,
    "unsupported field note",
  );

  const changedLabel = mutableParameters();
  changedLabel[0] = { ...changedLabel[0], label: "Looks equivalent" };
  assertThrows(
    () => parseBuild123dExecutionAdmissionParameters(changedLabel),
    TypeError,
    "label",
  );

  const reordered = mutableParameters();
  [reordered[5], reordered[6]] = [reordered[6], reordered[5]];
  assertThrows(
    () => parseBuild123dExecutionAdmissionParameters(reordered),
    TypeError,
    ".key must equal",
  );

  const duplicate = mutableParameters();
  duplicate[1] = { ...duplicate[1], key: duplicate[0].key };
  assertThrows(
    () => parseBuild123dExecutionAdmissionParameters(duplicate),
    TypeError,
    "duplicate key",
  );

  const missing = mutableParameters();
  missing.pop();
  assertThrows(
    () => parseBuild123dExecutionAdmissionParameters(missing),
    TypeError,
    "exactly 56 entries",
  );

  const added = mutableParameters();
  added.push({ key: "unsigned", label: "Unsigned", value: true });
  assertThrows(
    () => parseBuild123dExecutionAdmissionParameters(added),
    TypeError,
    "exactly 56 entries",
  );
});

Deno.test("Build123d execution admission fixes operation, schemas, target, profiles, output, and review state", () => {
  const mutations: ReadonlyArray<readonly [string, string]> = [
    [`${PREFIX}.operation`, "design.execute-build123d@2"],
    [`${PREFIX}.schemaVersion`, "build123d-execution-admission/3.0"],
    [
      `${PREFIX}.admissionArtifact.schemaVersion`,
      "technical-compilation-admission-capture/1.0",
    ],
    [`${PREFIX}.compilation.document.schemaVersion`, "technical-compilation/1.0"],
    [`${PREFIX}.compilation.document.status`, "unresolved"],
    [`${PREFIX}.compilation.projection.target`, "calculix-source-candidate"],
    [`${PREFIX}.compilation.projection.status`, "rejected"],
    [`${PREFIX}.profile.id`, "generic-python"],
    [`${PREFIX}.profile.version`, "1.0.1"],
    [`${PREFIX}.runtimeBackend.id`, "remote-sandbox"],
    [`${PREFIX}.runtimeBackend.version`, "0.6.9"],
    [`${PREFIX}.runtimeBackend.lifecycle`, "detached"],
    [`${PREFIX}.runtimeBackend.network`, "bridge"],
    [`${PREFIX}.runtime.isolationClass`, "microvm.v2"],
    [`${PREFIX}.output.role`, "mesh"],
    [`${PREFIX}.output.basename`, "other.step"],
    [`${PREFIX}.output.mediaType`, "application/octet-stream"],
    [`${PREFIX}.output.format`, "step-ap203"],
    [`${PREFIX}.minimumDestructionAssurance`, "none"],
    [`${PREFIX}.status`, "approved"],
  ];
  for (const [key, value] of mutations) {
    const parameters = mutableParameters();
    replaceValue(parameters, key, value);
    assertThrows(
      () => parseBuild123dExecutionAdmissionParameters(parameters),
      TypeError,
      undefined,
      `${key} must remain code-owned.`,
    );
  }
});

Deno.test("Build123d execution admission recomputes the compiled artifact identity", () => {
  const changedId = mutableParameters();
  replaceValue(
    changedId,
    `${PREFIX}.admissionArtifact.id`,
    `technical-compilation-admission-${"b".repeat(64)}`,
  );
  assertThrows(
    () => parseBuild123dExecutionAdmissionParameters(changedId),
    TypeError,
    "derived from its exact fingerprint",
  );

  const changedFingerprint = mutableParameters();
  replaceValue(
    changedFingerprint,
    `${PREFIX}.admissionArtifact.sha256`,
    "b".repeat(64),
  );
  assertThrows(
    () => parseBuild123dExecutionAdmissionParameters(changedFingerprint),
    TypeError,
    "derived from its exact fingerprint",
  );
});

Deno.test("Build123d execution admission rejects malformed hashes everywhere", () => {
  const digestKeys = mutableParameters()
    .filter((item) => item.key.endsWith("Sha256") || item.key.endsWith("sha256"))
    .map((item) => item.key);
  assertEquals(digestKeys.length, 11);

  for (const key of digestKeys) {
    const parameters = mutableParameters();
    replaceValue(parameters, key, "a".repeat(63));
    assertThrows(
      () => parseBuild123dExecutionAdmissionParameters(parameters),
      TypeError,
      "lowercase SHA-256 digest",
      `${key} must fail closed.`,
    );
  }
});

Deno.test("Build123d execution admission preserves every variable consequential identity", () => {
  const baseline = mutableParameters();
  const changed = mutableParameters();
  replaceValue(
    changed,
    `${PREFIX}.compilation.document.sha256`,
    "6".repeat(64),
  );
  replaceValue(
    changed,
    `${PREFIX}.runtimeBackend.imageReference`,
    `ghcr.io/casys-ai/build123d-runtime@sha256:${"7".repeat(64)}`,
  );
  replaceValue(changed, `${PREFIX}.runtimeBackend.imageSha256`, "7".repeat(64));
  replaceValue(changed, `${PREFIX}.runtime.imageSha256`, "7".repeat(64));
  replaceValue(changed, `${PREFIX}.runtime.limits.maxCpuTimeMs`, 19_999);
  replaceValue(changed, `${PREFIX}.outputValidator.id`, "occt-step-ap214.v2");
  replaceValue(changed, `${PREFIX}.outputValidator.version`, "2.0.0");

  const parsed = parseBuild123dExecutionAdmissionParameters(changed);
  assertEquals(parsed.compilation.document.fingerprint, fingerprint("6"));
  assertEquals(parsed.execution.runtimeBackend.imageDigest, fingerprint("7"));
  assertEquals(parsed.execution.runtime.limits.maxCpuTimeMs, 19_999);
  assertEquals(parsed.execution.outputValidator, {
    id: "occt-step-ap214.v2",
    version: "2.0.0",
  });
  assertEquals(encodeBuild123dExecutionAdmissionParameters(parsed), changed);
  assertNotEquals(changed, baseline);
});

Deno.test("Build123d execution admission rejects unsafe limits and false assurance", () => {
  for (const value of [0, -0, -1, 1.5]) {
    const parameters = mutableParameters();
    replaceValue(parameters, `${PREFIX}.runtime.limits.maxProcesses`, value);
    assertThrows(
      () => parseBuild123dExecutionAdmissionParameters(parameters),
      TypeError,
      "positive integer",
      `Limit ${String(value)} must fail closed.`,
    );
  }

  const inconsistentOutputCaps = mutableParameters();
  replaceValue(
    inconsistentOutputCaps,
    `${PREFIX}.runtime.limits.maxOutputTotalBytes`,
    1,
  );
  assertThrows(
    () => parseBuild123dExecutionAdmissionParameters(inconsistentOutputCaps),
    TypeError,
    "must not exceed",
  );

  const inventedAssurance = mutableParameters();
  replaceValue(
    inventedAssurance,
    `${PREFIX}.runtime.limitAssurance.maxMemoryBytes`,
    "fully-enforced",
  );
  assertThrows(
    () => parseBuild123dExecutionAdmissionParameters(inventedAssurance),
    TypeError,
    "explicit limit assurance",
  );
});

Deno.test("Build123d execution object grammar rejects plural and hidden authority fields", () => {
  const hiddenAuthorities: ReadonlyArray<
    readonly [string, (candidate: Record<string, unknown>) => void]
  > = [
    ["provider", (candidate) => {
      candidate.provider = "sandbox";
    }],
    ["command", (candidate) => {
      (candidate.execution as Record<string, unknown>).command = "python";
    }],
    ["path", (candidate) => {
      const execution = candidate.execution as Record<string, unknown>;
      (execution.output as Record<string, unknown>).path = "/out/geometry.step";
    }],
    ["sourceText", (candidate) => {
      const compilation = candidate.compilation as Record<string, unknown>;
      (compilation.source as Record<string, unknown>).sourceText = "result = Box()";
    }],
  ];
  for (const [field, mutate] of hiddenAuthorities) {
    const candidate = structuredClone(admission());
    mutate(candidate);
    assertThrows(
      () => validateBuild123dExecutionAdmission(candidate),
      TypeError,
      `unsupported field ${field}`,
    );
  }

  const pluralArtifact = structuredClone(admission());
  pluralArtifact.admissionArtifact = [pluralArtifact.admissionArtifact];
  assertThrows(
    () => validateBuild123dExecutionAdmission(pluralArtifact),
    TypeError,
    "must be an object",
  );

  const pluralSource = structuredClone(admission());
  const compilation = pluralSource.compilation as Record<string, unknown>;
  compilation.source = [compilation.source];
  assertThrows(
    () => validateBuild123dExecutionAdmission(pluralSource),
    TypeError,
    "must be an object",
  );
});
