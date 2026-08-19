/** Build the local worker candidate with its reviewed wrapper digest injected. */

import { fingerprintResourceBytes } from "../../src/domain/compile/source/provider-resource-reader.ts";

const WRAPPER = "src/adapters/fea/isolated-v3/calculix-static-proof-v1/run.ts";
const DOCKERFILE = "images/calculix-microsandbox-worker/Dockerfile";
const IMAGE = "casys/calculix-microsandbox-worker:gate";

if (Deno.args.length !== 0) {
  throw new TypeError("The CalculiX worker build gate accepts no arguments.");
}
const wrapperSha256 = await fingerprintResourceBytes(await Deno.readFile(WRAPPER));
const output = await new Deno.Command("docker", {
  args: [
    "build",
    "--file",
    DOCKERFILE,
    "--build-arg",
    `WRAPPER_SHA256=${wrapperSha256}`,
    "--tag",
    IMAGE,
    ".",
  ],
  stdin: "null",
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (!output.success) Deno.exit(output.code);
console.log(JSON.stringify({ image: IMAGE, wrapperSha256 }));
