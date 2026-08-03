import { assertEquals, assertRejects } from "@std/assert";
import { verifyCoffeeMachineCm01V3GoldenReference } from "./verify-coffee-machine-cm01-v3-golden-reference.ts";

const ROOT = await Deno.makeTempDir({ prefix: "casys-cm01-golden-reference-" });
const CONFIG = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../config/golden-references/coffee-machine-cm01-v3.json",
      import.meta.url,
    ),
  ),
) as Record<string, unknown>;

Deno.test("CM-01 golden gate accepts a normalized fresh V3 observation", async () => {
  const observationPath = await write("green.json", observation());
  const result = await verifyCoffeeMachineCm01V3GoldenReference({ observationPath });
  assertEquals(result, { matches: true, differences: [] });
});

Deno.test("CM-01 golden gate reports a missing semantic artifact", async () => {
  const candidate = observation();
  candidate.artifacts = (candidate.artifacts as unknown[]).filter((item) =>
    (item as { role?: string }).role !== "cad-step"
  );
  const result = await verifyCoffeeMachineCm01V3GoldenReference({
    observationPath: await write("missing.json", candidate),
  });
  assertEquals(result.matches, false);
  assertEquals(
    result.differences.includes("missing semantic artifact role cad-step"),
    true,
  );
});

Deno.test("CM-01 golden gate refuses raw provider data", async () => {
  const candidate = observation();
  candidate.rawProviderData = { hidden: true };
  const observationPath = await write("unsafe.json", candidate);
  await assertRejects(
    () => verifyCoffeeMachineCm01V3GoldenReference({ observationPath }),
    Error,
    "$observation must contain exactly",
  );
});

function observation(): Record<string, unknown> {
  const expected = CONFIG.expected as Record<string, unknown>;
  const architecture = expected.architecture as Record<string, unknown>;
  const cad = expected.cad as Record<string, unknown>;
  const modelica = expected.modelica as Record<string, unknown>;
  const erp = expected.erp as Record<string, unknown>;
  const mechanical = expected.mechanical as Record<string, unknown>;
  return {
    project: structuredClone(CONFIG.candidateProject),
    artifacts: [
      architecture.artifact as unknown,
      ...structuredClone(cad.artifacts as unknown[]),
      modelica.artifact,
      erp.artifact,
      {
        role: "mechanical-step",
        kind: "step",
        producer: { serverId: "build123d", tool: "build123d_export" },
      },
    ],
    measurements: [
      ...structuredClone(modelica.measurements as unknown[]),
      ...structuredClone(erp.measurements as unknown[]),
      ...structuredClone(mechanical.measurements as unknown[]),
    ].map((item) => {
      const measurement = item as Record<string, unknown>;
      return {
        metric: measurement.metric,
        value: measurement.value,
        unit: measurement.unit,
      };
    }),
    mechanical: {
      proof: structuredClone(mechanical.proof),
      step: { artifactRole: "mechanical-step", sha256: "a".repeat(64) },
      consumption: {
        ...(structuredClone(mechanical.consumption) as Record<string, unknown>),
        observedSha256: "a".repeat(64),
      },
      evaluations: structuredClone(mechanical.evaluations),
    },
  };
}

async function write(name: string, value: unknown): Promise<string> {
  const path = `${ROOT}/${name}`;
  await Deno.writeTextFile(path, JSON.stringify(value));
  return path;
}
