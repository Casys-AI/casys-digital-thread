import {
  renderThirdPartyNotices,
  sourceAlphaTagFromArgs,
} from "./source-alpha-inventory.ts";

const tag = sourceAlphaTagFromArgs(Deno.args);
const result = await renderThirdPartyNotices({ tag });

console.log(JSON.stringify(
  {
    status: "rendered",
    tag,
    outputDirectory: decodeURIComponent(result.outputDirectory.pathname),
    noticesSha256: result.noticesSha256,
  },
  null,
  2,
));
