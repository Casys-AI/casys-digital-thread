import type { EngineeringProjectSnapshot } from "../domain/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../domain/engineering-project-validation.ts";

/** Read-only boundary used by the Workbench BFF. */
export interface EngineeringProjectStore {
  get(): Promise<EngineeringProjectSnapshot | undefined>;
}

export interface EngineeringProjectFileIo {
  readTextFile(path: string): Promise<string>;
}

const DENO_FILE_IO: EngineeringProjectFileIo = {
  readTextFile: (path) => Deno.readTextFile(path),
};

/**
 * Loads one declarative EngineeringProjectSnapshot from disk.
 *
 * The adapter deliberately exposes no write or execution operation. Every
 * read crosses the domain validator so edits to the project manifest cannot
 * silently reach the browser with an invalid contract.
 */
export class FileEngineeringProjectStore implements EngineeringProjectStore {
  constructor(
    private readonly path: string,
    private readonly io: EngineeringProjectFileIo = DENO_FILE_IO,
  ) {}

  async get(): Promise<EngineeringProjectSnapshot | undefined> {
    try {
      const value = JSON.parse(await this.io.readTextFile(this.path));
      return structuredClone(validateEngineeringProjectSnapshot(value));
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    (error instanceof Error && error.name === "NotFound");
}
