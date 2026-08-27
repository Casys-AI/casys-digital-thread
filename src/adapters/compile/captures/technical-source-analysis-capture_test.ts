import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "@std/assert";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type {
  SourceAnalysisFrontend,
  SourceAnalysisFrontendInput,
} from "../../../domain/compile/source/source-analysis-frontend.ts";
import type {
  SourceAnalysisBundle,
  SourceAnalysisLanguage,
  SourceAnalysisSourceRole,
} from "../../../domain/compile/source/source-analysis.ts";
import {
  PYTHON_CAD_SOURCE_ANALYSIS_PROFILE,
  PYTHON_CAD_SOURCE_ANALYZER_ID,
  PYTHON_CAD_SOURCE_ANALYZER_VERSION,
  PythonCadSourceAnalyzer,
} from "../../cad/source/python-cad-source-analyzer.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import { technicalSourceCaptureInput } from "../../../testing/technical-source-capture-test-support.ts";
import {
  fingerprintTechnicalSourceAnalysisProfile,
  FixedTechnicalSourceAnalysisProfileRegistry,
  MAX_TECHNICAL_SOURCE_PROFILE_BYTES,
  TechnicalSourceAnalysisCaptureError,
  TechnicalSourceAnalysisCaptureService,
  type TechnicalSourceAnalysisProfile,
  TechnicalSourceAnalysisProfileNotRegisteredError,
  type TechnicalSourceAnalysisProfileRegistration,
  validateTechnicalSourceAnalysisCaptureDocument,
  validateTechnicalSourceAnalysisProfile,
} from "./technical-source-analysis-capture.ts";

const SOURCE_TEXT = "from build123d import Box\nresult = Box(1, 2, 3)\n";

const PYTHON_PROFILE: TechnicalSourceAnalysisProfile = {
  id: PYTHON_CAD_SOURCE_ANALYSIS_PROFILE,
  version: "1.0.0",
  role: "cad-script",
  language: "python",
  analyzer: {
    id: PYTHON_CAD_SOURCE_ANALYZER_ID,
    version: PYTHON_CAD_SOURCE_ANALYZER_VERSION,
  },
  maxSourceBytes: 262_144,
};

Deno.test("technical source capture persists exact Python bytes and replays the registered frontend", async () => {
  await withHarness(async (harness) => {
    let frontendCalls = 0;
    let sourceExistedBeforeAnalysis = false;
    const parser = new PythonCadSourceAnalyzer();
    const frontend: SourceAnalysisFrontend = {
      analyze: async (input) => {
        frontendCalls++;
        sourceExistedBeforeAnalysis = sourceExistedBeforeAnalysis ||
          await directoryHasFile(harness.sourceDirectory);
        return await parser.analyze(input);
      },
    };
    const service = harness.service([{
      profile: PYTHON_PROFILE,
      frontend,
    }]);

    const persisted = await service.persist(technicalSourceCaptureInput({
      profileId: PYTHON_PROFILE.id,
      sourceId: "source:cad:assembly",
      sourceText: SOURCE_TEXT,
    }));

    assertEquals(sourceExistedBeforeAnalysis, true);
    // Capture analyses once, replays once, then persist reopens the locator.
    assertEquals(frontendCalls, 3);
    assertEquals(persisted.document.source.role, "cad-script");
    assertEquals(persisted.document.source.language, "python");
    assertEquals(persisted.document.analysis.analyzer, PYTHON_PROFILE.analyzer);
    assertEquals(persisted.document.analysis.policy, {
      profile: PYTHON_PROFILE.id,
      status: "passed",
    });
    assertEquals(
      persisted.document.source.casUri,
      `casys://technical-source-test/sha256/${persisted.document.source.sha256}`,
    );
    assertEquals(
      persisted.document.analysis.casUri,
      `casys://technical-source-analysis-test/sha256/${persisted.document.analysis.sha256}`,
    );

    const sourceBytes = await harness.sourceCaptures.read({
      algorithm: "sha256",
      digest: persisted.document.source.sha256,
    });
    assertEquals(sourceBytes?.copy(), new TextEncoder().encode(SOURCE_TEXT));
    assertEquals(sourceBytes?.byteLength, persisted.document.source.byteCount);

    const reopened = await service.reopenLocator(persisted.locator);
    assertEquals(frontendCalls, 4);
    assertEquals(reopened.sourceText, SOURCE_TEXT);
    assertEquals(reopened.analysis.source.id, persisted.document.source.id);
    assertEquals(reopened.locator, persisted.locator);
  });
});

Deno.test("technical source byte cap accepts N and rejects N plus one before CAS or analysis", async () => {
  const profile: TechnicalSourceAnalysisProfile = {
    ...PYTHON_PROFILE,
    id: "python-byte-cap-v1",
    maxSourceBytes: 8,
  };

  await withHarness(async (harness) => {
    let frontendCalls = 0;
    const delegate = fixedFrontend(profile);
    const frontend: SourceAnalysisFrontend = {
      analyze: (input) => {
        frontendCalls++;
        return delegate.analyze(input);
      },
    };
    const service = harness.service([{ profile, frontend }]);
    const persisted = await service.persist(technicalSourceCaptureInput({
      profileId: profile.id,
      sourceId: "source:cap:exact",
      sourceText: "12345678",
    }));

    assertEquals(persisted.document.source.byteCount, 8);
    assertEquals(frontendCalls, 3);
    assertEquals(await directoryFileCount(harness.sourceDirectory), 1);
    assertEquals(await directoryFileCount(harness.analysisDirectory), 1);
  });

  await withHarness(async (harness) => {
    let frontendCalls = 0;
    const delegate = fixedFrontend(profile);
    const frontend: SourceAnalysisFrontend = {
      analyze: (input) => {
        frontendCalls++;
        return delegate.analyze(input);
      },
    };
    const service = harness.service([{ profile, frontend }]);
    const error = await assertRejects(
      () =>
        service.capture(technicalSourceCaptureInput({
          profileId: profile.id,
          sourceId: "source:cap:oversize",
          sourceText: "123456789",
        })),
      TechnicalSourceAnalysisCaptureError,
    );

    assertEquals(error.code, "source_size_limit_exceeded");
    assertEquals(error.reference, undefined);
    assertEquals(frontendCalls, 0);
    assertEquals(await directoryFileCount(harness.sourceDirectory), 0);
    assertEquals(await directoryFileCount(harness.analysisDirectory), 0);
  });
});

Deno.test("technical source cap counts exact UTF-8 bytes for multibyte text", async () => {
  const profile: TechnicalSourceAnalysisProfile = {
    ...PYTHON_PROFILE,
    id: "python-utf8-byte-cap-v1",
    maxSourceBytes: 4,
  };

  await withHarness(async (harness) => {
    const service = harness.service([{
      profile,
      frontend: fixedFrontend(profile),
    }]);
    const persisted = await service.persist(technicalSourceCaptureInput({
      profileId: profile.id,
      sourceId: "source:cap:utf8-exact",
      sourceText: "éé",
    }));
    assertEquals(persisted.document.source.byteCount, 4);
  });

  await withHarness(async (harness) => {
    let frontendCalls = 0;
    const delegate = fixedFrontend(profile);
    const service = harness.service([{
      profile,
      frontend: {
        analyze: (input) => {
          frontendCalls++;
          return delegate.analyze(input);
        },
      },
    }]);
    const error = await assertRejects(
      () =>
        service.capture(technicalSourceCaptureInput({
          profileId: profile.id,
          sourceId: "source:cap:utf8-oversize",
          sourceText: "ééa",
        })),
      TechnicalSourceAnalysisCaptureError,
    );
    assertEquals(error.code, "source_size_limit_exceeded");
    assertEquals(frontendCalls, 0);
    assertEquals(await directoryFileCount(harness.sourceDirectory), 0);
    assertEquals(await directoryFileCount(harness.analysisDirectory), 0);
  });
});

Deno.test("technical source profile cap is bounded and sealed into its fingerprint", async () => {
  for (const maxSourceBytes of [0, -1, 1.5, MAX_TECHNICAL_SOURCE_PROFILE_BYTES + 1]) {
    assertThrows(
      () =>
        validateTechnicalSourceAnalysisProfile({
          ...PYTHON_PROFILE,
          maxSourceBytes,
        }),
      TypeError,
      "maxSourceBytes",
    );
  }
  assertEquals(
    validateTechnicalSourceAnalysisProfile({
      ...PYTHON_PROFILE,
      maxSourceBytes: MAX_TECHNICAL_SOURCE_PROFILE_BYTES,
    }).maxSourceBytes,
    MAX_TECHNICAL_SOURCE_PROFILE_BYTES,
  );
  assertEquals(
    (await fingerprintTechnicalSourceAnalysisProfile({
      ...PYTHON_PROFILE,
      maxSourceBytes: 8,
    })).digest ===
      (await fingerprintTechnicalSourceAnalysisProfile({
        ...PYTHON_PROFILE,
        maxSourceBytes: 9,
      })).digest,
    false,
  );
  const loweringPolicy = {
    schemaVersion: "build123d-workspace-closure-lowering/1.0" as const,
    kind: "build123d-workspace-closure-lowering" as const,
    maxClosureFiles: 2,
    maxClosureSourceBytes: 16,
    maxEffectiveScriptBytes: 24,
  };
  assertEquals(
    validateTechnicalSourceAnalysisProfile({
      ...PYTHON_PROFILE,
      workspaceClosureLowering: loweringPolicy,
    }).workspaceClosureLowering?.maxEffectiveScriptBytes,
    24,
  );
  assertEquals(
    (await fingerprintTechnicalSourceAnalysisProfile({
      ...PYTHON_PROFILE,
      workspaceClosureLowering: loweringPolicy,
    })).digest ===
      (await fingerprintTechnicalSourceAnalysisProfile({
        ...PYTHON_PROFILE,
        workspaceClosureLowering: {
          ...loweringPolicy,
          maxEffectiveScriptBytes: 25,
        },
      })).digest,
    false,
  );
  assertThrows(
    () =>
      validateTechnicalSourceAnalysisProfile({
        ...PYTHON_PROFILE,
        workspaceClosureLowering: {
          ...loweringPolicy,
          maxEffectiveScriptBytes: MAX_TECHNICAL_SOURCE_PROFILE_BYTES + 1,
        },
      }),
    TypeError,
    "maxEffectiveScriptBytes",
  );
});

Deno.test("technical source replay rejects raw source byte drift", async () => {
  await withHarness(async (harness) => {
    const service = harness.service([pythonRegistration()]);
    const persisted = await service.persist(technicalSourceCaptureInput({
      profileId: PYTHON_PROFILE.id,
      sourceId: "source:cad:drift",
      sourceText: SOURCE_TEXT,
    }));
    await Deno.writeFile(
      `${harness.sourceDirectory}/${persisted.document.source.sha256}`,
      new TextEncoder().encode(`${SOURCE_TEXT}# drift\n`),
    );

    const error = await assertRejects(
      () => service.reopenLocator(persisted.locator),
      TechnicalSourceAnalysisCaptureError,
    );
    assertInstanceOf(error, TechnicalSourceAnalysisCaptureError);
    assertEquals(error.code, "source_capture_invalid");
  });
});

Deno.test("technical source replay rejects locator CAS tampering", async () => {
  await withHarness(async (harness) => {
    const service = harness.service([pythonRegistration()]);
    const persisted = await service.persist(technicalSourceCaptureInput({
      profileId: PYTHON_PROFILE.id,
      sourceId: "source:cad:locator-tamper",
      sourceText: SOURCE_TEXT,
    }));
    await Deno.writeTextFile(
      `${harness.captureDirectory}/${persisted.locator.fingerprint.digest}`,
      "{}",
    );
    const error = await assertRejects(
      () => service.reopenLocator(persisted.locator),
      TechnicalSourceAnalysisCaptureError,
    );
    assertEquals(error.code, "locator_cas_tampered");
  });
});

Deno.test("technical source replay rejects analysis CAS tampering", async () => {
  await withHarness(async (harness) => {
    const service = harness.service([pythonRegistration()]);
    const persisted = await service.persist(technicalSourceCaptureInput({
      profileId: PYTHON_PROFILE.id,
      sourceId: "source:cad:analysis-tamper",
      sourceText: SOURCE_TEXT,
    }));
    await Deno.writeFile(
      `${harness.analysisDirectory}/${persisted.document.analysis.sha256}`,
      new TextEncoder().encode("{}"),
    );

    const error = await assertRejects(
      () => service.reopenLocator(persisted.locator),
      TechnicalSourceAnalysisCaptureError,
    );
    assertInstanceOf(error, TechnicalSourceAnalysisCaptureError);
    assertEquals(error.code, "analysis_capture_invalid");
  });
});

Deno.test("technical source capture rejects analyzer and policy-profile mismatches before analysis persistence", async () => {
  for (const mismatch of ["analyzer", "policy"] as const) {
    await withHarness(async (harness) => {
      const frontend = fixedFrontend(PYTHON_PROFILE, "passed", mismatch);
      const service = harness.service([{ profile: PYTHON_PROFILE, frontend }]);

      const error = await assertRejects(
        () =>
          service.capture(technicalSourceCaptureInput({
            profileId: PYTHON_PROFILE.id,
            sourceId: `source:cad:mismatch:${mismatch}`,
            sourceText: SOURCE_TEXT,
          })),
        TechnicalSourceAnalysisCaptureError,
      );
      assertInstanceOf(error, TechnicalSourceAnalysisCaptureError);
      assertEquals(error.code, "analysis_identity_mismatch");
      assertEquals(await directoryFileCount(harness.analysisDirectory), 0);
      assertEquals(await directoryFileCount(harness.sourceDirectory), 1);
    });
  }
});

Deno.test("technical source capture refuses an unregistered caller profile", async () => {
  await withHarness(async (harness) => {
    const service = harness.service([]);

    await assertRejects(
      () =>
        service.capture(technicalSourceCaptureInput({
          profileId: PYTHON_PROFILE.id,
          sourceId: "source:cad:unregistered",
          sourceText: SOURCE_TEXT,
        })),
      TechnicalSourceAnalysisProfileNotRegisteredError,
      PYTHON_PROFILE.id,
    );
    assertEquals(await directoryFileCount(harness.sourceDirectory), 0);
    assertEquals(await directoryFileCount(harness.analysisDirectory), 0);
  });
});

Deno.test("technical source capture persists a rejected policy before returning its evidence reference", async () => {
  await withHarness(async (harness) => {
    const service = harness.service([{
      profile: PYTHON_PROFILE,
      frontend: fixedFrontend(PYTHON_PROFILE, "rejected"),
    }]);

    const error = await assertRejects(
      () =>
        service.capture(technicalSourceCaptureInput({
          profileId: PYTHON_PROFILE.id,
          sourceId: "source:cad:rejected",
          sourceText: SOURCE_TEXT,
        })),
      TechnicalSourceAnalysisCaptureError,
    );
    assertInstanceOf(error, TechnicalSourceAnalysisCaptureError);
    assertEquals(error.code, "analysis_rejected");
    assertEquals(
      typeof error.reference === "object" && error.reference !== null,
      true,
    );
    const replayError = await assertRejects(
      () => service.reopenLocator(error.reference),
      TechnicalSourceAnalysisCaptureError,
    );
    assertEquals(replayError.code, "analysis_rejected");
    const rejected = await service.reopenLocator(error.reference, true);
    assertEquals(rejected.analysis.policy.status, "rejected");
  });
});

Deno.test("technical source reference and capture input reject unknown fields", async () => {
  await withHarness(async (harness) => {
    const service = harness.service([pythonRegistration()]);
    const persisted = await service.persist(technicalSourceCaptureInput({
      profileId: PYTHON_PROFILE.id,
      sourceId: "source:cad:closed-schema",
      sourceText: SOURCE_TEXT,
    }));

    await assertRejects(
      () =>
        validateTechnicalSourceAnalysisCaptureDocument({
          ...persisted.document,
          callerTool: "calculix.run",
        }),
      TypeError,
      "unsupported field callerTool",
    );
    await assertRejects(
      () =>
        validateTechnicalSourceAnalysisCaptureDocument({
          ...persisted.document,
          source: { ...persisted.document.source, providerArgs: ["--unsafe"] },
        }),
      TypeError,
      "unsupported field providerArgs",
    );
    await assertRejects(
      () =>
        service.capture({
          profileId: PYTHON_PROFILE.id,
          sourceId: "source:cad:extra-input",
          sourceText: SOURCE_TEXT,
          toolName: "arbitrary-provider",
        } as never),
      TypeError,
      "unsupported field toolName",
    );
  });
});

Deno.test("technical source capture is deterministic for the same exact profile, identity, and bytes", async () => {
  await withHarness(async (harness) => {
    const service = harness.service([pythonRegistration()]);
    const input = technicalSourceCaptureInput({
      profileId: PYTHON_PROFILE.id,
      sourceId: "source:cad:deterministic",
      sourceText: SOURCE_TEXT,
    });

    const first = await service.capture(input);
    const second = await service.capture(input);

    assertEquals(second, first);
    assertEquals(deterministicJson(second), deterministicJson(first));
    assertEquals(await directoryFileCount(harness.sourceDirectory), 1);
    assertEquals(await directoryFileCount(harness.analysisDirectory), 1);
  });
});

Deno.test("technical source profiles accept only Python CAD, Modelica, and circuit-only SPICE pairs", async () => {
  const frontend = fixedFrontend(PYTHON_PROFILE);
  const invalidProfiles = [
    {
      ...PYTHON_PROFILE,
      id: "forbidden-brief",
      role: "brief",
      language: "plain-text",
    },
    {
      ...PYTHON_PROFILE,
      id: "forbidden-calculix",
      role: "calculix-input",
      language: "calculix-inp",
    },
    {
      ...PYTHON_PROFILE,
      id: "forbidden-pair",
      role: "cad-script",
      language: "modelica",
    },
  ];

  for (const profile of invalidProfiles) {
    assertThrows(
      () => {
        new FixedTechnicalSourceAnalysisProfileRegistry([{
          profile,
          frontend,
        } as unknown as TechnicalSourceAnalysisProfileRegistration]);
      },
      TypeError,
      "cad-script/python, modelica-model/modelica, or spice-circuit/spice",
    );
  }

  const modelicaProfile: TechnicalSourceAnalysisProfile = {
    id: "modelica-conservative-v1",
    version: "1.0.0",
    role: "modelica-model",
    language: "modelica",
    analyzer: { id: "modelica-parser", version: "1.0.0" },
    maxSourceBytes: 262_144,
  };
  await withHarness(async (harness) => {
    const service = harness.service([{
      profile: modelicaProfile,
      frontend: fixedFrontend(modelicaProfile),
    }]);
    const persisted = await service.persist(technicalSourceCaptureInput({
      profileId: modelicaProfile.id,
      sourceId: "source:modelica:thermal",
      sourceText: "model Thermal\n  Real t;\nend Thermal;\n",
    }));
    assertEquals(persisted.document.source.role, "modelica-model");
    assertEquals(persisted.document.source.language, "modelica");
  });

  const spiceProfile: TechnicalSourceAnalysisProfile = {
    id: "spice-circuit-closed-subset-v1",
    version: "1.0.0",
    role: "spice-circuit",
    language: "spice",
    analyzer: { id: "spice-circuit-closed-subset", version: "1.0.0" },
    maxSourceBytes: 262_144,
  };
  await withHarness(async (harness) => {
    const service = harness.service([{
      profile: spiceProfile,
      frontend: fixedFrontend(spiceProfile),
    }]);
    const persisted = await service.persist(technicalSourceCaptureInput({
      profileId: spiceProfile.id,
      sourceId: "source:spice:clamp",
      sourceText: "Vin in 0 5\nRload in 0 1k\n",
    }));
    assertEquals(persisted.document.source.role, "spice-circuit");
    assertEquals(persisted.document.source.language, "spice");
  });
});

function pythonRegistration(): TechnicalSourceAnalysisProfileRegistration {
  return {
    profile: PYTHON_PROFILE,
    frontend: new PythonCadSourceAnalyzer(),
  };
}

function fixedFrontend(
  profile: TechnicalSourceAnalysisProfile,
  status: "passed" | "rejected" = "passed",
  mismatch?: "analyzer" | "policy",
): SourceAnalysisFrontend {
  return {
    analyze: async (input) => {
      const bundle = await fixedBundle(profile, input, status);
      if (mismatch === "analyzer") {
        return {
          ...bundle,
          analyzer: { ...bundle.analyzer, version: "different" },
        };
      }
      if (mismatch === "policy") {
        return {
          ...bundle,
          policy: { ...bundle.policy, profile: "different-policy" },
        };
      }
      return bundle;
    },
  };
}

async function fixedBundle(
  profile: TechnicalSourceAnalysisProfile,
  input: SourceAnalysisFrontendInput,
  status: "passed" | "rejected",
): Promise<SourceAnalysisBundle> {
  return {
    schemaVersion: "source-analysis/1.0",
    source: {
      id: input.sourceId,
      role: input.role,
      language: input.language,
      fingerprint: await utf8Fingerprint(input.sourceText),
    },
    analyzer: profile.analyzer,
    policy: {
      profile: profile.id,
      status,
      findings: status === "rejected"
        ? [{
          id: "finding:rejected",
          code: "source-rejected",
          severity: "error",
          message: "Rejected by the registered technical source policy.",
        }]
        : [],
    },
    symbols: [],
    dependencies: [],
    unresolvedConstructs: [],
  };
}

async function utf8Fingerprint(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return {
    algorithm: "sha256" as const,
    digest: [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  };
}

interface Harness {
  readonly sourceCaptures: FileByteStore<"technical-source">;
  readonly analysisCaptures: FileByteStore<"technical-source-analysis">;
  readonly captureDocuments: FileByteStore<"technical-source-analysis-capture">;
  readonly sourceDirectory: string;
  readonly analysisDirectory: string;
  readonly captureDirectory: string;
  service(
    registrations: readonly TechnicalSourceAnalysisProfileRegistration[],
  ): TechnicalSourceAnalysisCaptureService;
}

async function withHarness(
  action: (harness: Harness) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({
    prefix: "technical-source-analysis-",
  });
  const sourceDirectory = `${directory}/sources`;
  const analysisDirectory = `${directory}/analyses`;
  const captureDirectory = `${directory}/capture-documents`;
  try {
    const sourceCaptures = new FileByteStore({
      kind: "technical-source",
      directory: sourceDirectory,
      uriNamespace: "technical-source-test",
      label: "Technical source test",
    });
    const analysisCaptures = new FileByteStore({
      kind: "technical-source-analysis",
      directory: analysisDirectory,
      uriNamespace: "technical-source-analysis-test",
      label: "Technical source analysis test",
    });
    const captureDocuments = new FileByteStore({
      kind: "technical-source-analysis-capture",
      directory: captureDirectory,
      uriNamespace: "technical-source-analysis-capture",
      label: "Technical source capture document test",
    });
    await action({
      sourceCaptures,
      analysisCaptures,
      captureDocuments,
      sourceDirectory,
      analysisDirectory,
      captureDirectory,
      service: (registrations) =>
        new TechnicalSourceAnalysisCaptureService({
          sourceCaptures,
          analysisCaptures,
          captureDocuments,
          profiles: new FixedTechnicalSourceAnalysisProfileRegistry(
            registrations,
          ),
        }),
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function directoryHasFile(directory: string): Promise<boolean> {
  return await directoryFileCount(directory) > 0;
}

async function directoryFileCount(directory: string): Promise<number> {
  try {
    let count = 0;
    for await (const entry of Deno.readDir(directory)) {
      if (entry.isFile) count++;
    }
    return count;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return 0;
    throw error;
  }
}

// Compile-time proof that broad domain roles do not leak into the profile type.
const _ROLE_TYPE_ASSERTION: TechnicalSourceAnalysisProfile["role"] =
  "cad-script" satisfies SourceAnalysisSourceRole;
const _LANGUAGE_TYPE_ASSERTION: TechnicalSourceAnalysisProfile["language"] =
  "python" satisfies SourceAnalysisLanguage;
const _SPICE_ROLE_TYPE_ASSERTION: TechnicalSourceAnalysisProfile["role"] =
  "spice-circuit" satisfies SourceAnalysisSourceRole;
const _SPICE_LANGUAGE_TYPE_ASSERTION: TechnicalSourceAnalysisProfile["language"] =
  "spice" satisfies SourceAnalysisLanguage;
