export interface HostFailure {
  readonly code: string;
  readonly message: string;
  readonly recovery: string;
}

export type HostResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: HostFailure };

export function ok<T>(value: T): HostResult<T> {
  return Object.freeze({ ok: true, value });
}

export function fail<T = never>(
  code: string,
  message: string,
  recovery: string,
): HostResult<T> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, recovery }),
  });
}
