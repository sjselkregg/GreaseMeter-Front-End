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
} from "react-native";
import MapView, { Marker, Region } from "react-native-maps";

type Place = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
};

type Review = {
  id: number;
  text: string;
  rating: number;
};

export default function MapScreen() {
  const [search, setSearch] = useState("");
  const mapRef = useRef<MapView | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);

  const screenHeight = Dimensions.get("window").height;

  //Snap positions
  const SNAP_POINTS = {
    CLOSED: screenHeight,
    HALF: screenHeight * 0.5,
    FULL: screenHeight * 0.1,
  };

  const slideAnim = useRef(new Animated.Value(SNAP_POINTS.CLOSED)).current;

  //PanResponder for drag gestures
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

        if (gesture.dy > 100) {
          // Swipe down → close
          newPos = SNAP_POINTS.CLOSED;
        } else if (gesture.dy < -100) {
          // Swipe up → full
          newPos = SNAP_POINTS.FULL;
        } else {
          // Snap to nearest point
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

  //Fetch cheesesteak places
  useEffect(() => {
    const fetchPlaces = async () => {
      try {
        const response = await fetch(
          "https://api.greasemeter.live/api/v1/places?lat=39.95&lng=-75.165&latDelta=0.1&lngDelta=0.1"
        );
        const data = await response.json();
        console.log("Places API response:", data);

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

  const handleSearch = async () => {
    if (!search.trim()) return;

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          search
        )}`
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

    try {
      const response = await fetch(
        `https://api.greasemeter.live/api/v1/places/${place.id}/reviews`
      );
      const data = await response.json();
      setReviews(data);
    } catch {
      setReviews([]);
    }

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

  //Placeholder button handlers
  const handleAddBookmark = () => {
    console.log("Add Bookmark pressed for place:", selectedPlace?.id);
  };

  const handleAddReview = () => {
    console.log("Add Review pressed for place:", selectedPlace?.id);
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
            coordinate={{
              latitude: place.latitude,
              longitude: place.longitude,
            }}
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

      {/* Overlay for closing on outside tap */}
      {selectedPlace && (
        <TouchableWithoutFeedback onPress={closeDetails}>
          <View style={styles.overlay} />
        </TouchableWithoutFeedback>
      )}

      {/* Bottom sheet */}
      <Animated.View
        style={[styles.bottomSheet, { top: slideAnim }]}
        {...panResponder.panHandlers}
      >
        {selectedPlace && (
          <View style={styles.sheetContent}>
            <Text style={styles.placeTitle}>{selectedPlace.name}</Text>
            <Text style={styles.placeAddress}>{selectedPlace.address}</Text>

            <Text style={styles.sectionTitle}>Reviews</Text>
            <FlatList
              data={reviews}
              keyExtractor={(item) => item.id.toString()}
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
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleAddBookmark}
              >
                <Text style={styles.buttonText}>Add Bookmark</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleAddReview}
              >
                <Text style={styles.buttonText}>Add Review</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Animated.View>
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
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
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
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 16,
  },
  actionButton: {
    backgroundColor: "orange",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  buttonText: { color: "#fff", fontWeight: "bold" },
});
