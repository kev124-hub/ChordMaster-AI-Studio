import axios from "axios";

/**
 * Given an Apple Music URL, return a YouTube search query string.
 *
 * Strategy: extract the iTunes store ID from the URL and call the public
 * iTunes Lookup API (no authentication required) to get the track name
 * and artist. Falls back to parsing path segments if the lookup fails.
 *
 * Supported URL patterns:
 *   https://music.apple.com/us/album/song-name/1234567890?i=9876543210
 *   https://music.apple.com/us/album/album-name/1234567890
 */
export async function resolveAppleUrl(url: string): Promise<string> {
  // Prefer the ?i= track ID (most specific)
  const trackIdMatch = url.match(/[?&]i=(\d+)/);
  const pathIdMatch = url.match(/\/(\d+)(?:[?#]|$)/);

  const itunesId = trackIdMatch?.[1] ?? pathIdMatch?.[1];

  if (itunesId) {
    try {
      const resp = await axios.get(
        `https://itunes.apple.com/lookup?id=${itunesId}`,
        { timeout: 8000 }
      );
      const item = resp.data?.results?.[0];
      if (item) {
        const trackName: string = item.trackName ?? item.collectionName ?? "";
        const artistName: string = item.artistName ?? "";
        if (trackName && artistName) {
          return `${trackName} ${artistName} official`;
        }
      }
    } catch {
      // Fall through to path-based parsing
    }
  }

  // Fallback: extract human-readable slug from URL path
  // e.g. /us/album/some-song-title/123 → "some song title"
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  // The slug is typically the second-to-last segment before the numeric ID
  const slugSegments = segments.filter((s) => !/^\d+$/.test(s));
  const slug = slugSegments.at(-1) ?? "";
  return slug.replace(/-/g, " ") || url;
}
