export function canonicalJsonStringify(value: unknown): string {
  const serialized = JSON.stringify(sortJson(value))
  if (serialized === undefined) throw new TypeError('Value is not JSON serializable')
  return serialized
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, sortJson(item)])
    )
  }
  return value
}
