"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSpotifyUrl = resolveSpotifyUrl;
const axios_1 = __importDefault(require("axios"));
/**
 * Exchange Spotify client credentials for a bearer token.
 */
async function getSpotifyToken(clientId, clientSecret) {
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const resp = await axios_1.default.post("https://accounts.spotify.com/api/token", "grant_type=client_credentials", {
        headers: {
            Authorization: `Basic ${creds}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 10000,
    });
    return resp.data.access_token;
}
/**
 * Given a Spotify track URL, return the track's ISRC code.
 * Returns null if it cannot be resolved (e.g. playlist/album URLs).
 *
 * Supported URL patterns:
 *   https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC
 *   https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=...
 */
async function resolveSpotifyUrl(url, clientId, clientSecret) {
    // Extract track ID
    const match = url.match(/spotify\.com\/track\/([A-Za-z0-9]+)/);
    if (!match)
        return null;
    const trackId = match[1];
    const token = await getSpotifyToken(clientId, clientSecret);
    const resp = await axios_1.default.get(`https://api.spotify.com/v1/tracks/${trackId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
    });
    const isrc = resp.data?.external_ids?.isrc;
    return isrc ?? null;
}
//# sourceMappingURL=spotifyLookup.js.map