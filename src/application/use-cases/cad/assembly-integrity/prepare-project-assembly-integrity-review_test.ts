import { assertEquals, assertRejects } from "@std/assert";
import type {
  ProjectAssemblyIntegrityReviewCommand,
  ProjectAssemblyIntegrityReviewResult,
} from "../../../ports/in/cad/assembly-integrity/project-assembly-integrity-review.ts";
import type {
  AssemblyIntegrityReviewResolution,
  AssemblyIntegrityReviewResolutionRequest,
  AssemblyIntegrityReviewResolver,
} from "../../../ports/out/cad/assembly-integrity/assembly-integrity-review-resolver.ts";
import {
  ASSEMBLY_INTEGRITY_OBSERVATION_ADMISSION_SCHEMA,
  parseAssemblyIntegrityObservationAdmissionParameters,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-observation-proposal.ts";
import { VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION } from "../../../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import {
  PrepareProjectAssemblyIntegrityReview,
  ProjectAssemblyIntegrityReviewError,
} from "./prepare-project-assembly-integrity-review.ts";

function fingerprint(character: string) {
  return { algorithm: "sha256", digest: character.repeat(64) } as const;
}

function command(): ProjectAssemblyIntegrityReviewCommand {
  const geometryFingerprint = fingerprint("a");
  return {
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
  };
}

function admission(input = command()) {
  return {
    schemaVersion: ASSEMBLY_INTEGRITY_OBSERVATION_ADMISSION_SCHEMA,
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    projectId: input.projectId,
    basis: input.basis,
    geometryModule: input.geometryModule,
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
  } as const;
}

class FakeResolver implements AssemblyIntegrityReviewResolver {
  readonly calls: AssemblyIntegrityReviewResolutionRequest[] = [];

  constructor(public result: AssemblyIntegrityReviewResolution) {}

  resolve(
    request: AssemblyIntegrityReviewResolutionRequest,
  ): Promise<AssemblyIntegrityReviewResolution> {
    this.calls.push(structuredClone(request));
    return Promise.resolve(structuredClone(this.result));
  }
}

Deno.test("assembly-integrity review compiles one exact current primary geometry binding and factual MRTR", async () => {
  const input = command();
  const resolver = new FakeResolver({
    status: "resolved",
    admission: admission(input),
    expectedProjectRevision: 24,
  });
  const service = new PrepareProjectAssemblyIntegrityReview({ resolver });

  const result = await service.execute(input);
  if (result.status !== "resolved") throw new Error("Expected resolved review.");

  assertEquals(resolver.calls, [input]);
  assertEquals(result.diagnostics, []);
  assertEquals(result.grants, "none");
  assertEquals(result.operation, {
    id: "verify.observe-assembly-integrity",
    version: "1",
    bindings: [{
      name: "geometryModule",
      source: {
        kind: "thread-entity",
        reference: {
          snapshotId: input.basis.snapshotId,
          snapshotRevision: input.basis.revision,
          kind: "artifact",
          id: input.geometryModule.artifactId,
        },
      },
    }],
  });
  assertEquals(result.work.operation, result.operation);
  if (!("append" in result.next)) {
    throw new Error("Expected fallback review to append its bounded plan leaf.");
  }
  assertEquals(
    result.next.append.arguments.commandId,
    "append-assembly-integrity-aaaaaaaaaaaaaaaa-r12",
  );
  assertEquals(result.next.append.arguments.projectId, input.projectId);
  assertEquals(result.next.append.arguments.expectedRevision, 24);
  assertEquals(result.next.append.arguments.workItems[0]?.operation, result.operation);
  assertEquals("queue" in result.next, false);
  assertEquals(
    parseAssemblyIntegrityObservationAdmissionParameters(result.decisionParameters),
    result.admission,
  );
  assertEquals(
    result.decisionParameters.some((parameter) =>
      parameter.key === "verify.assemblyIntegrity.observation.observer.profile.id"
    ),
    true,
  );
  assertEquals(
    result.decisionParameters.some((parameter) =>
      parameter.key.includes("provider") || parameter.key.includes("runtime")
    ),
    false,
  );
});

Deno.test("assembly-integrity review leaves a non-current or non-primary exact resolution unresolved", async () => {
  const input = command();
  const resolver = new FakeResolver({
    status: "unresolved",
    diagnostics: [{
      code: "geometry-module-not-primary",
      artifactId: input.geometryModule.artifactId,
      message: "The named geometry module is not the unique primary geometry module.",
    }],
  });
  const service = new PrepareProjectAssemblyIntegrityReview({ resolver });

  const unresolved = await service.execute(input);
  assertEquals(unresolved.status, "unresolved");
  assertEquals(unresolved.basis, input.basis);
  assertEquals(unresolved.geometryModule, input.geometryModule);
  assertEquals(unresolved.diagnostics[0]?.code, "geometry-module-not-primary");
  assertEquals("next" in unresolved, false);

  const divergent = structuredClone(admission(input)) as {
    basis: { revision: number };
  };
  divergent.basis.revision = 13;
  resolver.result = {
    status: "resolved",
    admission: divergent as never,
    expectedProjectRevision: 24,
  };
  const mismatch = await service.execute(input);
  assertEquals(mismatch.status, "unresolved");
  assertEquals(mismatch.diagnostics[0]?.code, "review-resolution-mismatch");
});

Deno.test("assembly-integrity review proposes a structurally selected planned leaf without appending another", async () => {
  const input = command();
  const resolver = new FakeResolver({
    status: "resolved",
    admission: admission(input),
    expectedProjectRevision: 24,
    existingWork: {
      phaseId: "verify-assembly-current",
      workItemId: "observe-assembly-current",
      decision: {
        id: "review-assembly-current",
        title: "Approve factual assembly observation",
        question: "May this exact factual observation be dispatched?",
      },
      gateClaims: [{
        gateItemId: "verification-activity-current-assembly",
        role: "contributes-to",
        status: "current",
      }],
    },
  });

  const result = await new PrepareProjectAssemblyIntegrityReview({ resolver })
    .execute(input);
  if (result.status !== "resolved") throw new Error("Expected resolved review.");

  assertEquals("append" in result.next, false);
  assertEquals(result.next.propose.arguments.decisionId, "review-assembly-current");
  assertEquals(result.work, {
    phaseId: "verify-assembly-current",
    workItemId: "observe-assembly-current",
    operation: result.operation,
    gateClaims: [{
      gateItemId: "verification-activity-current-assembly",
      role: "contributes-to",
      status: "current",
    }],
  });
  assertEquals(result.decision.decisionId, "review-assembly-current");
  assertEquals(result.grants, "none");
});

Deno.test("assembly-integrity review refuses closed-command extras, latest aliases, and geometry aliases before resolving", async () => {
  const input = command();
  const resolver = new FakeResolver({
    status: "resolved",
    admission: admission(input),
    expectedProjectRevision: 24,
  });
  const service = new PrepareProjectAssemblyIntegrityReview({ resolver });

  for (
    const field of [
      "provider",
      "tool",
      "profile",
      "runtime",
      "children",
      "transform",
      "tolerance",
    ]
  ) {
    await assertRejects(
      () => service.execute({ ...input, [field]: "caller-selected" }),
      ProjectAssemblyIntegrityReviewError,
    );
  }
  await assertRejects(
    () =>
      service.execute({
        ...input,
        basis: { ...input.basis, snapshotId: "LATEST" },
      }),
    ProjectAssemblyIntegrityReviewError,
  );
  await assertRejects(
    () => service.execute({ ...input, projectId: "LATEST" }),
    ProjectAssemblyIntegrityReviewError,
  );
  await assertRejects(
    () =>
      service.execute({
        ...input,
        geometryModule: { ...input.geometryModule, artifactId: "geometry-latest" },
      }),
    ProjectAssemblyIntegrityReviewError,
  );
  assertEquals(resolver.calls, []);
});

Deno.test("assembly-integrity review reports an unavailable exact resolver without a next hop", async () => {
  const input = command();
  const resolver = new FakeResolver({
    status: "unavailable",
    diagnostics: [{
      code: "basis-not-current",
      artifactId: null,
      message: "The named basis is not the exact current Thread basis.",
    }],
  });
  const result: ProjectAssemblyIntegrityReviewResult =
    await new PrepareProjectAssemblyIntegrityReview({
      resolver,
    }).execute(input);

  assertEquals(result.status, "unavailable");
  assertEquals(result.grants, "none");
  assertEquals("operation" in result, false);
});
