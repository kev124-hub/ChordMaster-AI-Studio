"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAppleTrackDetails = getAppleTrackDetails;
exports.resolveAppleUrl = resolveAppleUrl;
const axios_1 = __importDefault(require("axios"));
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
/**
 * Call the iTunes Lookup API and return structured track details.
 * Returns null if the ID cannot be found or the lookup fails.
 */
async function getAppleTrackDetails(url) {
    const trackIdMatch = url.match(/[?&]i=(\d+)/);
    const pathIdMatch = url.match(/\/(\d+)(?:[?#]|$)/);
    const itunesId = trackIdMatch?.[1] ?? pathIdMatch?.[1];
    if (!itunesId)
        return null;
    try {
        const resp = await axios_1.default.get(`https://itunes.apple.com/lookup?id=${itunesId}`, { timeout: 8000 });
        const item = resp.data?.results?.[0];
        if (!item)
            return null;
        const trackName = item.trackName ?? item.collectionName ?? "";
        const artistName = item.artistName ?? "";
        if (trackName && artistName)
            return { trackName, artistName };
    }
    catch {
        // Fall through
    }
    return null;
}
async function resolveAppleUrl(url) {
    const details = await getAppleTrackDetails(url);
    if (details) {
        return `${details.trackName} ${details.artistName} official`;
    }
    // Fallback: extract human-readable slug from URL path
    // e.g. /us/album/some-song-title/123 → "some song title"
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    // The slug is typically the second-to-last segment before the numeric ID
    const slugSegments = segments.filter((s) => !/^\d+$/.test(s));
    const slug = slugSegments.at(-1) ?? "";
    return slug.replace(/-/g, " ") || url;
}
//# sourceMappingURL=appleLookup.js.map