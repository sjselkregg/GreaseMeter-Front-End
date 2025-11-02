# Changelog

All notable user-facing changes made during this session.

## 2025-10-24

- Map: region-based fetching and smart sampling
  - app/index.tsx: Fetch places using current MapView region (`lat`, `lng`, `latDelta`, `lngDelta`) with a 400ms debounce.
  - Normalize API responses supporting `{ data: [...], more: boolean }` and similar envelopes.
  - Reduce clutter when zoomed out by sampling markers via a 12×12 grid and showing a representative place per cell. Marker name shows `(+N)` when multiple places collapse into one cell.

- Search: autocomplete wired to API
  - app/index.tsx: Debounced (300ms) autocomplete query `GET /v1/places/search?lat=…&lng=…&term=…` using current map center.
  - Suggestions dropdown under the search bar; selecting a suggestion recenters the map and opens details.
  - Clear button (✕) to hide suggestions and clear the search text.

- Reviews: visibility and UX improvements
  - app/index.tsx: Include `Authorization: Bearer <token>` when fetching place reviews so users can see their own reviews when authenticated.
  - Optimistically add the created review to the list if the POST response returns it.

- Account: “My Reviews” uses paginated API
  - app/account.tsx: Parse `{ data: [...], more: boolean }` and normalize arrays; track `page` and `more`.
  - Show a “Load More” button only when `more` is true; pull-to-refresh resets to page 1.

