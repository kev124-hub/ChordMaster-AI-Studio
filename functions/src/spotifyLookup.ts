import axios from "axios";

/**
 * Exchange Spotify client credentials for a bearer token.
 */
async function getSpotifyToken(
  clientId: string,
  clientSecret: string
): Promise<string> {
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const resp = await axios.post(
    "https://accounts.spotify.com/api/token",
    "grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 10000,
    }
  );
  return resp.data.access_token as string;
}

/**
 * Given a Spotify track URL, return the track's ISRC code.
 * Returns null if it cannot be resolved (e.g. playlist/album URLs).
 *
 * Supported URL patterns:
 *   https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC
 *   https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=...
 */
export interface SpotifyTrackDetails {
  isrc: string | null;
  trackName: string;
  artistName: string;
}

/**
 * Given a Spotify track URL, return the track's ISRC, title, and artist.
 * Returns null if it cannot be resolved (e.g. playlist/album URLs).
 */
export async function resolveSpotifyUrl(
  url: string,
  clientId: string,
  clientSecret: string
): Promise<SpotifyTrackDetails | null> {
  // Extract track ID
  const match = url.match(/spotify\.com\/track\/([A-Za-z0-9]+)/);
  if (!match) return null;
  const trackId = match[1];

  const token = await getSpotifyToken(clientId, clientSecret);
  const resp = await axios.get(
    `https://api.spotify.com/v1/tracks/${trackId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    }
  );

  return {
    isrc: resp.data?.external_ids?.isrc ?? null,
    trackName: resp.data?.name ?? "",
    artistName: resp.data?.artists?.[0]?.name ?? "",
  };
}
