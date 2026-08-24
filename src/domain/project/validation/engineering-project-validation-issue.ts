export interface EngineeringProjectValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  /** Structured details for a domain-specific recovery, when one is available. */
  readonly context?: Readonly<Record<string, string | number | boolean>>;
  readonly recovery?: string;
}

export class EngineeringProjectValidationError extends Error {
  readonly issues: readonly EngineeringProjectValidationIssue[];

  constructor(issues: readonly EngineeringProjectValidationIssue[]) {
    super(
      `Invalid EngineeringProjectSnapshot: ${
        issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")
      }`,
    );
    this.name = "EngineeringProjectValidationError";
    this.issues = issues;
  }
}

export function issue(
  issues: EngineeringProjectValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

export function issueWithRecovery(
  issues: EngineeringProjectValidationIssue[],
  code: string,
  path: string,
  message: string,
  context: Readonly<Record<string, string | number | boolean>>,
  recovery: string,
): void {
  issues.push({ code, path, message, context, recovery });
}
