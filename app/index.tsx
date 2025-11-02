import React, { useState, useEffect, useRef } from "react";
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

type Place = {
  id: number | string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  rating?: number;
};

type Review = {
  id: number | string;
  text: string;
  rating: number;
};

export default function MapScreen() {
  const [search, setSearch] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
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
  const [placeImages, setPlaceImages] = useState<string[]>([]);

  const mapRef = useRef<MapView | null>(null);
  const searchTimeoutRef = useRef<any>(null);
  const searchQueryIdRef = useRef(0);
  const metaCacheRef = useRef<
    Map<string | number, { name?: string; address?: string; rating?: number }>
  >(new Map());
  const metaInFlightRef = useRef<Set<string | number>>(new Set());

  const screenHeight = Dimensions.get("window").height;
  const initialRegion: Region = {
    latitude: 39.9526,
    longitude: -75.1652,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  };
  const [region, setRegion] = useState<Region>(initialRegion);
  const SNAP_POINTS = {
    CLOSED: screenHeight,
    HALF: screenHeight * 0.5,
    FULL: screenHeight * 0.1,
  };
  const slideAnim = useRef(new Animated.Value(SNAP_POINTS.CLOSED)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5,
      onPanResponderMove: (_, g) => {
        const newPos = slideAnim.__getValue() + g.dy;
        if (newPos >= SNAP_POINTS.FULL && newPos <= SNAP_POINTS.CLOSED)
          slideAnim.setValue(newPos);
      },
      onPanResponderRelease: (_, g) => {
        let newPos = SNAP_POINTS.HALF;
        if (g.dy > 100) newPos = SNAP_POINTS.CLOSED;
        else if (g.dy < -100) newPos = SNAP_POINTS.FULL;
        else {
          const current = slideAnim.__getValue();
          const distances = [
            { pos: SNAP_POINTS.FULL, dist: Math.abs(current - SNAP_POINTS.FULL) },
            { pos: SNAP_POINTS.HALF, dist: Math.abs(current - SNAP_POINTS.HALF) },
            { pos: SNAP_POINTS.CLOSED, dist: Math.abs(current - SNAP_POINTS.CLOSED) },
          ];
          distances.sort((a, b) => a.dist - b.dist);
          newPos = distances[0].pos;
        }
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
  const fetchPlaces = async () => {
    try {
      const url = `https://api.greasemeter.live/v1/places/map?lat=${region.latitude}&lng=${region.longitude}&latDelta=${region.latitudeDelta}&lngDelta=${region.longitudeDelta}`;
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
          const lon = parseFloat(coords?.[0]);
          const lat = parseFloat(coords?.[1]);
          if (isNaN(lat) || isNaN(lon)) return null;
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
          };
          const cached = metaCacheRef.current.get(base.id);
          return cached ? { ...base, ...cached } : base;
        })
        .filter(Boolean);
      setRawPlaces(mapped as Place[]);
      // Enrich names/addresses asynchronously for list view
      enrichPlacesMeta(mapped as Place[]);
    } catch (err) {
      console.error("Failed to fetch places:", err);
    }
  };

  // Fetch list view results from server (paginated)
  const fetchListPlaces = async (opts?: { reset?: boolean; pageSize?: number }) => {
    const reset = Boolean(opts?.reset);
    const limit = Math.max(1, Math.min(50, opts?.pageSize ?? 20));
    const nextPage = reset ? 1 : listPage;
    if (listLoading) return;
    setListLoading(true);
    try {
      const url = `https://api.greasemeter.live/v1/places/map?lat=${region.latitude}&lng=${region.longitude}&latDelta=${region.latitudeDelta}&lngDelta=${region.longitudeDelta}&page=${nextPage}&limit=${limit}`;
      const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
      const data = await res.json();
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
          const lon = parseFloat(coords?.[0]);
          const lat = parseFloat(coords?.[1]);
          if (isNaN(lat) || isNaN(lon)) return null;
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
          };
          // Merge any cached meta immediately for better list UX
          const cached = metaCacheRef.current.get(base.id);
          return cached ? { ...base, ...cached } : base;
        })
        .filter(Boolean) as Place[];

      if (reset) setListPlaces(mapped);
      else setListPlaces((prev) => [...prev, ...mapped]);

      // hasMore: prefer explicit flag if present
      const moreFlag = Boolean(
        (data && data.more === true) ||
          (data?.data && data.data.more === true) ||
          (data?.pagination && data.pagination.hasMore === true)
      );
      setListHasMore(moreFlag || (Array.isArray(mapped) && mapped.length >= limit));
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

  // Fetch meta for places lacking name/address and patch results into state
  const enrichPlacesMeta = async (list: Place[]) => {
    const candidates = list.slice(0, 40); // cap to avoid overfetching
    for (const p of candidates) {
      if (!p) continue;
      const needs = !p.name || p.name === "Unnamed Place" || !p.address;
      if (!needs) continue;
      const pidStr = typeof p.id === 'string' ? p.id : String(p.id);
      if (!pidStr || (typeof pidStr === 'string' && pidStr.includes(','))) {
        // Skip if we don't have a real place id
        continue;
      }
      if (metaCacheRef.current.has(p.id) || metaInFlightRef.current.has(p.id)) continue;
      metaInFlightRef.current.add(p.id);
      try {
        const res = await fetch(`https://api.greasemeter.live/v1/places/${pidStr}/meta`, {
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) continue;
        const meta = await res.json();
        const m = meta?.data ?? meta;
        const patch: Partial<Place> = {};
        if (typeof m?.name === "string" && m.name.trim()) patch.name = m.name;
        if (typeof m?.address === "string" && m.address.trim()) patch.address = m.address;
        if (typeof m?.rating === "number") patch.rating = m.rating;
        if (Object.keys(patch).length) {
          metaCacheRef.current.set(p.id, {
            name: patch.name,
            address: patch.address,
            rating: patch.rating,
          });
          // Patch both map and list data with the enriched meta
          setRawPlaces((prev) => prev.map((it) => (it.id === p.id ? { ...it, ...patch } : it)));
          setListPlaces((prev) => prev.map((it) => (it.id === p.id ? { ...it, ...patch } : it)));
        }
      } catch {}
      finally {
        metaInFlightRef.current.delete(p.id);
      }
    }
  };

  useEffect(() => {
    fetchPlaces();
  }, []);

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
  }, [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta]);

  // Sample markers to avoid clutter when zoomed out
  const samplePlacesForRegion = (all: Place[], r: Region): Place[] => {
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
  };

  useEffect(() => {
    setPlaces(samplePlacesForRegion(rawPlaces, region));
  }, [rawPlaces, region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta]);

  // Debounced autocomplete tied to the search bar
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const term = search.trim();
    if (term.length < 2) {
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
            const coords =
              p.point?.coordinates ??
              p.geometry?.coordinates ??
              [
                p.lng ?? p.longitude ?? p.location?.lng ?? p.center?.[0] ?? p.coordinates?.[0],
                p.lat ?? p.latitude ?? p.location?.lat ?? p.center?.[1] ?? p.coordinates?.[1],
              ];
            const lon = parseFloat(coords?.[0]);
            const lat = parseFloat(coords?.[1]);
            if (isNaN(lat) || isNaN(lon)) return null;
            return {
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
            } as Place;
          })
          .filter(Boolean) as Place[];

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
  const fetchReviews = async (placeId: number | string) => {
    try {
      const token = await AsyncStorage.getItem("userToken");
      const res = await fetch(
        `https://api.greasemeter.live/v1/places/${placeId}/reviews?page=1&limit=20`,
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
      }));
      setReviews(mapped);
    } catch (err) {
      console.error("Error fetching reviews:", err);
      setReviews([]);
    }
  };

  const openPlaceDetails = async (place: Place) => {
    setSuggestions([]);
    // Set selected with current info, then enrich with meta
    setSelectedPlace(place);
    // Fetch meta to fill in name/address/rating if missing from map envelope
    (async () => {
      try {
        const placeId = place.id;
        const pidStr = typeof placeId === 'string' ? placeId : String(placeId);
        if (!placeId || (typeof pidStr === 'string' && pidStr.includes(','))) {
          // Skip meta fetch if we don't have a real place id
          return;
        }
        const res = await fetch(`https://api.greasemeter.live/v1/places/${pidStr}/meta`, {
          headers: { "Content-Type": "application/json" },
        });
        if (res.ok) {
          const meta = await res.json();
          const m = meta?.data ?? meta;
          setSelectedPlace((prev) => {
            if (!prev || prev.id !== place.id) return prev;
            return {
              ...prev,
              name: typeof m?.name === "string" && m.name.trim() ? m.name : prev.name,
              address: typeof m?.address === "string" && m.address.trim() ? m.address : prev.address,
              rating:
                typeof m?.rating === "number"
                  ? m.rating
                  : (typeof prev?.rating === "number" ? prev.rating : 0),
            } as Place;
          });
        }
      } catch (e) {
        // Silent fail; keep existing fallback values
      }
    })();
    // Fetch images and possibly refined rating
    (async () => {
      try {
        const placeId = place.id;
        const pidStr = typeof placeId === 'string' ? placeId : String(placeId);
        if (!placeId || (typeof pidStr === 'string' && pidStr.includes(','))) {
          setPlaceImages([]);
          return;
        }
        const res = await fetch(`https://api.greasemeter.live/v1/places/${pidStr}/info`, {
          headers: { "Content-Type": "application/json" },
        });
        if (res.ok) {
          const info = await res.json();
          const i = info?.data ?? info;
          const imgsCandidate = Array.isArray(i)
            ? i
            : Array.isArray(i?.images)
            ? i.images
            : Array.isArray(i?.items)
            ? i.items
            : Array.isArray(i?.data)
            ? i.data
            : [];
          const urls = (imgsCandidate as any[])
            .map((it) => {
              if (!it) return null;
              if (typeof it === "string") return it;
              return it.url || it.src || it.image || it.link || null;
            })
            .filter((u): u is string => typeof u === "string" && !!u);
          setPlaceImages(urls);
          if (typeof i?.rating === "number") {
            setSelectedPlace((prev) => (prev && prev.id === place.id ? { ...prev, rating: i.rating } : prev));
          }
        } else {
          setPlaceImages([]);
        }
      } catch (e) {
        setPlaceImages([]);
      }
    })();
    await fetchReviews(place.id);
    Animated.spring(slideAnim, { toValue: SNAP_POINTS.HALF, useNativeDriver: false }).start();
  };

  const closeDetails = () => {
    Animated.spring(slideAnim, { toValue: SNAP_POINTS.CLOSED, useNativeDriver: false }).start(() => {
      setSelectedPlace(null);
      setReviews([]);
      setPlaceImages([]);
    });
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
        `https://api.greasemeter.live/v1/places/${selectedPlace.id}/bookmarks`,
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
        `https://api.greasemeter.live/v1/places/${selectedPlace.id}/reviews`,
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

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        onRegionChangeComplete={(r) => setRegion(r)}
      >
        {places.map((place, idx) => (
          <Marker
            key={`${place.id}-${place.latitude}-${place.longitude}-${idx}`}
            coordinate={{ latitude: place.latitude, longitude: place.longitude }}
            onPress={() => openPlaceDetails(place)}
          >
            <View style={{ alignItems: "center" }}>
              {place.rating && place.rating > 0 ? (
                <View style={styles.markerRatingBubble}>
                  <Text style={styles.markerRatingText}>
                    ⭐ {place.rating.toFixed(1)}
                  </Text>
                </View>
              ) : null}
              <View style={styles.markerDot} />
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Search */}
      <View style={styles.searchWrapper}>
        <TextInput
          style={styles.searchBar}
          placeholder="Search places..."
          placeholderTextColor="#888"
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={fetchPlaces}
          returnKeyType="search"
        />
        {(suggestions.length > 0) && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={() => {
              setSuggestions([]);
              setSearch("");
              Keyboard.dismiss();
            }}
            accessibilityLabel="Clear suggestions"
          >
            <Text style={styles.clearButtonText}>✕</Text>
          </TouchableOpacity>
        )}
        {suggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            <FlatList
              keyboardShouldPersistTaps="handled"
              data={suggestions}
              keyExtractor={(item, i) => `${item.id ?? 'no-id'}-${i}`}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.suggestionItem}
                  onPress={() => {
                    setSuggestions([]);
                    setSearch(item.name || "");
                    Keyboard.dismiss();
                    mapRef.current?.animateToRegion(
                      {
                        latitude: item.latitude,
                        longitude: item.longitude,
                        latitudeDelta: 0.01,
                        longitudeDelta: 0.01,
                      },
                      600
                    );
                    openPlaceDetails(item);
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
                  renderItem={({ item }) => (
                    <Image source={{ uri: item }} style={styles.placeImage} />
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
                    ⭐ {item.rating} - {item.text}
                  </Text>
                </View>
              )}
              ListEmptyComponent={<Text>No reviews yet</Text>}
            />
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
          </View>
        )}
      </Animated.View>

      {/* List Modal */}
      <Modal
        visible={showListModal}
        animationType="slide"
        onShow={() => {
          // When opening list view, fetch fresh list from server for current region
          setListPage(1);
          setListHasMore(true);
          setListPlaces([]);
          fetchListPlaces({ reset: true });
        }}
      >
        <View style={styles.modalContainer}>
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
                onPress={() => {
                  setShowListModal(false);
                  openPlaceDetails(item);
                  mapRef.current?.animateToRegion(
                    {
                      latitude: item.latitude,
                      longitude: item.longitude,
                      latitudeDelta: 0.01,
                      longitudeDelta: 0.01,
                    },
                    1000
                  );
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
        </View>
      </Modal>

      {/* Add Review Modal */}
      <Modal visible={showReviewModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.sectionTitle}>Write a Review</Text>
            <TextInput
              style={styles.input}
              placeholder="Your review..."
              value={reviewText}
              onChangeText={setReviewText}
              multiline
            />
            <TextInput
              style={styles.input}
              placeholder="Rating (1–5)"
              keyboardType="numeric"
              value={reviewRating}
              onChangeText={setReviewRating}
            />
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  searchWrapper: { position: "absolute", top: 10, left: 10, right: 10, zIndex: 10 },
  searchBar: {
    backgroundColor: "#fff",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    fontSize: 16,
    elevation: 3,
    paddingRight: 36,
  },
  clearButton: {
    position: "absolute",
    right: 16,
    top: 14,
    width: 24,
    height: 24,
    borderRadius: 12,
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
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "orange",
    borderWidth: 1.5,
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
});
