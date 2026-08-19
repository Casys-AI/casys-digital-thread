import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertStringIncludes,
} from "@std/assert";
import type { IsolatedCodeOutputDeclaration } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  OcctStepOutputValidationError,
  OcctStepOutputValidator,
} from "./occt-step-output-validator.ts";

const encoder = new TextEncoder();

Deno.test("OCCT STEP output validation enforces the exact registered declaration before parsing", async () => {
  let factoryCalls = 0;
  const validator = new OcctStepOutputValidator(() => {
    factoryCalls += 1;
    return acceptedReader();
  });
  const variants: IsolatedCodeOutputDeclaration[] = [
    { ...declaration(), role: "mesh" },
    { ...declaration(), basename: "other.step" },
    { ...declaration(), mediaType: "application/step" },
    { ...declaration(), format: "step-ap242" },
  ];

  for (const variant of variants) {
    await expectCode(
      () => validator.validateOutput(variant, ap214Bytes()),
      "unsupported_output_contract",
    );
  }
  assertEquals(factoryCalls, 0);
});

Deno.test("OCCT STEP output validation rejects empty bytes and non-AP214 headers before parsing", async () => {
  let factoryCalls = 0;
  const validator = new OcctStepOutputValidator(() => {
    factoryCalls += 1;
    return acceptedReader();
  });

  await expectCode(
    () => validator.validateOutput(declaration(), new Uint8Array()),
    "empty_output",
  );
  await expectCode(
    () => validator.validateOutput(declaration(), encoder.encode("garbage")),
    "invalid_step_header",
  );
  await expectCode(
    () => validator.validateOutput(declaration(), ap242Bytes()),
    "unsupported_step_schema",
  );
  await expectCode(
    () =>
      validator.validateOutput(
        declaration(),
        encoder.encode(
          "ISO-10303-21;HEADER;" +
            "FILE_DESCRIPTION(('FILE_SCHEMA((\u0027AUTOMOTIVE_DESIGN " +
            "{ 1 0 10303 214 1 1 1 1 }\u0027))'),'2;1');" +
            "FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF " +
            "{ 1 0 10303 442 1 1 4 }'));" +
            "ENDSEC;DATA;ENDSEC;END-ISO-10303-21;",
        ),
      ),
    "unsupported_step_schema",
  );
  assertEquals(factoryCalls, 0);
});

Deno.test("OCCT STEP output validation sends defensive bytes and millimetres to the injected parser", async () => {
  const source = ap214Bytes();
  let parserBytes: Uint8Array | undefined;
  let parserParameters: unknown;
  const validator = new OcctStepOutputValidator(() => ({
    ReadStepFile(bytes, parameters) {
      parserBytes = bytes;
      parserParameters = parameters;
      return meaningfulGeometry();
    },
  }));

  await validator.validateOutput(declaration(), source);

  assert(parserBytes !== undefined);
  assert(parserBytes !== source);
  assertEquals(parserBytes, source);
  assertEquals(parserParameters, { linearUnit: "millimeter" });
});

Deno.test("OCCT STEP output validation normalizes loader and parser failures", async () => {
  const unavailable = new OcctStepOutputValidator(() => {
    throw new Error("secret at /tmp/provider-token");
  });
  const unavailableError = await expectCode(
    () => unavailable.validateOutput(declaration(), ap214Bytes()),
    "parser_unavailable",
  );
  assertEquals(unavailableError.message, "The code-owned STEP parser is unavailable.");
  assert(!unavailableError.message.includes("/tmp"));
  assert(!unavailableError.message.includes("provider-token"));

  const parserFailure = new OcctStepOutputValidator(() => ({
    ReadStepFile() {
      throw new Error("native detail at /private/file.step");
    },
  }));
  const parserError = await expectCode(
    () => parserFailure.validateOutput(declaration(), ap214Bytes()),
    "parse_rejected",
  );
  assertEquals(
    parserError.message,
    "The code-owned STEP parser rejected the observed output.",
  );
  assert(!parserError.message.includes("/private"));
});

Deno.test("OCCT STEP output validation requires referenced non-degenerate geometry", async () => {
  const cases: unknown[] = [
    { success: false },
    { success: true, root: { meshes: [], children: [] }, meshes: [] },
    {
      success: true,
      root: { meshes: [], children: [] },
      meshes: [meaningfulMesh()],
    },
    {
      success: true,
      root: { meshes: [0], children: [] },
      meshes: [{
        attributes: { position: { array: [0, 0, 0, 1, 0, 0, 2, 0, 0] } },
        index: { array: [0, 1, 2] },
      }],
    },
  ];

  for (const parsed of cases) {
    const validator = new OcctStepOutputValidator(() => ({
      ReadStepFile: () => parsed,
    }));
    await expectCode(
      () => validator.validateOutput(declaration(), ap214Bytes()),
      parsed && typeof parsed === "object" &&
        (parsed as Record<string, unknown>).success === false
        ? "parse_rejected"
        : "invalid_geometry",
    );
  }
});

Deno.test("real OCCT accepts the repository AP214 bracket fixture", async () => {
  const bytes = await Deno.readFile(
    new URL("../../../../examples/bracket/bracket.step", import.meta.url),
  );
  const validator = new OcctStepOutputValidator();

  await validator.validateOutput(declaration(), bytes);
});

Deno.test("real OCCT rejects AP214-labelled garbage and a truncated STEP fixture", async () => {
  const validator = new OcctStepOutputValidator();
  const garbage = encoder.encode(
    "ISO-10303-21;HEADER;" +
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));" +
      "ENDSEC;DATA;THIS IS GARBAGE;ENDSEC;END-ISO-10303-21;",
  );
  const fixture = await Deno.readFile(
    new URL("../../../../examples/bracket/bracket.step", import.meta.url),
  );

  await expectCode(
    () => validator.validateOutput(declaration(), garbage),
    "parse_rejected",
  );
  await expectCode(
    () => validator.validateOutput(declaration(), fixture.slice(0, 2_000)),
    "parse_rejected",
  );
});

function declaration(): IsolatedCodeOutputDeclaration {
  return {
    role: "geometry",
    basename: "geometry.step",
    mediaType: "model/step",
    format: "step-ap214",
  };
}

function ap214Bytes(): Uint8Array {
  return encoder.encode(
    "ISO-10303-21;HEADER;" +
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));" +
      "ENDSEC;DATA;ENDSEC;END-ISO-10303-21;",
  );
}

function ap242Bytes(): Uint8Array {
  return encoder.encode(
    "ISO-10303-21;HEADER;" +
      "FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF " +
      "{ 1 0 10303 442 1 1 4 }'));ENDSEC;DATA;ENDSEC;END-ISO-10303-21;",
  );
}

function acceptedReader() {
  return { ReadStepFile: () => meaningfulGeometry() };
}

function meaningfulGeometry() {
  return {
    success: true,
    root: {
      name: "",
      meshes: [],
      children: [{ name: "part", meshes: [0], children: [] }],
    },
    meshes: [meaningfulMesh()],
  };
}

function meaningfulMesh() {
  return {
    attributes: {
      position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
    },
    index: { array: [0, 1, 2] },
  };
}

async function expectCode(
  action: () => Promise<unknown>,
  code: OcctStepOutputValidationError["code"],
): Promise<OcctStepOutputValidationError> {
  let observed: unknown;
  try {
    await action();
  } catch (error) {
    observed = error;
  }
  assertInstanceOf(observed, OcctStepOutputValidationError);
  assertEquals(observed.code, code);
  assertStringIncludes(observed.message, "STEP");
  return observed;
}
