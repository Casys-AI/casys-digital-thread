import type { CataloguedMechanicalProofCaseReader } from "../../application/ports/out/catalogued-mechanical-proof-case-reader.ts";

/** Filesystem adapter composed only at the server boundary. */
export class FileCataloguedMechanicalProofCaseReader
  implements CataloguedMechanicalProofCaseReader {
  async read(path: string): Promise<string | undefined> {
    try {
      return await Deno.readTextFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }
}
