import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  TextInput,
  Keyboard,
  TouchableOpacity,
  Text,
  FlatList,
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
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showListModal, setShowListModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const [reviewRating, setReviewRating] = useState("5");

  const mapRef = useRef<MapView | null>(null);
  const searchTimeoutRef = useRef<any>(null);
  const searchQueryIdRef = useRef(0);

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
      const res = await fetch(
        "https://api.greasemeter.live/v1/places?lat=39.95&lng=-75.165&latDelta=0.1&lngDelta=0.1"
      );
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
            [p.lng ?? p.longitude, p.lat ?? p.latitude];
          const lon = parseFloat(coords?.[0]);
          const lat = parseFloat(coords?.[1]);
          if (isNaN(lat) || isNaN(lon)) return null;
          return {
            id: p.id ?? p.place_id,
            name: p.name ?? "Unnamed Place",
            latitude: lat,
            longitude: lon,
            address: p.address ?? "",
            rating: parseFloat(p.avg_rating ?? p.rating ?? 0),
          };
        })
        .filter(Boolean);
      setPlaces(mapped);
    } catch (err) {
      console.error("Failed to fetch places:", err);
    }
  };

  useEffect(() => {
    fetchPlaces();
  }, []);

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
              [p.lng ?? p.longitude, p.lat ?? p.latitude];
            const lon = parseFloat(coords?.[0]);
            const lat = parseFloat(coords?.[1]);
            if (isNaN(lat) || isNaN(lon)) return null;
            return {
              id: p.id ?? p.place_id,
              name: p.name ?? "Unnamed Place",
              latitude: lat,
              longitude: lon,
              address: p.address ?? "",
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
      const res = await fetch(
        `https://api.greasemeter.live/v1/places/${placeId}/reviews?page=1&limit=20`
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
    setSelectedPlace(place);
    await fetchReviews(place.id);
    Animated.spring(slideAnim, { toValue: SNAP_POINTS.HALF, useNativeDriver: false }).start();
  };

  const closeDetails = () => {
    Animated.spring(slideAnim, { toValue: SNAP_POINTS.CLOSED, useNativeDriver: false }).start(() => {
      setSelectedPlace(null);
      setReviews([]);
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
        {places.map((place) => (
          <Marker
            key={place.id}
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
              keyExtractor={(item, i) => item.id?.toString() ?? i.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.suggestionItem}
                  onPress={() => {
                    setSuggestions([]);
                    setSearch(item.name);
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
            <Text style={styles.sectionTitle}>Reviews</Text>
            <FlatList
              data={reviews}
              keyExtractor={(item, i) => item.id?.toString() ?? i.toString()}
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
      <Modal visible={showListModal} animationType="slide">
        <View style={styles.modalContainer}>
          <Text style={styles.sectionTitle}>All Places</Text>
          <FlatList
            data={places}
            keyExtractor={(item) => item.id.toString()}
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
