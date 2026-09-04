export class SpecError extends Error {}

export function fail(message) {
  throw new SpecError(message)
}
