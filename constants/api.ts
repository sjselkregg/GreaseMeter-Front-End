export const API_BASE = "https://api.greasemeter.live/v1" as const;

export function apiUrl(path: string) {
  if (!path.startsWith("/")) return `${API_BASE}/${path}`;
  return `${API_BASE}${path}`;
}

