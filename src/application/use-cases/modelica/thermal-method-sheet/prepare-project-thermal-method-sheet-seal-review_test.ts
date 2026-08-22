import { assertEquals, assertRejects } from "@std/assert";
import type { TechnicalCompilationBasis } from "../../../../domain/compile/admission/technical-compilation.ts";
import { fingerprintModelicaThermalMethodSheet } from "../../../../domain/modelica/thermal-method-sheet.ts";
import { parseThermalMethodSheetSealParameters } from "../../../../domain/modelica/thermal-method-sheet-proposal.ts";
import type { ThermalMethodSheetSourceIdentity } from "../../../../domain/modelica/thermal-method-sheet-recross.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import { validThermalMethodSheetPlaceholder } from "../../../../testing/modelica-thermal-method-sheet-fixtures.ts";
import { validateModelicaThermalMethodSheet } from "../../../../domain/modelica/thermal-method-sheet.ts";
import type { ThermalMethodSheetStore } from "../../../ports/out/modelica/thermal-method-sheet-store.ts";
import type { ThermalMethodSheetSourceCaptureReader } from "../../../ports/out/modelica/thermal-method-sheet-source-capture-reader.ts";
import type { TechnicalCompilationBasisResolver } from "../../../ports/out/compile/admission/technical-compilation-basis-resolver.ts";
import {
  PrepareProjectThermalMethodSheetSealReview,
  ProjectThermalMethodSheetSealReviewError,
} from "./prepare-project-thermal-method-sheet-seal-review.ts";

const PROJECT_ID = "articulated-led-desk-lamp";
const BASIS_FINGERPRINT = hash("b");
const SOURCE_FINGERPRINT = hash("c");

Deno.test(
  "thermal method-sheet seal review derives canonical MRTR from exact recross",
  async () => {
    const fixture = await harness();
    const result = await fixture.service.execute(fixture.command);
    const replay = parseThermalMethodSheetSealParameters(result.decisionParameters);
    assertEquals(result.admission, replay);
    assertEquals(result.admission.projectId, PROJECT_ID);
    assertEquals(result.admission.sheetId, fixture.sheet.id);
    assertEquals(result.admission.model.moduleName, "placeholder-module");
    assertEquals(
      result.admission.model.sourceCaptureFingerprint,
      SOURCE_FINGERPRINT,
    );
  },
);

Deno.test("thermal method-sheet seal review rejects a missing sheet", async () => {
  const fixture = await harness();
  fixture.sheets.missing = true;
  await assertRejects(
    () => fixture.service.execute(fixture.command),
    ProjectThermalMethodSheetSealReviewError,
    "unavailable",
  );
});

Deno.test(
  "thermal method-sheet seal review rejects an unavailable Modelica source capture",
  async () => {
    const fixture = await harness();
    fixture.sources.missing = true;
    await assertRejects(
      () => fixture.service.execute(fixture.command),
      ProjectThermalMethodSheetSealReviewError,
      "unavailable",
    );
  },
);

Deno.test(
  "thermal method-sheet seal review refuses a non-Modelica source capture",
  async () => {
    const fixture = await harness();
    fixture.sources.foreign = true;
    await assertRejects(
      () => fixture.service.execute(fixture.command),
      ProjectThermalMethodSheetSealReviewError,
      "modelica-model",
    );
  },
);

Deno.test(
  "thermal method-sheet seal review leaves a missing AttributeUsage unresolved",
  async () => {
    const fixture = await harness();
    fixture.basis.elements = [{
      id: "placeholder-requirement",
      kind: "RequirementUsage",
      provenance: provenance(),
    }];
    await assertRejects(
      () => fixture.service.execute(fixture.command),
      ProjectThermalMethodSheetSealReviewError,
      "unresolved",
    );
  },
);

Deno.test(
  "thermal method-sheet seal review refuses a Thread fingerprint mismatch",
  async () => {
    const fixture = await harness();
    fixture.basis.snapshotFingerprint = hash("z");
    await assertRejects(
      () => fixture.service.execute(fixture.command),
      ProjectThermalMethodSheetSealReviewError,
      "exact identity",
    );
  },
);

Deno.test(
  "thermal method-sheet seal review rejects caller-selected Modelica text",
  async () => {
    const fixture = await harness();
    await assertRejects(
      () =>
        fixture.service.execute({
          ...fixture.command,
          modelicaText: "model Forbidden end Forbidden;",
        }),
      ProjectThermalMethodSheetSealReviewError,
      "exact validation",
    );
  },
);

async function harness() {
  const input = validThermalMethodSheetPlaceholder();
  (input.basis as { fingerprint: ContentFingerprint }).fingerprint = BASIS_FINGERPRINT;
  (input.model as { sourceCaptureFingerprint: ContentFingerprint })
    .sourceCaptureFingerprint = SOURCE_FINGERPRINT;
  const sheet = validateModelicaThermalMethodSheet(input);
  const sheetFingerprint = await fingerprintModelicaThermalMethodSheet(sheet);
  const sheets = new MemorySheetStore(sheet, sheetFingerprint);
  const sources = new MemorySourceReader(SOURCE_FINGERPRINT);
  const basis = new MemoryBasisResolver();
  const service = new PrepareProjectThermalMethodSheetSealReview({
    sheets,
    sourceCaptures: sources,
    basisResolver: basis,
  });
  return {
    service,
    command: { projectId: PROJECT_ID, sheetFingerprint },
    sheet,
    sheets,
    sources,
    basis,
  };
}

class MemorySheetStore implements ThermalMethodSheetStore {
  missing = false;
  constructor(
    readonly sheet: ReturnType<typeof validateModelicaThermalMethodSheet>,
    readonly fingerprint: ContentFingerprint,
  ) {}
  save() {
    return Promise.reject(new Error("review must not persist sheets"));
  }
  read(fingerprint: ContentFingerprint) {
    if (this.missing || fingerprint.digest !== this.fingerprint.digest) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.sheet);
  }
}

class MemorySourceReader implements ThermalMethodSheetSourceCaptureReader {
  missing = false;
  foreign = false;
  constructor(readonly fingerprint: ContentFingerprint) {}
  read(
    fingerprint: ContentFingerprint,
  ): Promise<ThermalMethodSheetSourceIdentity | undefined> {
    if (this.missing) return Promise.resolve(undefined);
    if (this.foreign) {
      return Promise.reject(
        new TypeError(
          "The named source capture is not an exact modelica-model capture.",
        ),
      );
    }
    return Promise.resolve({
      fingerprint,
      role: "modelica-model",
      language: "modelica",
      symbols: [
        {
          id: "placeholder-parameter",
          kind: "parameter",
          name: "placeholder-parameter",
        },
        { id: "placeholder-output", kind: "variable", name: "placeholder-output" },
      ],
    });
  }
}

class MemoryBasisResolver implements TechnicalCompilationBasisResolver {
  missing = false;
  snapshotFingerprint: ContentFingerprint = BASIS_FINGERPRINT;
  elements: TechnicalCompilationBasis["sysmlAnchor"]["elements"] = [
    {
      id: "placeholder-attribute-usage",
      kind: "AttributeUsage",
      provenance: provenance(),
    },
    {
      id: "placeholder-requirement",
      kind: "RequirementUsage",
      provenance: provenance(),
    },
  ];

  resolve(): Promise<TechnicalCompilationBasis | undefined> {
    if (this.missing) return Promise.resolve(undefined);
    return Promise.resolve({
      thread: {
        projectId: PROJECT_ID,
        subjectId: PROJECT_ID,
        snapshotId: "placeholder-thread-snapshot",
        revision: 1,
        snapshotFingerprint: this.snapshotFingerprint,
      },
      sysmlAnchor: {
        artifactId: "artifact.architecture",
        artifactFingerprint: hash("a"),
        captureId: "a".repeat(64),
        editingContextId: "editing.context",
        rootElementId: "pkg",
        rootElementKind: "Package",
        elements: this.elements,
      },
      sysmlAnchorFingerprint: hash("s"),
    });
  }
}

function provenance(): TechnicalCompilationBasis["sysmlAnchor"]["elements"][number][
  "provenance"
] {
  return {
    artifactId: "artifact.architecture",
    artifactFingerprint: hash("a"),
    captureId: "a".repeat(64),
  };
}

function hash(digit: string): ContentFingerprint {
  return { algorithm: "sha256", digest: digit.repeat(64) };
}
