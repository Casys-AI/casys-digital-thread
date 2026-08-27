import {
  buildSourceAlphaRelease,
  sourceAlphaTagFromArgs,
} from "./source-alpha-inventory.ts";

const tag = sourceAlphaTagFromArgs(Deno.args);
const result = await buildSourceAlphaRelease({ tag });

console.log(JSON.stringify(
  {
    status: "built",
    tag,
    outputDirectory: decodeURIComponent(result.outputDirectory.pathname),
    commit: result.context.commit,
    sourceArchiveSha256: result.context.sourceArchiveSha256,
  },
  null,
  2,
));
