import {
  sourceAlphaTagFromArgs,
  verifySourceAlphaRelease,
} from "./source-alpha-inventory.ts";

const tag = sourceAlphaTagFromArgs(Deno.args);
const result = await verifySourceAlphaRelease({ tag });

console.log(JSON.stringify(
  {
    status: "verified",
    tag,
    outputDirectory: decodeURIComponent(result.outputDirectory.pathname),
    checkedFiles: result.checkedFiles,
  },
  null,
  2,
));
