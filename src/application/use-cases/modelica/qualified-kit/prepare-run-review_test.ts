import { assert, assertEquals, assertRejects } from "@std/assert";
import type {
  ProjectModelicaQualifiedKitRunReviewCommand,
} from "../../../ports/in/modelica/qualified-kit-run-review.ts";
import type {
  ModelicaQualifiedKitBundleFactory,
  ModelicaQualifiedKitBundlePreparationRequest,
} from "../../../ports/out/modelica/qualified-kit-bundle-factory.ts";
import type {
  ModelicaQualifiedKitReviewBasisAuthority,
  ModelicaQualifiedKitReviewBasisRequest,
} from "../../../ports/out/modelica/qualified-kit-review-basis-authority.ts";
import type {
  ModelicaIsolatedExecutionProfile,
  ModelicaIsolatedExecutionProfileCatalog,
} from "../../../ports/out/modelica/isolated-execution-profile.ts";
import type {
  ModelicaIsolatedExecutionQualificationAuthority,
} from "../../../ports/out/modelica/isolated-execution-qualification.ts";
import { FixedModelicaIsolatedExecutionProfileCatalog } from "../../../../adapters/modelica/qualified-kit/execution-profile.ts";
import { LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE } from "../../../../domain/modelica/local-execution-image.ts";
import { createModelicaMicrosandboxQualificationKit } from "../../../../adapters/modelica/qualified-kit/kit-v1/qualification-kit.ts";
import type {
  PreparedModelicaIsolatedInputBundle,
} from "../../../../domain/modelica/qualified-kit/isolated-execution.ts";
import {
  MODELICA_MICROSANDBOX_QUALIFICATION_REFERENCE_SCHEMA,
  type ModelicaMicrosandboxQualificationReference,
} from "../../../../domain/modelica/qualified-kit/microsandbox-qualification.ts";
import {
  MODELICA_QUALIFIED_RUNTIME_QUALIFICATION_FINGERPRINT,
  parseModelicaQualifiedKitRunAdmissionParameters,
} from "../../../../domain/modelica/qualified-kit/run-proposal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import {
  PrepareProjectModelicaQualifiedKitRunReview,
  ProjectModelicaQualifiedKitRunReviewError,
} from "./prepare-run-review.ts";

class FakeBasisAuthority implements ModelicaQualifiedKitReviewBasisAuthority {
  readonly calls: ModelicaQualifiedKitReviewBasisRequest[] = [];
  result?: ModelicaQualifiedKitReviewBasisRequest;
  failure?: Error;

  reopenExact(
    request: ModelicaQualifiedKitReviewBasisRequest,
  ): Promise<ModelicaQualifiedKitReviewBasisRequest | undefined> {
    this.calls.push(structuredClone(request));
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(this.result && structuredClone(this.result));
  }
}

class FakeProfiles implements ModelicaIsolatedExecutionProfileCatalog {
  initialCalls = 0;
  resolveCalls = 0;
  failure?: Error;

  constructor(public profile: ModelicaIsolatedExecutionProfile) {}

  initial(): Promise<ModelicaIsolatedExecutionProfile> {
    this.initialCalls += 1;
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(structuredClone(this.profile));
  }

  resolve(): Promise<ModelicaIsolatedExecutionProfile> {
    this.resolveCalls += 1;
    return Promise.reject(new Error("review never resolves caller-selected profile"));
  }
}

class FakeQualifications implements ModelicaIsolatedExecutionQualificationAuthority {
  calls = 0;
  result?: ModelicaMicrosandboxQualificationReference;
  failure?: Error;

  reopenQualified(): Promise<ModelicaMicrosandboxQualificationReference | undefined> {
    this.calls += 1;
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(this.result && structuredClone(this.result));
  }
}

class FakeBundleFactory implements ModelicaQualifiedKitBundleFactory {
  readonly calls: ModelicaQualifiedKitBundlePreparationRequest[] = [];
  failure?: Error;

  constructor(public bundle: PreparedModelicaIsolatedInputBundle) {}

  prepare(
    request: ModelicaQualifiedKitBundlePreparationRequest,
  ): Promise<PreparedModelicaIsolatedInputBundle> {
    this.calls.push(structuredClone(request));
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(cloneBundle(this.bundle));
  }
}

interface Harness {
  readonly service: PrepareProjectModelicaQualifiedKitRunReview;
  readonly command: ProjectModelicaQualifiedKitRunReviewCommand;
  readonly basis: FakeBasisAuthority;
  readonly profiles: FakeProfiles;
  readonly qualifications: FakeQualifications;
  readonly bundles: FakeBundleFactory;
}

Deno.test("qualified Modelica review exposes only admission and canonical MRTR while execution preparation retains exact bytes", async () => {
  const fixture = await harness();
  const publicResult = await fixture.service.execute(fixture.command);
  const material = await fixture.service.prepareForExecution(fixture.command);

  assertEquals(Object.keys(publicResult).sort(), ["admission", "decisionParameters"]);
  assertEquals(Object.hasOwn(publicResult, "bundle"), false);
  assertEquals(
    parseModelicaQualifiedKitRunAdmissionParameters(
      publicResult.decisionParameters,
    ),
    publicResult.admission,
  );
  assertEquals(material.admission, publicResult.admission);
  assertEquals(material.decisionParameters, publicResult.decisionParameters);
  assertEquals(material.bundle.fingerprint, fixture.bundles.bundle.fingerprint);
  assertEquals(material.bundle.bytes, fixture.bundles.bundle.bytes);
  assert(material.bundle.bytes !== fixture.bundles.bundle.bytes);
  assertEquals(fixture.basis.calls, [fixture.command, fixture.command]);
  assertEquals(fixture.profiles.initialCalls, 2);
  assertEquals(fixture.profiles.resolveCalls, 0);
  assertEquals(fixture.qualifications.calls, 2);
  assertEquals(fixture.bundles.calls.length, 2);
  assertEquals(fixture.bundles.calls[0]?.projectId, fixture.command.projectId);
  assertEquals(fixture.bundles.calls[0]?.basis, fixture.command.basis);
  assertEquals(
    fixture.bundles.calls[0]?.runtimeQualification,
    fixture.qualifications.result,
  );
});

Deno.test("unknown or stale Thread bases stop before profile selection", async () => {
  const invalid = await harness();
  await assertReviewError(
    () => invalid.service.execute({ ...invalid.command, selectedKit: "caller" }),
    "invalid_request",
  );
  await assertReviewError(
    () =>
      invalid.service.execute({
        ...invalid.command,
        basis: { ...invalid.command.basis, snapshotId: "latest" },
      }),
    "invalid_request",
  );
  assertEquals(invalid.basis.calls.length, 0);
  assertEquals(invalid.profiles.initialCalls, 0);

  const missing = await harness();
  missing.basis.result = undefined;
  await assertReviewError(
    () => missing.service.execute(missing.command),
    "basis_unavailable",
  );
  assertEquals(missing.profiles.initialCalls, 0);

  const foreign = await harness();
  foreign.basis.result = {
    ...foreign.command,
    basis: { ...foreign.command.basis, subjectId: "subject.foreign" },
  };
  await assertReviewError(
    () => foreign.service.execute(foreign.command),
    "basis_integrity_failed",
  );
  assertEquals(foreign.profiles.initialCalls, 0);
});

Deno.test("an absent or foreign runtime qualification stops before bundle preparation", async () => {
  const missing = await harness();
  missing.qualifications.result = undefined;
  await assertReviewError(
    () => missing.service.execute(missing.command),
    "runtime_qualification_unavailable",
  );
  assertEquals(missing.bundles.calls.length, 0);

  const foreign = await harness();
  foreign.qualifications.result = {
    ...foreign.qualifications.result!,
    executionProfileFingerprint: {
      algorithm: "sha256",
      digest: "f".repeat(64),
    },
  };
  await assertReviewError(
    () => foreign.service.execute(foreign.command),
    "runtime_qualification_integrity_failed",
  );
  assertEquals(foreign.bundles.calls.length, 0);

  const otherCapture = await harness();
  otherCapture.qualifications.result = {
    ...otherCapture.qualifications.result!,
    fingerprint: {
      algorithm: "sha256",
      digest: "e".repeat(64),
    },
  };
  await assertReviewError(
    () => otherCapture.service.execute(otherCapture.command),
    "runtime_qualification_integrity_failed",
  );
  assertEquals(otherCapture.bundles.calls.length, 0);
});

Deno.test("a stale profile fingerprint is rejected before qualification", async () => {
  const fixture = await harness();
  fixture.profiles.profile = {
    ...fixture.profiles.profile,
    maximumBundleBytes: fixture.profiles.profile.maximumBundleBytes + 1,
  };

  await assertReviewError(
    () => fixture.service.execute(fixture.command),
    "profile_integrity_failed",
  );
  assertEquals(fixture.qualifications.calls, 0);
  assertEquals(fixture.bundles.calls.length, 0);
});

Deno.test("a self-consistent foreign bundle is rejected as a non-qualified kit", async () => {
  const fixture = await harness();
  const document = structuredClone(fixture.bundles.bundle.document);
  (document.selection as { modelId: string }).modelId = "foreign-kit";
  const text = deterministicJson(document);
  fixture.bundles.bundle = {
    document,
    text,
    bytes: new TextEncoder().encode(text),
    fingerprint: await sha256Fingerprint(document),
  };

  await assertReviewError(
    () => fixture.service.execute(fixture.command),
    "bundle_integrity_failed",
  );
});

Deno.test("outward failures are normalized without provider details", async () => {
  const basis = await harness();
  basis.basis.failure = new Error("secret path /private/project.json");
  const basisError = await assertReviewError(
    () => basis.service.execute(basis.command),
    "basis_unavailable",
  );
  assertEquals(basisError.message.includes("/private"), false);
  assertEquals(basisError.cause, undefined);

  const profile = await harness();
  profile.profiles.failure = new Error("secret token");
  await assertReviewError(
    () => profile.service.execute(profile.command),
    "profile_unavailable",
  );

  const qualification = await harness();
  qualification.qualifications.failure = new Error("private capture path");
  await assertReviewError(
    () => qualification.service.execute(qualification.command),
    "runtime_qualification_unavailable",
  );

  const bundle = await harness();
  bundle.bundles.failure = new Error("source text leak");
  await assertReviewError(
    () => bundle.service.execute(bundle.command),
    "bundle_unavailable",
  );
});

async function harness(): Promise<Harness> {
  const limits = {
    maxWallTimeMs: 120_000,
    maxCpuTimeMs: 120_000,
    maxMemoryBytes: 3 * 1_073_741_824,
    maxProcesses: 64,
    maxStdoutBytes: 1_048_576,
    maxStderrBytes: 1_048_576,
    maxOutputFileBytes: 16 * 1_048_576,
    maxOutputTotalBytes: 17 * 1_048_576,
  };
  const imageReference = LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE;
  const catalog = new FixedModelicaIsolatedExecutionProfileCatalog({
    imageReference,
    policy: {
      id: "modelica-microsandbox-deny-all-v1",
      version: "1.0.0",
      fingerprint: {
        algorithm: "sha256",
        digest: "acd119309fd7827a09b31babdd01a46e27f9839b02145dc8e01b480d904ccabe",
      },
    },
    limits,
    engine: {
      name: "OpenModelica",
      version: "1.27.0",
      mslVersion: "4.1.0",
    },
  });
  const profile = await catalog.initial();
  const bundle = (await createModelicaMicrosandboxQualificationKit(
    profile.method.engine,
  )).bundle;
  const qualificationFingerprint = MODELICA_QUALIFIED_RUNTIME_QUALIFICATION_FINGERPRINT;
  const qualification: ModelicaMicrosandboxQualificationReference = {
    schemaVersion: MODELICA_MICROSANDBOX_QUALIFICATION_REFERENCE_SCHEMA,
    uri:
      `casys://modelica-microsandbox-qualification/sha256/${qualificationFingerprint.digest}`,
    fingerprint: qualificationFingerprint,
    executionProfileFingerprint: profile.profileFingerprint,
  };
  const command: ProjectModelicaQualifiedKitRunReviewCommand = {
    projectId: "project.motor",
    basis: {
      kind: "thread-snapshot",
      snapshotId: "thread.motor.7",
      revision: 7,
      subjectId: "subject.motor",
    },
  };
  const basis = new FakeBasisAuthority();
  basis.result = command;
  const profiles = new FakeProfiles(profile);
  const qualifications = new FakeQualifications();
  qualifications.result = qualification;
  const bundles = new FakeBundleFactory(bundle);
  return {
    service: new PrepareProjectModelicaQualifiedKitRunReview({
      basisAuthority: basis,
      profiles,
      qualifications,
      bundleFactory: bundles,
    }),
    command,
    basis,
    profiles,
    qualifications,
    bundles,
  };
}

function cloneBundle(
  bundle: PreparedModelicaIsolatedInputBundle,
): PreparedModelicaIsolatedInputBundle {
  return {
    document: structuredClone(bundle.document),
    text: bundle.text,
    bytes: Uint8Array.from(bundle.bytes),
    fingerprint: structuredClone(bundle.fingerprint),
  };
}

async function assertReviewError(
  callback: () => Promise<unknown>,
  code: ProjectModelicaQualifiedKitRunReviewError["code"],
): Promise<ProjectModelicaQualifiedKitRunReviewError> {
  const error = await assertRejects(
    callback,
    ProjectModelicaQualifiedKitRunReviewError,
  );
  assertEquals(error.code, code);
  return error;
}
