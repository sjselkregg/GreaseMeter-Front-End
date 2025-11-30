import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  StyleSheet,
  View,
  TextInput,
  Keyboard,
  TouchableOpacity,
  Text,
  FlatList,
  Image,
  Animated,
  Dimensions,
  PanResponder,
  TouchableWithoutFeedback,
  Alert,
  Modal,
} from "react-native";
import MapView, { Marker, Region } from "react-native-maps";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { formatRelativeTime } from "../utils/time";

type PlaceOrigin = "map" | "list" | "search" | "bookmark";

type Place = {
  id: number | string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  rating?: number;
  images?: string[];
  origin?: PlaceOrigin;
};

type Review = {
  id: number | string;
  text: string;
  rating: number;
  name?: string; // review author's username
  relativeTime?: string;
};

type PlaceDetailRoute = "map" | "list" | "meta";

const META_PREFETCH_LIMIT = 40;
const META_PREFETCH_CONCURRENCY = 6;
const REGION_VISIBLE_MULTIPLIER = 1.3;
const CACHE_RETENTION_MULTIPLIER = 2.8;
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const wrapLongitude = (value: number): number => {
  if (!isFiniteNumber(value)) return Number.NaN;
  let lng = value;
  while (lng < -180) lng += 360;
  while (lng > 180) lng -= 360;
  return lng;
};
const isValidLatitude = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= -90 && value <= 90;
const isValidLongitude = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= -180 && value <= 180;

const placeHasValidCoords = (place?: Place | null): place is Place =>
  Boolean(place && isValidLatitude(place.latitude) && isValidLongitude(place.longitude));

type Bounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

const computeBounds = (region?: Region | null, multiplier = 1): Bounds | null => {
  if (!region) return null;
  const latSpan = Math.max(region.latitudeDelta, 0.0005) * multiplier;
  const lngSpan = Math.max(region.longitudeDelta, 0.0005) * multiplier;
  return {
    minLat: region.latitude - latSpan / 2,
    maxLat: region.latitude + latSpan / 2,
    minLng: region.longitude - lngSpan / 2,
    maxLng: region.longitude + lngSpan / 2,
  };
};

const placeWithinBounds = (place?: Place | null, bounds?: Bounds | null): boolean => {
  if (!bounds) return true;
  if (!placeHasValidCoords(place)) return false;
  return (
    place.latitude >= bounds.minLat &&
    place.latitude <= bounds.maxLat &&
    place.longitude >= bounds.minLng &&
    place.longitude <= bounds.maxLng
  );
};

const getPlaceKey = (place: Partial<Place>): string | null => {
  if (place?.id != null) {
    const idStr = String(place.id);
    if (idStr.length) return idStr;
  }
  if (isValidLatitude(place.latitude) && isValidLongitude(place.longitude)) {
    return `${place.latitude.toFixed(5)}:${place.longitude.toFixed(5)}`;
  }
  return null;
};

const MIN_REGION_DELTA = 0.0002;
const sanitizeRegion = (candidate?: Partial<Region>): Region | null => {
  if (!candidate || !isValidLatitude(candidate.latitude)) return null;
  const safeLat = clampNumber(candidate.latitude, -90, 90);
  const safeLng = isFiniteNumber(candidate.longitude) ? wrapLongitude(candidate.longitude) : null;
  const safeLatDelta = isFiniteNumber(candidate.latitudeDelta)
    ? clampNumber(candidate.latitudeDelta, MIN_REGION_DELTA, 180)
    : null;
  const safeLngDelta = isFiniteNumber(candidate.longitudeDelta)
    ? clampNumber(candidate.longitudeDelta, MIN_REGION_DELTA, 360)
    : null;
  if (safeLng == null || safeLatDelta == null || safeLngDelta == null) return null;
  return {
    latitude: safeLat,
    longitude: safeLng,
    latitudeDelta: safeLatDelta,
    longitudeDelta: safeLngDelta,
  };
};
const API_BASE = "https://api.greasemeter.live/v1";
const DEFAULT_REGION =
  sanitizeRegion({
    latitude: 39.9526,
    longitude: -75.1652,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  }) ?? {
    latitude: 39.9526,
    longitude: -75.1652,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  };
const regionFromPlace = (place: Place, delta = 0.01): Region | null =>
  sanitizeRegion({
    latitude: place.latitude,
    longitude: place.longitude,
    latitudeDelta: delta,
    longitudeDelta: delta,
  });

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [rawPlaces, setRawPlaces] = useState<Place[]>([]);
  // Dedicated list view state (server-backed)
  const [listPlaces, setListPlaces] = useState<Place[]>([]);
  const [listPage, setListPage] = useState(1);
  const [listHasMore, setListHasMore] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showListModal, setShowListModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const [reviewRating, setReviewRating] = useState("5");
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [placeImages, setPlaceImages] = useState<string[]>([]);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewHasMore, setReviewHasMore] = useState(false);
  const [reviewLoadingMore, setReviewLoadingMore] = useState(false);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [imageViewerIndex, setImageViewerIndex] = useState(0);
  const imageViewerRef = useRef<FlatList<string> | null>(null);
  const geocodeCacheRef = useRef<Map<string, { lat: number; lon: number }>>(new Map());
  const pinchClosedRef = useRef(false);

  const mapRef = useRef<MapView | null>(null);
  const searchTimeoutRef = useRef<any>(null);
  const searchQueryIdRef = useRef(0);
  const metaCacheRef = useRef<Map<string | number, Partial<Place>>>(new Map());
  const metaInFlightRef = useRef<Set<string | number>>(new Set());
  const placeCacheRef = useRef<Map<string, Place>>(new Map());
  const placeFetchIdRef = useRef(0);
  const handleRegionChangeComplete = useCallback((next: Region) => {
    const safe = sanitizeRegion(next);
    if (!safe) return;
    setRegion(safe);
  }, []);

  const getDetailRouteForPlace = (
    place: Place,
    override?: PlaceDetailRoute
  ): PlaceDetailRoute => {
    if (override) return override;
    switch (place?.origin) {
      case "list":
        return "list";
      case "search":
      case "bookmark":
        return "meta";
      default:
        return "map";
    }
  };

  const extractCoordsFromPayload = (payload: any): { latitude?: number; longitude?: number } => {
    try {
      const coords =
        payload?.point?.coordinates ??
        payload?.geometry?.coordinates ??
        [
          payload?.lng ??
            payload?.longitude ??
            payload?.location?.lng ??
            payload?.center?.[0] ??
            payload?.coordinates?.[0],
          payload?.lat ??
            payload?.latitude ??
            payload?.location?.lat ??
            payload?.center?.[1] ??
            payload?.coordinates?.[1],
        ];
      const lon = parseFloat(coords?.[0]);
      const lat = parseFloat(coords?.[1]);
      const patch: { latitude?: number; longitude?: number } = {};
      if (isValidLatitude(lat)) patch.latitude = lat;
      if (isValidLongitude(lon)) patch.longitude = lon;
      return patch;
    } catch {
      return {};
    }
  };

const API_HOST = API_BASE.replace(/\/v1$/, "");

const normalizeImageUrl = (url?: string | null): string | null => {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:")) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${API_HOST}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
};

const extractImageUrls = (payload: any): string[] => {
  const candidates = [
    Array.isArray(payload?.images) ? payload.images : undefined,
    Array.isArray(payload?.imageUrls) ? payload.imageUrls : undefined,
    Array.isArray(payload?.image_urls) ? payload.image_urls : undefined,
    Array.isArray(payload?.photos) ? payload.photos : undefined,
    Array.isArray(payload?.media) ? payload.media : undefined,
    Array.isArray(payload?.gallery) ? payload.gallery : undefined,
    Array.isArray(payload?.data?.images) ? payload.data.images : undefined,
    Array.isArray(payload?.data?.imageUrls) ? payload.data.imageUrls : undefined,
    Array.isArray(payload?.data?.image_urls) ? payload.data.image_urls : undefined,
    Array.isArray(payload?.items) ? payload.items : undefined,
    Array.isArray(payload?.data) ? payload.data : undefined,
    Array.isArray(payload) ? payload : undefined,
  ];
  const arr = (candidates.find((c) => Array.isArray(c)) as any[]) ?? [];
  const urls = arr
    .map((it) => {
      if (typeof it === "string") return it;
      return (
        it?.url ??
        it?.src ??
        it?.image ??
        it?.link ??
        it?.photo_url ??
        it?.photoUrl ??
        it?.image_url ??
        it?.imageUrl ??
        it?.signed_url ??
        it?.signedUrl ??
        it?.download_url ??
        it?.downloadUrl ??
        null
      );
    })
    .map((u) => normalizeImageUrl(u))
    .filter((u): u is string => typeof u === "string" && !!u);
  return Array.from(new Set(urls));
};

  const applyPlacePatch = (placeId: Place["id"], patch: Partial<Place>) => {
    if (!placeId || !patch) return;
    const { origin: _origin, ...rest } = patch;
    const sanitized: Partial<Place> = { ...rest };
    if (!isValidLatitude(sanitized.latitude)) delete sanitized.latitude;
    if (!isValidLongitude(sanitized.longitude)) delete sanitized.longitude;
    if (!Object.keys(sanitized).length) return;
    const cached = metaCacheRef.current.get(placeId) ?? {};
    metaCacheRef.current.set(placeId, { ...cached, ...sanitized });
    const cacheKey =
      getPlaceKey({
        id: placeId,
        latitude: sanitized.latitude,
        longitude: sanitized.longitude,
      }) ?? String(placeId);
    if (cacheKey) {
      const cacheEntry = placeCacheRef.current.get(cacheKey);
      const safeName =
        typeof sanitized.name === "string" && sanitized.name.trim()
          ? sanitized.name
          : cacheEntry?.name ?? "Unnamed Place";
      const safeLatitude = isValidLatitude(sanitized.latitude)
        ? sanitized.latitude
        : cacheEntry?.latitude ?? Number.NaN;
      const safeLongitude = isValidLongitude(sanitized.longitude)
        ? sanitized.longitude
        : cacheEntry?.longitude ?? Number.NaN;
      const safeAddress =
        typeof sanitized.address === "string" && sanitized.address.trim()
          ? sanitized.address
          : cacheEntry?.address ?? "";
      const safeRating =
        typeof sanitized.rating === "number" ? sanitized.rating : cacheEntry?.rating;
      const safeImages = Array.isArray(sanitized.images) ? sanitized.images : cacheEntry?.images;
      const mergedBase: Place = {
        id: placeId,
        name: safeName,
        latitude: safeLatitude,
        longitude: safeLongitude,
        address: safeAddress,
        rating: safeRating,
        origin: cacheEntry?.origin,
        images: safeImages,
      };
      placeCacheRef.current.set(cacheKey, { ...mergedBase, ...sanitized });
    }
    setRawPlaces((prev) => prev.map((it) => (it.id === placeId ? { ...it, ...sanitized } : it)));
    setListPlaces((prev) => prev.map((it) => (it.id === placeId ? { ...it, ...sanitized } : it)));
    setSuggestions((prev) => prev.map((it) => (it.id === placeId ? { ...it, ...sanitized } : it)));
    setSelectedPlace((prev) => (prev && prev.id === placeId ? { ...prev, ...sanitized } : prev));
  };

  const requestPlaceDetails = async (
    pid: string,
    place: Place,
    route: PlaceDetailRoute
  ): Promise<{ patch: Partial<Place>; images: string[] } | null> => {
    if (!pid) return null;
    try {
      const res = await fetch(`${API_BASE}/places/${pid}/${route}`, {
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) return null;
      const raw = await res.json();
      const payload = raw?.data ?? raw;
      const patch: Partial<Place> = {};
      if (route === "map") {
        if (typeof payload?.name === "string" && payload.name.trim()) patch.name = payload.name;
        if (typeof payload?.address === "string" && payload.address.trim()) {
          patch.address = payload.address;
        }
      }
      if (typeof payload?.rating === "number" && !Number.isNaN(payload.rating)) {
        patch.rating = payload.rating;
      }
      Object.assign(patch, extractCoordsFromPayload(payload));
      const images = extractImageUrls(payload);
      if (images.length) {
        patch.images = images;
      }
      return { patch, images };
    } catch {
      return null;
    }
  };

  const detailMissingReadableMeta = (detail: { patch: Partial<Place> } | null): boolean => {
    if (!detail) return true;
    const rawName = typeof detail.patch?.name === "string" ? detail.patch.name.trim() : "";
    const rawAddress =
      typeof detail.patch?.address === "string" ? detail.patch.address.trim() : "";
    const noName = !rawName || rawName === "Unnamed Place";
    return noName && !rawAddress;
  };

  const mergeDetailResponses = (
    primary: { patch: Partial<Place>; images: string[] } | null,
    fallback: { patch: Partial<Place>; images: string[] } | null
  ): { patch: Partial<Place>; images: string[] } | null => {
    if (primary && fallback) {
      return {
        patch: { ...primary.patch, ...fallback.patch },
        images: fallback.images.length ? fallback.images : primary.images,
      };
    }
    return fallback ?? primary;
  };

  const fetchPlaceDetails = async (
    place: Place,
    routeOverride?: PlaceDetailRoute
  ): Promise<{ patch: Partial<Place>; images: string[] } | null> => {
    const placeId = place?.id;
    if (placeId == null) return null;
    const pidStr = typeof placeId === "string" ? placeId : String(placeId);
    if (!pidStr || pidStr.includes(",")) return null;
    const primaryRoute = getDetailRouteForPlace(place, routeOverride);
    const primary = await requestPlaceDetails(pidStr, place, primaryRoute);
    const shouldFallback =
      (primaryRoute === "map" || primaryRoute === "list") && detailMissingReadableMeta(primary);
    if (!shouldFallback) return primary;
    const fallback = await requestPlaceDetails(pidStr, place, "meta");
    return mergeDetailResponses(primary, fallback);
  };

  const screenHeight = Dimensions.get("window").height;
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const regionRef = useRef(DEFAULT_REGION);
  const SNAP_POINTS = {
    CLOSED: screenHeight,
    HALF: screenHeight * 0.5,
    FULL: screenHeight * 0.1,
  };
  const slideAnim = useRef(new Animated.Value(SNAP_POINTS.CLOSED)).current;
  const slideAnimValueRef = useRef(SNAP_POINTS.CLOSED);
  const updateRawPlacesForRegion = useCallback(
    (targetRegion?: Region) => {
      const nextRegion = targetRegion ?? regionRef.current;
      const bounds = computeBounds(nextRegion, REGION_VISIBLE_MULTIPLIER);
      if (!bounds) {
        setRawPlaces(Array.from(placeCacheRef.current.values()));
        return;
      }
      const filtered: Place[] = [];
      placeCacheRef.current.forEach((val) => {
        if (placeWithinBounds(val, bounds)) filtered.push(val);
      });
      setRawPlaces(filtered);
    },
    []
  );

  const isMountedRef = useRef(true);

  const mergePlacesIntoCache = useCallback((incoming: Place[], regionSnapshot: Region) => {
    if (!incoming?.length) return;
    const cache = placeCacheRef.current;
    for (const place of incoming) {
      if (!placeHasValidCoords(place)) continue;
      const key = getPlaceKey(place);
      if (!key) continue;
      const existing = cache.get(key);
      cache.set(key, existing ? { ...existing, ...place } : place);
    }
    const pruneBounds = computeBounds(regionSnapshot, CACHE_RETENTION_MULTIPLIER);
    if (pruneBounds) {
      cache.forEach((value, key) => {
        if (!placeWithinBounds(value, pruneBounds)) {
          cache.delete(key);
        }
      });
    }
  }, []);

  useEffect(() => {
    regionRef.current = region;
    updateRawPlacesForRegion(region);
  }, [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta, updateRawPlacesForRegion]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5,
      onPanResponderMove: (_, g) => {
        const proposed = slideAnimValueRef.current + g.dy;
        if (proposed >= SNAP_POINTS.FULL && proposed <= SNAP_POINTS.CLOSED) {
          slideAnimValueRef.current = proposed;
          slideAnim.setValue(proposed);
        }
      },
      onPanResponderRelease: (_, g) => {
        let newPos = SNAP_POINTS.HALF;
        if (g.dy > 100) newPos = SNAP_POINTS.CLOSED;
        else if (g.dy < -100) newPos = SNAP_POINTS.FULL;
        else {
          const current = slideAnimValueRef.current;
          const distances = [
            { pos: SNAP_POINTS.FULL, dist: Math.abs(current - SNAP_POINTS.FULL) },
            { pos: SNAP_POINTS.HALF, dist: Math.abs(current - SNAP_POINTS.HALF) },
            { pos: SNAP_POINTS.CLOSED, dist: Math.abs(current - SNAP_POINTS.CLOSED) },
          ];
          distances.sort((a, b) => a.dist - b.dist);
          newPos = distances[0].pos;
        }
        slideAnimValueRef.current = newPos;
        Animated.spring(slideAnim, { toValue: newPos, useNativeDriver: false }).start(() => {
          if (newPos === SNAP_POINTS.CLOSED) {
            setSelectedPlace(null);
            setReviews([]);
          }
        });
      },
    })
  ).current;

  // Fetch places
  const fetchPlaces = useCallback(async () => {
    const requestId = ++placeFetchIdRef.current;
    const regionSnapshot = regionRef.current ?? DEFAULT_REGION;
    try {
      const url = `https://api.greasemeter.live/v1/places/map?lat=${regionSnapshot.latitude}&lng=${regionSnapshot.longitude}&latDelta=${regionSnapshot.latitudeDelta}&lngDelta=${regionSnapshot.longitudeDelta}`;
      const res = await fetch(url);
      const data = await res.json();
      // Normalize possible API shapes into an array
      const candidates = [
        Array.isArray(data) ? data : undefined,
        data?.items,
        data?.data,
        data?.results,
        data?.places,
      ];
      const items = candidates.find((c) => Array.isArray(c)) ?? [];
      const mapped = (items as any[])
        .map((p: any) => {
          const coords =
            p.point?.coordinates ??
            p.geometry?.coordinates ??
            [
              p.lng ?? p.longitude ?? p.location?.lng ?? p.center?.[0] ?? p.coordinates?.[0],
              p.lat ?? p.latitude ?? p.location?.lat ?? p.center?.[1] ?? p.coordinates?.[1],
            ];
          const rawLon = parseFloat(coords?.[0]);
          const rawLat = parseFloat(coords?.[1]);
          if (!isValidLatitude(rawLat) || !isValidLongitude(rawLon)) return null;
          const lat = rawLat;
          const lon = rawLon;
          const pid =
            p.id ??
            p.place_id ??
            p.placeId ??
            p.gm_place_id ??
            p.google_place_id ??
            p.googleId ??
            p.gmaps_id ??
            p.gmaps_place_id ??
            p.osm_id;
          const base: Place = {
            id: pid ?? `${lat},${lon}`,
            name: p.name ?? p.meta?.name ?? p.title ?? "Unnamed Place",
            latitude: lat,
            longitude: lon,
            address: p.address ?? p.meta?.address ?? p.formatted_address ?? "",
            rating: parseFloat(p.avg_rating ?? p.rating ?? 0),
            origin: "map",
          };
          const cached = metaCacheRef.current.get(base.id);
          return cached ? { ...base, ...cached } : base;
        })
        .filter(Boolean) as Place[];
      mergePlacesIntoCache(mapped, regionSnapshot);
      if (!isMountedRef.current || placeFetchIdRef.current !== requestId) return;
      updateRawPlacesForRegion(regionSnapshot);
      // Enrich names/addresses asynchronously for list view
      enrichPlacesMeta(mapped);
    } catch (err) {
      console.error("Failed to fetch places:", err);
    }
  }, [mergePlacesIntoCache, updateRawPlacesForRegion]);

  // Fetch list view results from server (paginated)
  const fetchListPlaces = async (opts?: { reset?: boolean; pageSize?: number }) => {
    const reset = Boolean(opts?.reset);
    const limit = Math.max(1, Math.min(50, opts?.pageSize ?? 20));
    const nextPage = reset ? 1 : listPage;
    if (listLoading) return;
    setListLoading(true);
    try {
      const url = `https://api.greasemeter.live/v1/places/list?lat=${region.latitude}&lng=${region.longitude}&latDelta=${region.latitudeDelta}&lngDelta=${region.longitudeDelta}&page=${nextPage}&limit=${limit}`;
      const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
      const data = await res.json();
      const candidates = [
        Array.isArray(data) ? data : undefined,
        data?.items,
        data?.data?.items,
        data?.data?.results,
        data?.data?.places,
        data?.results,
        data?.places,
        data?.data,
      ];
      let items = (candidates.find((c) => Array.isArray(c)) as any[]) ?? [];
      let mapped = (items as any[])
        .map((p: any) => {
          const coords =
            p.point?.coordinates ??
            p.geometry?.coordinates ??
            [
              p.lng ?? p.longitude ?? p.location?.lng ?? p.center?.[0] ?? p.coordinates?.[0],
              p.lat ?? p.latitude ?? p.location?.lat ?? p.center?.[1] ?? p.coordinates?.[1],
            ];
          const rawLon = parseFloat(coords?.[0]);
          const rawLat = parseFloat(coords?.[1]);
          const lat = isValidLatitude(rawLat) ? rawLat : Number.NaN;
          const lon = isValidLongitude(rawLon) ? rawLon : Number.NaN;
          const pid =
            p.id ??
            p.place_id ??
            p.placeId ??
            p.gm_place_id ??
            p.google_place_id ??
            p.googleId ??
            p.gmaps_id ??
            p.gmaps_place_id ??
            p.osm_id;
          const base: Place = {
            id: pid ?? `${lat},${lon}`,
            name: p.name ?? p.meta?.name ?? p.title ?? "Unnamed Place",
            latitude: lat,
            longitude: lon,
            address: p.address ?? p.meta?.address ?? p.formatted_address ?? "",
            rating: parseFloat(p.avg_rating ?? p.rating ?? 0) || 0,
            origin: "list",
          };
          // Merge any cached meta immediately for better list UX
          const cached = metaCacheRef.current.get(base.id);
          return cached ? { ...base, ...cached } : base;
        }) as Place[];

      // Fallback: if list endpoint returns nothing, try map endpoint once per reset
      if ((!mapped || mapped.length === 0) && reset) {
        try {
          const mapUrl = `https://api.greasemeter.live/v1/places/map?lat=${region.latitude}&lng=${region.longitude}&latDelta=${region.latitudeDelta}&lngDelta=${region.longitudeDelta}`;
          const mapRes = await fetch(mapUrl, { headers: { "Content-Type": "application/json" } });
          const mapData = await mapRes.json();
          const mapCandidates = [
            Array.isArray(mapData) ? mapData : undefined,
            mapData?.items,
            mapData?.data?.items,
            mapData?.data?.results,
            mapData?.data?.places,
            mapData?.results,
            mapData?.places,
            mapData?.data,
          ];
          items = (mapCandidates.find((c) => Array.isArray(c)) as any[]) ?? [];
          mapped = (items as any[])
            .map((p: any) => {
              const coords =
                p.point?.coordinates ??
                p.geometry?.coordinates ??
                [
                  p.lng ?? p.longitude ?? p.location?.lng ?? p.center?.[0] ?? p.coordinates?.[0],
                  p.lat ?? p.latitude ?? p.location?.lat ?? p.center?.[1] ?? p.coordinates?.[1],
                ];
              const rawLon = parseFloat(coords?.[0]);
              const rawLat = parseFloat(coords?.[1]);
              const lat = isValidLatitude(rawLat) ? rawLat : Number.NaN;
              const lon = isValidLongitude(rawLon) ? rawLon : Number.NaN;
              const pid =
                p.id ?? p.place_id ?? p.placeId ?? p.gm_place_id ?? p.google_place_id ?? p.googleId ?? p.gmaps_id ?? p.gmaps_place_id ?? p.osm_id;
              const base: Place = {
                id: pid ?? `${lat},${lon}`,
                name: p.name ?? p.meta?.name ?? p.title ?? "Unnamed Place",
                latitude: lat,
                longitude: lon,
                address: p.address ?? p.meta?.address ?? p.formatted_address ?? "",
                rating: parseFloat(p.avg_rating ?? p.rating ?? 0) || 0,
                origin: "map",
              };
              const cached = metaCacheRef.current.get(base.id);
              return cached ? { ...base, ...cached } : base;
            }) as Place[];
          // Since map endpoint isn't paginated the same way, assume no more
          setListHasMore(false);
        } catch (e) {
          // ignore
        }
      }

      if (reset) setListPlaces(mapped);
      else setListPlaces((prev) => [...prev, ...mapped]);

      // hasMore: prefer explicit flag if present
      const moreFlag = Boolean(
        (data && data.more === true) ||
          (data?.data && data.data.more === true) ||
          (data?.pagination && data.pagination.hasMore === true)
      );
      if (!reset || mapped.length > 0) {
        setListHasMore(moreFlag || (Array.isArray(mapped) && mapped.length >= limit));
      }
      setListPage(nextPage + 1);

      // Opportunistically enrich metadata for visible list items
      enrichPlacesMeta(mapped);
    } catch (err) {
      console.error("Failed to fetch list places:", err);
      if (reset) setListPlaces([]);
      setListHasMore(false);
    } finally {
      setListLoading(false);
      if (listRefreshing) setListRefreshing(false);
    }
  };

  // Ensure list view loads when modal opens (onShow can be unreliable on some platforms)
  useEffect(() => {
    if (!showListModal) return;
    setListPage(1);
    setListHasMore(true);
    setListPlaces([]);
    fetchListPlaces({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showListModal]);

  // Fetch detail data for map markers lacking readable name/address
  const enrichPlacesMeta = async (list: Place[]) => {
    const candidates = list.slice(0, META_PREFETCH_LIMIT); // cap to avoid overfetching
    const pending: Promise<void>[] = [];
    const flush = async () => {
      if (!pending.length) return;
      const batch = pending.splice(0, pending.length);
      await Promise.allSettled(batch);
    };
    for (const p of candidates) {
      if (!p || p.id == null) continue;
      if (p.origin && p.origin !== "map") continue;
      const cached = metaCacheRef.current.get(p.id);
      const nameCandidate = cached?.name ?? p.name;
      const addressCandidate = cached?.address ?? p.address;
      const needs = !nameCandidate || nameCandidate === "Unnamed Place" || !addressCandidate;
      if (!needs) continue;
      if (metaInFlightRef.current.has(p.id)) continue;
      metaInFlightRef.current.add(p.id);
      const task = (async () => {
        try {
          const details = await fetchPlaceDetails(p, "map");
          if (details?.patch && Object.keys(details.patch).length) {
            applyPlacePatch(p.id, details.patch);
          }
        } catch {
          // ignore individual fetch failures
        } finally {
          metaInFlightRef.current.delete(p.id);
        }
      })();
      pending.push(task);
      if (pending.length >= META_PREFETCH_CONCURRENCY) {
        await flush();
      }
    }
    await flush();
  };

  // Resolve coordinates for a place when missing
  const resolvePlaceWithCoords = async (place: Place): Promise<Place> => {
    const hasCoords = isValidLatitude(place.latitude) && isValidLongitude(place.longitude);
    if (hasCoords) return place;
    let lat = hasCoords ? place.latitude : Number.NaN;
    let lon = hasCoords ? place.longitude : Number.NaN;
    const needsCoords = !isValidLatitude(lat) || !isValidLongitude(lon);
    const detailRoute: PlaceDetailRoute | undefined =
      place.origin === "list"
        ? "list"
        : place.origin === "search" || place.origin === "bookmark"
        ? "meta"
        : undefined;
    if (needsCoords && detailRoute) {
      try {
        const detail = await fetchPlaceDetails(place, detailRoute);
        if (detail?.patch) {
          if (typeof detail.patch.latitude === "number") lat = detail.patch.latitude;
          if (typeof detail.patch.longitude === "number") lon = detail.patch.longitude;
          applyPlacePatch(place.id, detail.patch);
        }
      } catch {
        // ignore and fall through to geocode
      }
    }
    // Fallback: geocode by address if still missing
    if (!isValidLatitude(lat) || !isValidLongitude(lon)) {
      const addr = (place.address || "").trim();
      const query = addr || `${place.name || ""}`.trim();
      if (query) {
        try {
          const cachedGeo = geocodeCacheRef.current.get(query);
          if (cachedGeo && isValidLatitude(cachedGeo.lat) && isValidLongitude(cachedGeo.lon)) {
            lat = cachedGeo.lat;
            lon = cachedGeo.lon;
          } else {
            const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
            const r = await fetch(url, { headers: { Accept: "application/json" } });
            if (r.ok) {
              const arr = await r.json();
              if (Array.isArray(arr) && arr.length > 0) {
                const first = arr[0];
                const glat = parseFloat(first?.lat);
                const glon = parseFloat(first?.lon);
                if (isValidLatitude(glat) && isValidLongitude(glon)) {
                  lat = glat;
                  lon = glon;
                  geocodeCacheRef.current.set(query, { lat: glat, lon: glon });
                }
              }
            }
          }
        } catch {}
      }
    }
    const coordsResolved = isValidLatitude(lat) && isValidLongitude(lon);
    if (coordsResolved) {
      applyPlacePatch(place.id, { latitude: lat, longitude: lon });
    }
    return {
      ...place,
      latitude: coordsResolved ? lat : Number.NaN,
      longitude: coordsResolved ? lon : Number.NaN,
    };
  };

  const focusMapOnPlace = (place: Place, delta = 0.01) => {
    if (!mapRef.current) return;
    const target = regionFromPlace(place, delta);
    if (!target) return;
    mapRef.current.animateToRegion(target, 800);
  };

  useEffect(() => {
    fetchPlaces();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchPlaces]);

  // Debounce fetch on region changes
  const regionFetchTimeout = useRef<any>(null);
  useEffect(() => {
    if (regionFetchTimeout.current) clearTimeout(regionFetchTimeout.current);
    regionFetchTimeout.current = setTimeout(() => {
      fetchPlaces();
    }, 400);
    return () => {
      if (regionFetchTimeout.current) clearTimeout(regionFetchTimeout.current);
    };
  }, [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta, fetchPlaces]);

  // Sample markers to avoid clutter when zoomed out
  const samplePlacesForRegion = useCallback((all: Place[], r: Region): Place[] => {
    if (!all?.length) return [];
    const latDelta = Math.max(r.latitudeDelta, 0.0005);
    const lngDelta = Math.max(r.longitudeDelta, 0.0005);
    const rows = 12;
    const cols = 12;
    const latStep = latDelta / rows;
    const lngStep = lngDelta / cols;
    const minLat = r.latitude - latDelta / 2;
    const minLng = r.longitude - lngDelta / 2;

    const bestByCell = new Map<string, Place & { _count?: number }>();
    for (const p of all) {
      const i = Math.floor((p.latitude - minLat) / latStep);
      const j = Math.floor((p.longitude - minLng) / lngStep);
      const key = `${i}:${j}`;
      const curr = bestByCell.get(key);
      if (!curr) {
        bestByCell.set(key, { ...p, _count: 1 });
      } else {
        const currScore = typeof curr.rating === "number" ? curr.rating : 0;
        const newScore = typeof p.rating === "number" ? p.rating : 0;
        if (newScore > currScore) bestByCell.set(key, { ...p, _count: (curr._count || 0) + 1 });
        else curr._count = (curr._count || 0) + 1;
      }
    }

    const result: Place[] = [];
    bestByCell.forEach((val) => {
      const count = val._count || 1;
      if (count > 1) result.push({ ...val, name: `${val.name} (+${count - 1})` });
      else result.push(val);
    });
    return result;
  }, []);

  // helper not needed after reverting selected marker badge

  // Check if a given place is already present in the sampled list
  const placeIncluded = (list: Place[], p?: Place | null): boolean => {
    if (!p) return true;
    const pid = p.id;
    const lat = p.latitude;
    const lon = p.longitude;
    for (const it of list) {
      if (pid != null && it.id === pid) return true;
      // If no reliable id, compare coordinates approximately
      if (
        isValidLatitude(lat) &&
        isValidLongitude(lon) &&
        isValidLatitude(it.latitude) &&
        isValidLongitude(it.longitude) &&
        Math.abs(it.latitude - lat) < 1e-5 &&
        Math.abs(it.longitude - lon) < 1e-5
      ) {
        return true;
      }
    }
    return false;
  };

  const visiblePlaces = useMemo(() => samplePlacesForRegion(rawPlaces, region), [
    rawPlaces,
    region.latitude,
    region.longitude,
    region.latitudeDelta,
    region.longitudeDelta,
    samplePlacesForRegion,
  ]);

  // Debounced autocomplete tied to the search bar
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const term = search.trim();
    // Start suggesting from first character typed
    if (term.length < 1) {
      setSuggestions([]);
      return;
    }

    setIsSearching(true);
    const queryId = ++searchQueryIdRef.current;
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const url = `https://api.greasemeter.live/v1/places/search?lat=${region.latitude}&lng=${region.longitude}&term=${encodeURIComponent(
          term
        )}`;
        const res = await fetch(url);
        const data = await res.json();
        const candidates = [
          Array.isArray(data) ? data : undefined,
          data?.items,
          data?.data,
          data?.results,
          data?.places,
        ];
        const items = (candidates.find((c) => Array.isArray(c)) ?? []) as any[];
        const mapped: Place[] = items
          .map((p: any) => {
            // API may only return id, name, address for search; fall back coords to current region center
            const coords =
              p.point?.coordinates ??
              p.geometry?.coordinates ??
              [
                p.lng ?? p.longitude ?? p.location?.lng ?? p.center?.[0] ?? p.coordinates?.[0],
                p.lat ?? p.latitude ?? p.location?.lat ?? p.center?.[1] ?? p.coordinates?.[1],
              ];
            const lonRaw = parseFloat(coords?.[0]);
            const latRaw = parseFloat(coords?.[1]);
            const lon = isValidLongitude(lonRaw) ? lonRaw : Number.NaN;
            const lat = isValidLatitude(latRaw) ? latRaw : Number.NaN;

            const base: Place = {
              id:
                p.id ??
                p.place_id ??
                p.placeId ??
                p.gm_place_id ??
                p.google_place_id ??
                p.googleId ??
                p.gmaps_id ??
                p.gmaps_place_id ??
                p.osm_id ?? `${lat},${lon}`,
              name: p.name ?? p.meta?.name ?? p.title ?? "Unnamed Place",
              latitude: lat,
              longitude: lon,
              address: p.address ?? p.meta?.address ?? p.formatted_address ?? "",
              rating: parseFloat(p.avg_rating ?? p.rating ?? 0) || 0,
              origin: "search",
            };
            const cached = metaCacheRef.current.get(base.id);
            return cached ? { ...base, ...cached } : base;
          }) as Place[];

        if (searchQueryIdRef.current === queryId) {
          setSuggestions(mapped);
        }
      } catch (e) {
        if (searchQueryIdRef.current === queryId) {
          setSuggestions([]);
        }
      } finally {
        if (searchQueryIdRef.current === queryId) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [search, region.latitude, region.longitude]);

  // Fetch reviews for a place
  const fetchReviews = async (
    placeId: number | string,
    opts?: { page?: number; append?: boolean }
  ) => {
    const page = Math.max(1, opts?.page ?? 1);
    const limit = 20;
    const append = opts?.append ?? page > 1;
    if (append) setReviewLoadingMore(true);
    try {
      const token = await AsyncStorage.getItem("userToken");
      const res = await fetch(
        `https://api.greasemeter.live/v1/reviews/places/${placeId}?page=${page}&limit=${limit}`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Cache-Control": "no-cache",
          },
        }
      );
      const data = await res.json();
      // Normalize possible API shapes into an array
      const candidates = [
        data?.items,
        data?.data,
        data?.results,
        data?.reviews,
        data,
      ];
      const items = candidates.find((c) => Array.isArray(c)) ?? [];

      const mapped = (items as any[]).map((r: any, i: number) => ({
        id: r?.id ?? i,
        text: r?.text ?? "",
        rating: parseFloat(r?.rating ?? 0) || 0,
        name:
          (typeof r?.name === "string" && r.name) ||
          (typeof r?.username === "string" && r.username) ||
          (typeof r?.user?.name === "string" && r.user.name) ||
          undefined,
        relativeTime: formatRelativeTime(r?.time),
      }));
      setReviews((prev) => (append ? [...prev, ...mapped] : mapped));
      const moreFlag =
        data?.more === true ||
        data?.data?.more === true ||
        data?.pagination?.hasMore === true;
      setReviewHasMore(Boolean(moreFlag || (Array.isArray(mapped) && mapped.length >= limit)));
      setReviewPage(page);
    } catch (err) {
      console.error("Error fetching reviews:", err);
      if (!opts?.append) setReviews([]);
    } finally {
      if (append) setReviewLoadingMore(false);
    }
  };

  const openPlaceDetails = async (place: Place) => {
    setSuggestions([]);
    // Set selected with current info, then enrich with meta
    setSelectedPlace(place);
    setPlaceImages(place.images ?? []);
    setReviewPage(1);
    setReviewHasMore(false);
    setReviewLoadingMore(false);
    // Fetch the appropriate detail bundle for the selected place
    (async () => {
      try {
        const details = await fetchPlaceDetails(place);
        if (details?.patch) {
          applyPlacePatch(place.id, details.patch);
        }
        if (details) {
          setPlaceImages(details.images);
        } else if (!place.images?.length) {
          setPlaceImages([]);
        }
      } catch {
        if (!place.images?.length) setPlaceImages([]);
      }
    })();
    await fetchReviews(place.id, { page: 1, append: false });
    slideAnimValueRef.current = SNAP_POINTS.HALF;
    Animated.spring(slideAnim, { toValue: SNAP_POINTS.HALF, useNativeDriver: false }).start();
  };

  const closeDetails = () => {
    slideAnimValueRef.current = SNAP_POINTS.CLOSED;
    Animated.spring(slideAnim, { toValue: SNAP_POINTS.CLOSED, useNativeDriver: false }).start(() => {
      setSelectedPlace(null);
      setReviews([]);
      setPlaceImages([]);
      setReviewPage(1);
      setReviewHasMore(false);
      setReviewLoadingMore(false);
    });
  };

  const handleLoadMoreReviews = async () => {
    if (!selectedPlace || reviewLoadingMore || !reviewHasMore) return;
    await fetchReviews(selectedPlace.id, { page: reviewPage + 1, append: true });
  };

  const handleAddBookmark = async () => {
    if (!selectedPlace) return;
    try {
      const token = await AsyncStorage.getItem("userToken");
      if (!token) {
        Alert.alert("Error", "You must be logged in to add a bookmark.");
        return;
      }
      const res = await fetch(
        `https://api.greasemeter.live/v1/bookmarks/places/${selectedPlace.id}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!res.ok) {
        Alert.alert("Error", "Failed to add bookmark.");
        return;
      }
      Alert.alert("Success", `${selectedPlace.name} has been bookmarked!`);
    } catch (err) {
      console.error("Bookmark error:", err);
    }
  };

  const handleSubmitReview = async () => {
    if (!selectedPlace) return;
    if (!reviewText.trim()) {
      Alert.alert("Error", "Please enter a review message.");
      return;
    }
    try {
      const token = await AsyncStorage.getItem("userToken");
      if (!token) {
        Alert.alert("Error", "You must be logged in to post a review.");
        return;
      }

      const res = await fetch(
        `https://api.greasemeter.live/v1/reviews/places/${selectedPlace.id}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            rating: parseInt(reviewRating),
            text: reviewText.trim(),
          }),
        }
      );

      if (!res.ok) {
        const text = await res.text();
        console.log("Review error:", text);
        Alert.alert("Error", "Failed to submit review.");
        return;
      }
      // Try to optimistically show the created review if returned
      try {
        const created = await res.json();
        const r = created?.data ?? created;
        if (r && (r.id || r.text)) {
          const optimistic: Review = {
            id: r.id ?? Date.now(),
            text: r.text ?? reviewText.trim(),
            rating: parseFloat(r.rating ?? reviewRating) || parseInt(reviewRating) || 0,
            relativeTime: formatRelativeTime(r?.time) ?? formatRelativeTime(new Date()),
          };
          setReviews((prev) => [optimistic, ...prev]);
        }
      } catch {}

      setReviewText("");
      setReviewRating("5");
      setShowReviewModal(false);
      await fetchReviews(selectedPlace.id);
      Alert.alert("Success", "Review submitted!");
    } catch (err) {
      console.error("Review submission error:", err);
    }
  };

  const handleSubmitReport = async () => {
    if (!selectedPlace) return;
    const reason = reportReason.trim();
    if (!reason) {
      Alert.alert("Error", "Please enter a reason to report.");
      return;
    }
    try {
      const token = await AsyncStorage.getItem("userToken");
      if (!token) {
        Alert.alert("Error", "You must be logged in to report a place.");
        return;
      }
      const res = await fetch(
        `https://api.greasemeter.live/v1/reports/places/${selectedPlace.id}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ reason }),
        }
      );
      if (!res.ok) {
        const text = await res.text();
        console.log("Report place error:", text);
        Alert.alert("Error", "Failed to report place.");
        return;
      }
      setReportReason("");
      setShowReportModal(false);
      Alert.alert("Thank you", "Your report has been submitted.");
    } catch (err) {
      console.error("Report submission error:", err);
      Alert.alert("Error", "Network issue while submitting report.");
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={DEFAULT_REGION}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {visiblePlaces.filter(placeHasValidCoords).map((place) => (
          <Marker
            key={String(place.id ?? `${place.latitude},${place.longitude}`)}
            coordinate={{ latitude: place.latitude, longitude: place.longitude }}
            onPress={() => openPlaceDetails(place)}
            tracksViewChanges={false}
          >
            <View style={{ alignItems: "center" }}>
              <View style={styles.markerDot} />
            </View>
          </Marker>
        ))}

        {/* Ensure the currently selected place is always visible as a marker */}
        {placeHasValidCoords(selectedPlace) &&
          !placeIncluded(visiblePlaces, selectedPlace) && (
            <Marker
              key={`selected-${String(selectedPlace.id ?? `${selectedPlace.latitude},${selectedPlace.longitude}`)}`}
              coordinate={{ latitude: selectedPlace.latitude, longitude: selectedPlace.longitude }}
              tracksViewChanges={false}
            >
              <View style={{ alignItems: "center" }}>
                <View style={styles.selectedMarkerDot} />
              </View>
            </Marker>
          )}
      </MapView>

      {/* Search */}
      <View style={styles.searchWrapper}>
        <View style={styles.searchInputContainer}>
          <TextInput
            style={styles.searchBar}
            placeholder="Search places..."
            placeholderTextColor="#666"
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={fetchPlaces}
            returnKeyType="search"
          />
          {search.trim().length > 0 && (
            <View style={styles.clearButtonContainer}>
              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => {
                  setSuggestions([]);
                  setSearch("");
                  Keyboard.dismiss();
                }}
                accessibilityLabel="Clear search"
              >
                <Text style={styles.clearButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        {suggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            <FlatList
              keyboardShouldPersistTaps="handled"
              data={suggestions}
              keyExtractor={(item, i) => `${item.id ?? 'no-id'}-${i}`}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.suggestionItem}
                  onPress={async () => {
                    setSuggestions([]);
                    setSearch("");
                    Keyboard.dismiss();
                    const resolved = await resolvePlaceWithCoords(item);
                    focusMapOnPlace(resolved);
                    openPlaceDetails(resolved);
                  }}
                >
                  <Text style={styles.suggestionName}>{item.name}</Text>
                  {!!item.address && (
                    <Text style={styles.suggestionAddress} numberOfLines={1}>
                      {item.address}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        )}
      </View>

      {/* List button */}
      <TouchableOpacity
        style={styles.listButton}
        onPress={() => setShowListModal(true)}
      >
        <Text style={styles.listButtonText}>📋</Text>
      </TouchableOpacity>

      {selectedPlace && (
        <TouchableWithoutFeedback onPress={closeDetails}>
          <View style={styles.overlay} />
        </TouchableWithoutFeedback>
      )}

      {/* Bottom sheet */}
      <Animated.View style={[styles.bottomSheet, { top: slideAnim }]} {...panResponder.panHandlers}>
        {selectedPlace && (
          <View style={styles.sheetContent}>
            <Text style={styles.placeTitle}>
              {selectedPlace.name}
              {selectedPlace.rating && selectedPlace.rating > 0 ? (
                <Text style={styles.placeRating}>  ⭐ {selectedPlace.rating.toFixed(1)}</Text>
              ) : null}
            </Text>
            <Text style={styles.placeAddress}>{selectedPlace.address}</Text>
            {placeImages.length > 0 && (
              <View style={styles.imagesContainer}>
                <FlatList
                  horizontal
                  data={placeImages}
                  keyExtractor={(uri, idx) => `${uri}-${idx}`}
                  showsHorizontalScrollIndicator={false}
                  renderItem={({ item, index }) => (
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => {
                        const safeIndex = Math.min(Math.max(index, 0), placeImages.length - 1);
                        setImageViewerIndex(safeIndex);
                        setImageViewerVisible(true);
                      }}
                    >
                      <Image source={{ uri: item }} style={styles.placeImage} />
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}
            <Text style={styles.sectionTitle}>Reviews</Text>
            <FlatList
              data={reviews}
              keyExtractor={(item, i) => `${item.id ?? 'no-id'}-${i}`}
              renderItem={({ item }) => (
                <View style={styles.review}>
                  <Text style={styles.reviewText}>
                    {item.name ? `${item.name} — ` : ""}⭐ {item.rating} - {item.text}{item.relativeTime ? ` • ${item.relativeTime}` : ""}
                  </Text>
                </View>
              )}
              ListEmptyComponent={<Text>No reviews yet</Text>}
            />
            {reviewHasMore && reviews.length >= 20 && (
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  {
                    backgroundColor: "#555",
                    marginTop: 8,
                    opacity: reviewLoadingMore ? 0.6 : 1,
                  },
                ]}
                onPress={handleLoadMoreReviews}
                disabled={reviewLoadingMore}
              >
                <Text style={styles.buttonText}>
                  {reviewLoadingMore ? "Loading…" : "Load More"}
                </Text>
              </TouchableOpacity>
            )}
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.actionButton} onPress={handleAddBookmark}>
                <Text style={styles.buttonText}>Add Bookmark</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: "#555" }]}
                onPress={() => setShowReviewModal(true)}
              >
                <Text style={styles.buttonText}>Add Review</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: "#c0392b" }]}
              onPress={() => setShowReportModal(true)}
            >
              <Text style={styles.buttonText}>Report Place</Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>

      {/* List Modal */}
      <Modal
        visible={showListModal}
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent
      >
        <SafeAreaView
          edges={["top", "bottom", "left", "right"]}
          style={[
            styles.modalContainer,
            {
              paddingTop: Math.max(12, (insets.top || 0) + 8),
              paddingBottom: Math.max(12, (insets.bottom || 0) + 8),
            },
          ]}
        >
          <Text style={styles.sectionTitle}>All Places</Text>
          <FlatList
            data={listPlaces}
            keyExtractor={(item, i) => `${item.id ?? `${item.latitude},${item.longitude}`}-${i}`}
            refreshing={listRefreshing}
            onRefresh={() => {
              setListRefreshing(true);
              setListPage(1);
              setListHasMore(true);
              setListPlaces([]);
              fetchListPlaces({ reset: true });
            }}
            onEndReachedThreshold={0.4}
            onEndReached={() => {
              if (!listLoading && listHasMore) fetchListPlaces();
            }}
            ListFooterComponent={
              listLoading ? (
                <Text style={{ textAlign: "center", paddingVertical: 8 }}>Loading…</Text>
              ) : null
            }
            ListEmptyComponent={
              <Text style={{ textAlign: "center", paddingVertical: 12 }}>
                {listLoading ? "Loading…" : "No places found"}
              </Text>
            }
            contentContainerStyle={{ paddingBottom: (insets.bottom || 0) + 20 }}
            onViewableItemsChanged={({ viewableItems }) => {
              try {
                const visible = (viewableItems || []).map((v: any) => v.item).filter(Boolean) as Place[];
                enrichPlacesMeta(visible);
              } catch {}
            }}
            viewabilityConfig={{ itemVisiblePercentThreshold: 40 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.placeItem}
                onPress={async () => {
                  setShowListModal(false);
                  const resolved = await resolvePlaceWithCoords(item);
                  focusMapOnPlace(resolved);
                  openPlaceDetails(resolved);
                }}
              >
                <Text style={styles.placeName}>{item.name}</Text>
                {item.rating && item.rating > 0 ? (
                  <Text style={styles.placeRating}>⭐ {item.rating.toFixed(1)}</Text>
                ) : null}
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity
            style={[styles.actionButton, { marginTop: 10 }]}
            onPress={() => setShowListModal(false)}
          >
            <Text style={styles.buttonText}>Close</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>

      {/* Image Viewer */}
      <Modal
        visible={imageViewerVisible}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={() => setImageViewerVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }} edges={["top", "bottom", "left", "right"]}>
          <TouchableOpacity
            style={[styles.imageCloseButton, { top: Math.max(28, (insets.top || 0) + 16) }]}
            onPress={() => setImageViewerVisible(false)}
          >
            <Text style={styles.imageCloseText}>Close</Text>
          </TouchableOpacity>
          <FlatList
            ref={(r) => {
              imageViewerRef.current = r;
            }}
            data={placeImages}
            keyExtractor={(uri, idx) => `${uri}-${idx}`}
            horizontal
            pagingEnabled
            initialScrollIndex={Math.min(Math.max(imageViewerIndex, 0), Math.max(placeImages.length - 1, 0))}
            getItemLayout={(data, index) => ({
              length: Dimensions.get("window").width,
              offset: Dimensions.get("window").width * index,
              index,
            })}
            renderItem={({ item }) => (
              <View style={{ width: Dimensions.get("window").width, flex: 1, justifyContent: "center", alignItems: "center" }}>
                <Image source={{ uri: item }} style={styles.fullscreenImage} resizeMode="contain" />
              </View>
            )}
            onMomentumScrollEnd={(e) => {
              const w = Dimensions.get("window").width;
              const idx = Math.round(e.nativeEvent.contentOffset.x / w);
              setImageViewerIndex(idx);
            }}
            showsHorizontalScrollIndicator={false}
          />
          <View style={styles.imageIndexBadge}>
            <Text style={styles.imageIndexText}>{`${imageViewerIndex + 1} / ${Math.max(placeImages.length, 1)}`}</Text>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Add Review Modal */}
      <Modal visible={showReviewModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.sectionTitle}>Write a Review</Text>
          <TextInput
            style={styles.input}
            placeholder="Your review..."
            placeholderTextColor="#666"
            value={reviewText}
            onChangeText={setReviewText}
            multiline
          />
          <View style={styles.ratingRow}>
            {([1, 2, 3, 4, 5] as const).map((n) => {
              const selected = String(n) === String(reviewRating);
              return (
                <TouchableOpacity
                  key={n}
                  onPress={() => setReviewRating(String(n))}
                  style={[styles.ratingButton, selected && styles.ratingButtonSelected]}
                  accessibilityRole="button"
                  accessibilityLabel={`Rate ${n}`}
                >
                  <Text style={[styles.ratingButtonText, selected && { color: "#fff" }]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: "#555" }]}
                onPress={() => setShowReviewModal(false)}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionButton} onPress={handleSubmitReview}>
                <Text style={styles.buttonText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Report Place Modal */}
      <Modal visible={showReportModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.sectionTitle}>Report Place</Text>
            <TextInput
              style={styles.input}
              placeholder="Reason for report..."
              placeholderTextColor="#666"
              value={reportReason}
              onChangeText={setReportReason}
              multiline
            />
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: "#555" }]}
                onPress={() => setShowReportModal(false)}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: "#c0392b" }]}
                onPress={handleSubmitReport}
              >
                <Text style={styles.buttonText}>Submit Report</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  searchWrapper: { position: "absolute", top: 10, left: 10, right: 10, zIndex: 10 },
  searchInputContainer: { position: "relative" },
  searchBar: {
    backgroundColor: "#fff",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    fontSize: 16,
    elevation: 3,
    paddingRight: 40,
  },
  clearButtonContainer: {
    position: "absolute",
    right: 8,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  clearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eee",
  },
  clearButtonText: { color: "#333", fontSize: 14, fontWeight: "bold" },
  suggestionsContainer: {
    marginTop: 6,
    backgroundColor: "#fff",
    borderRadius: 8,
    elevation: 4,
    maxHeight: 220,
    overflow: "hidden",
  },
  suggestionItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  suggestionName: { fontSize: 16, fontWeight: "600", color: "#000" },
  suggestionAddress: { fontSize: 12, color: "#666", marginTop: 2 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.3)" },
  bottomSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    height: "90%",
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  sheetContent: { flex: 1 },
  placeTitle: { fontSize: 20, fontWeight: "bold", marginBottom: 4 },
  placeAddress: { fontSize: 14, color: "#555", marginBottom: 12 },
  imagesContainer: { marginBottom: 12 },
  placeImage: { width: 160, height: 100, borderRadius: 8, marginRight: 8, backgroundColor: "#eee" },
  fullscreenImage: { width: "100%", height: "100%" },
  imageCloseButton: {
    position: "absolute",
    right: 16,
    top: 12,
    zIndex: 10,
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  imageCloseText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  imageIndexBadge: {
    position: "absolute",
    bottom: 16,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  imageIndexText: { color: "#fff", fontWeight: "600" },
  placeRating: { fontSize: 16, color: "#f39c12", fontWeight: "bold" },
  sectionTitle: { fontSize: 16, fontWeight: "bold", marginTop: 10 },
  review: { paddingVertical: 4 },
  reviewText: { fontSize: 14 },
  buttonRow: { flexDirection: "row", justifyContent: "space-around", marginTop: 16 },
  actionButton: {
    backgroundColor: "orange",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: 10,
  },
  buttonText: { color: "#fff", fontWeight: "bold", textAlign: "center" },
  modalContainer: { flex: 1, padding: 20, backgroundColor: "#fff" },
  placeItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  placeName: { fontSize: 16, fontWeight: "600", color: "#000" },
  listButton: {
    position: "absolute",
    bottom: 25,
    right: 20,
    backgroundColor: "orange",
    width: 55,
    height: 55,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
  },
  listButtonText: { color: "#fff", fontSize: 26, fontWeight: "bold" },
  markerRatingBubble: {
    backgroundColor: "rgba(255,165,0,0.95)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 2,
    alignItems: "center",
  },
  markerRatingText: { color: "#fff", fontWeight: "bold", fontSize: 12 },
  markerDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "orange",
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  selectedMarkerDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#007AFF",
    borderWidth: 2,
    borderColor: "#fff",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  ratingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
    marginBottom: 12,
  },
  ratingButton: {
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    backgroundColor: "#f5f5f5",
    alignItems: "center",
  },
  ratingButtonSelected: {
    backgroundColor: "orange",
    borderColor: "orange",
  },
  ratingButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
});
