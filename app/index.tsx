import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  TextInput,
  Keyboard,
  Platform,
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
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
};

type Review = {
  id: number | string;
  text: string;
  rating: number;
};

export default function MapScreen() {
  const [search, setSearch] = useState("");
  const mapRef = useRef<MapView | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewText, setReviewText] = useState("");
  const [reviewRating, setReviewRating] = useState("5");
  const [showReviewModal, setShowReviewModal] = useState(false);

  const screenHeight = Dimensions.get("window").height;

  const SNAP_POINTS = {
    CLOSED: screenHeight,
    HALF: screenHeight * 0.5,
    FULL: screenHeight * 0.1,
  };

  const slideAnim = useRef(new Animated.Value(SNAP_POINTS.CLOSED)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 5,
      onPanResponderMove: (_, gesture) => {
        const newPos = slideAnim.__getValue() + gesture.dy;
        if (newPos >= SNAP_POINTS.FULL && newPos <= SNAP_POINTS.CLOSED) {
          slideAnim.setValue(newPos);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        let newPos = SNAP_POINTS.HALF;
        if (gesture.dy > 100) newPos = SNAP_POINTS.CLOSED;
        else if (gesture.dy < -100) newPos = SNAP_POINTS.FULL;
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

        Animated.spring(slideAnim, {
          toValue: newPos,
          useNativeDriver: false,
        }).start(() => {
          if (newPos === SNAP_POINTS.CLOSED) {
            setSelectedPlace(null);
            setReviews([]);
          }
        });
      },
    })
  ).current;

  useEffect(() => {
    const fetchPlaces = async () => {
      try {
        const response = await fetch(
          "https://api.greasemeter.live/v1/places?lat=39.95&lng=-75.165&latDelta=0.1&lngDelta=0.1"
        );
        const data = await response.json();
        setPlaces(
          data.map((p: any) => ({
            id: p.id,
            name: p.name,
            latitude: p.point?.coordinates?.[1] ?? 0,
            longitude: p.point?.coordinates?.[0] ?? 0,
            address: p.address ?? "",
          }))
        );
      } catch (err) {
        console.error("Failed to fetch places:", err);
      }
    };
    fetchPlaces();
  }, []);

  const fetchReviews = async (placeId: number) => {
    try {
      const response = await fetch(
        `https://api.greasemeter.live/v1/places/${placeId}/reviews?page=1&limit=20`
      );
      if (!response.ok) {
        console.log("Fetch reviews failed:", await response.text());
        setReviews([]);
        return;
      }
      const data = await response.json();
      const reviewsArray = data.items ?? data;
      const mapped = reviewsArray.map((r: any, idx: number) => ({
        id: r.id ?? r.review_id ?? idx,
        text: r.text ?? r.comment ?? "",
        rating: r.rating ?? r.stars ?? 0,
      }));
      setReviews(mapped);
    } catch (err) {
      console.error("Error fetching reviews:", err);
      setReviews([]);
    }
  };

  const handleSearch = async () => {
    if (!search.trim()) return;
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(search)}`
      );
      const data = await response.json();
      if (data && data.length > 0) {
        const { lat, lon } = data[0];
        const region: Region = {
          latitude: parseFloat(lat),
          longitude: parseFloat(lon),
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        };
        mapRef.current?.animateToRegion(region, 1000);
        Keyboard.dismiss();
      }
    } catch (err) {
      console.error("Search error:", err);
    }
  };

  const openPlaceDetails = async (place: Place) => {
    setSelectedPlace(place);
    await fetchReviews(place.id);

    Animated.spring(slideAnim, {
      toValue: SNAP_POINTS.HALF,
      useNativeDriver: false,
    }).start();
  };

  const closeDetails = () => {
    Animated.spring(slideAnim, {
      toValue: SNAP_POINTS.CLOSED,
      useNativeDriver: false,
    }).start(() => {
      setSelectedPlace(null);
      setReviews([]);
    });
  };

  // ✅ Add Bookmark functionality
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
        const errText = await res.text();
        console.log("Bookmark error:", errText);
        Alert.alert("Error", "Failed to add bookmark.");
        return;
      }

      Alert.alert("Success", `${selectedPlace.name} has been bookmarked!`);
    } catch (err) {
      console.error("Bookmark error:", err);
      Alert.alert("Error", "Could not add bookmark.");
    }
  };

  const handleAddReview = () => setShowReviewModal(true);

  const submitReview = async () => {
    if (!reviewText.trim() || !selectedPlace) {
      Alert.alert("Error", "Please enter review text and rating.");
      return;
    }

    try {
      const token = await AsyncStorage.getItem("userToken");
      if (!token) {
        Alert.alert("Error", "You must be logged in to post a review.");
        return;
      }

      const payload = { rating: parseInt(reviewRating), text: reviewText.trim() };
      const res = await fetch(
        `https://api.greasemeter.live/v1/places/${selectedPlace.id}/reviews`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.log("Review error:", errText);
        Alert.alert("Error", "Failed to post review.");
        return;
      }

      await fetchReviews(selectedPlace.id);
      setReviewText("");
      setReviewRating("5");
      setShowReviewModal(false);
    } catch (err) {
      console.error("Network error:", err);
      Alert.alert("Error", "Could not submit review.");
    }
  };

  return (
    <View style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: 39.9526,
          longitude: -75.1652,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1,
        }}
      >
        {places.map((place) => (
          <Marker
            key={place.id}
            coordinate={{ latitude: place.latitude, longitude: place.longitude }}
            title={place.name}
            onPress={() => openPlaceDetails(place)}
          />
        ))}
      </MapView>

      {/* Search bar */}
      <View style={styles.searchWrapper}>
        <TextInput
          style={styles.searchBar}
          placeholder="Search places..."
          placeholderTextColor={"#888"}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
      </View>

      {selectedPlace && (
        <TouchableWithoutFeedback onPress={closeDetails}>
          <View style={styles.overlay} />
        </TouchableWithoutFeedback>
      )}

      {/* Bottom sheet */}
      <Animated.View style={[styles.bottomSheet, { top: slideAnim }]} {...panResponder.panHandlers}>
        {selectedPlace && (
          <View style={styles.sheetContent}>
            <Text style={styles.placeTitle}>{selectedPlace.name}</Text>
            <Text style={styles.placeAddress}>{selectedPlace.address}</Text>

            <Text style={styles.sectionTitle}>Reviews</Text>
            <FlatList
              data={reviews}
              keyExtractor={(item, index) => item.id?.toString() ?? index.toString()}
              renderItem={({ item }) => (
                <View style={styles.review}>
                  <Text style={styles.reviewText}>⭐ {item.rating} - {item.text}</Text>
                </View>
              )}
              ListEmptyComponent={<Text>No reviews yet</Text>}
            />

            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.actionButton} onPress={handleAddBookmark}>
                <Text style={styles.buttonText}>Add Bookmark</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionButton} onPress={handleAddReview}>
                <Text style={styles.buttonText}>Add Review</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Animated.View>

      {/* Review Modal */}
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
              placeholder="Rating (1-5)"
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
              <TouchableOpacity style={styles.actionButton} onPress={submitReview}>
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
  searchWrapper: {
    position: "absolute",
    top: Platform.OS === "ios" ? 10 : 5,
    left: 10,
    right: 10,
    zIndex: 10,
  },
  searchBar: {
    backgroundColor: "#fff",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    fontSize: 16,
    elevation: 3,
  },
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
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: { width: "100%", backgroundColor: "#fff", borderRadius: 12, padding: 20 },
});
