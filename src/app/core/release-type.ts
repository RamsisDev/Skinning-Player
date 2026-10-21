/**
 * What kind of release an album is, read the way Auxio reads MusicBrainz's release types: a
 * primary type (album, EP, single), refined by the secondary ones that say more, such as a
 * compilation, a soundtrack or a live recording.
 */

export const RELEASE_KINDS = ['album', 'ep', 'single', 'compilation', 'soundtrack', 'mixtape', 'djMix', 'demo'] as const;
export type ReleaseKind = (typeof RELEASE_KINDS)[number];

/** How a recording was made, for an album, an EP, a single or a compilation. */
export type ReleaseRefinement = 'live' | 'remix';

export interface ReleaseType {
  readonly kind: ReleaseKind;
  readonly refinement: ReleaseRefinement | null;
}

export const PLAIN_ALBUM: ReleaseType = { kind: 'album', refinement: null };

/** The secondary types that replace the primary one, in the order one wins over another. */
const SECONDARY: readonly (readonly [RegExp, ReleaseKind])[] = [
  [/^compilation$/, 'compilation'],
  [/^soundtrack$/, 'soundtrack'],
  [/^(dj-?mix|dj mix)$/, 'djMix'],
  [/^(mixtape|mixtape\/street|street)$/, 'mixtape'],
  [/^demo$/, 'demo'],
];

/**
 * A release type from the words a file gives for it, such as `["album", "live"]` or "ep; remix",
 * and its compilation flag. Null when the file says nothing about it.
 */
export function parseReleaseType(values: readonly string[], compilation = false): ReleaseType | null {
  const words = values.flatMap((value) => value.toLowerCase().split(/\s*[;,]\s*|\s+\/\s+/)).map((word) => word.trim());
  if (!words.some(Boolean)) return compilation ? { kind: 'compilation', refinement: null } : null;
  const refinement: ReleaseRefinement | null = words.includes('live') ? 'live' : words.includes('remix') ? 'remix' : null;
  for (const [pattern, kind] of SECONDARY) {
    if (words.some((word) => pattern.test(word))) {
      return { kind, refinement: kind === 'compilation' ? refinement : null };
    }
  }
  if (compilation) return { kind: 'compilation', refinement };
  const primary: ReleaseKind = words.includes('ep') ? 'ep' : words.includes('single') ? 'single' : 'album';
  return { kind: primary, refinement };
}
