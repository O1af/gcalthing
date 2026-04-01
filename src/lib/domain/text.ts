export function normalizeText(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, ' ').trim()
}

export function normalizePerson(value: string) {
  return normalizeText(value)
}

export function similarity(left: string, right: string) {
  if (!left || !right) {
    return 0
  }

  const leftTokens = new Set(left.split(/\s+/u).filter(Boolean))
  const rightTokens = new Set(right.split(/\s+/u).filter(Boolean))
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length
  const union = new Set([...leftTokens, ...rightTokens]).size
  return union === 0 ? 0 : intersection / union
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
