import React, { useState, useRef } from "react";
import { StyleSheet, View, TextInput, Keyboard, Platform, TouchableOpacity, Text } from "react-native";
import MapView, { Region } from "react-native-maps";

export default function MapScreen() {
  const [search, setSearch] = useState("");
  const mapRef = useRef<MapView | null>(null);

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

  const handleAddLocation = () => {
    // This is where you'll handle the "+" button press
    console.log("Add location button pressed!");
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
      />

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

      {/* Floating + Button */}
      <TouchableOpacity style={styles.addButton} onPress={handleAddLocation}>
        <Text style={styles.addButtonText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  addButton: {
    position: "absolute",
    bottom: 30,
    right: 20,
    backgroundColor: "orange",
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  addButtonText: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "bold",
  },
});
