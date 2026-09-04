import { assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const MATRIX_TASK = "release:first-party-microvm-images:matrix";
const MATRIX_SCRIPT = "scripts/release/export-first-party-microsandbox-image-matrix.ts";
const WORKFLOW_PATH = ".github/workflows/publish-first-party-microvm-images.yml";
const UNIQUE_COMMIT_RUN_TAG =
  "git-${{ github.sha }}-run-${{ github.run_id }}-${{ github.run_attempt }}";
const GIT_MUTATION = /\bgit\s+(add|commit|push)\b/;
const GH_PR = /\bgh\s+pr\b/;
const MUTATING_ACTION = /commit|pull-request|create-pr/;

Deno.test("matrix export task is planning-only and reads the worktree", async () => {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as {
    tasks: Record<string, string>;
  };
  const command = config.tasks[MATRIX_TASK];
  assertEquals(command !== undefined, true);
  assertEquals(command!.includes("--no-prompt"), true);
  assertEquals(command!.includes("--frozen"), true);
  assertEquals(command!.includes("--allow-read=."), true);
  assertEquals(command!.includes("--allow-run"), false);
  assertEquals(command!.includes("--allow-write"), false);
  assertEquals(command!.includes("--allow-net"), false);
  assertEquals(command!.includes("docker"), false);
  assertEquals(command!.includes(MATRIX_SCRIPT), true);
});

Deno.test(
  "publish workflow is opt-in, least-privilege, native ARM, and non-mutating",
  async () => {
    const workflow = parseWorkflow(await Deno.readTextFile(WORKFLOW_PATH));
    assertEquals(Object.keys(workflow.on).toSorted(), ["workflow_dispatch"]);
    assertEquals("permissions" in workflow, false);

    const prepare = workflow.jobs.prepare;
    const build = workflow.jobs.build;
    if (!prepare || !build) {
      throw new TypeError("publish workflow must declare prepare and build jobs");
    }
    assertEquals(prepare.permissions, { contents: "read" });
    assertEquals(build.permissions, {
      contents: "read",
      packages: "write",
    });
    assertEquals(build["runs-on"], "ubuntu-24.04-arm");
    assertEquals(build.env?.IMAGE_TAG, UNIQUE_COMMIT_RUN_TAG);

    const push = build.steps.find((step) =>
      (step.uses ?? "").startsWith("docker/build-push-action@")
    );
    assertEquals(
      push?.with?.tags,
      "${{ matrix.imageName }}:${{ env.IMAGE_TAG }}",
    );

    const steps = [...prepare.steps, ...build.steps];
    for (const step of steps) {
      const action = (step.uses ?? "").split("@")[0]!.toLowerCase();
      assertEquals(action.includes("qemu"), false);
      assertEquals(MUTATING_ACTION.test(action), false);
      const script = step.run ?? "";
      assertEquals(GIT_MUTATION.test(script), false);
      assertEquals(GH_PR.test(script), false);
    }
  },
);

interface WorkflowDocument {
  readonly on: Record<string, unknown>;
  readonly jobs: Record<string, WorkflowJob>;
}

interface WorkflowJob {
  readonly "runs-on"?: string;
  readonly permissions?: Record<string, string>;
  readonly env?: Record<string, string>;
  readonly steps: readonly WorkflowStep[];
}

interface WorkflowStep {
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, string>;
}

function parseWorkflow(source: string): WorkflowDocument {
  const root = mapping(parseYaml(source), "workflow");
  return {
    on: mapping(root.on, "on"),
    jobs: Object.fromEntries(
      Object.entries(mapping(root.jobs, "jobs")).map(([name, job]) => {
        const record = mapping(job, `jobs.${name}`);
        return [name, {
          "runs-on": optionalString(record["runs-on"]),
          permissions: optionalStringRecord(record.permissions),
          env: optionalStringRecord(record.env),
          steps: array(record.steps, `jobs.${name}.steps`).map((step, index) => {
            const item = mapping(step, `jobs.${name}.steps[${index}]`);
            return {
              uses: optionalString(item.uses),
              run: optionalString(item.run),
              with: optionalStringRecord(item.with),
            };
          }),
        }];
      }),
    ),
  };
}

function mapping(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be a mapping.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be a sequence.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const record = mapping(value, "record");
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") result[key] = item;
  }
  return result;
}
