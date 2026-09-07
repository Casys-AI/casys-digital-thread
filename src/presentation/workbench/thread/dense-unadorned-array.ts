/**
 * Admit only ordinary dense arrays whose own keys are exactly `length` and
 * every numeric index. Shared by the viewer-session and hierarchy boundaries
 * without making either projection own the other's runtime validation module.
 */
export function isDenseUnadornedArray(
  value: unknown,
): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, String(index))) {
      return false;
    }
  }
  return true;
}
