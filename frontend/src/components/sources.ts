import { sameSource } from '@/lib/citations'
import type { Source } from '@/lib/types'

/** Sources without repeats, in their original order. */
export function uniqueSources(sources: Source[]): Source[] {
  return sources.filter((s, i) => sources.findIndex((o) => sameSource(o, s)) === i)
}
