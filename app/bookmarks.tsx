import React, { useEffect, useState, useCallback } from "react";
import { View, Text, FlatList, StyleSheet, Alert, TouchableOpacity } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

type Bookmark = {
  id: number;
  name: string;
  address?: string;
};

export default function Bookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch bookmarks
  const fetchBookmarks = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("userToken");
      if (!token) {
        Alert.alert("Error", "You must be logged in to see bookmarks.");
        return;
      }

      const res = await fetch("https://api.greasemeter.live/v1/my/bookmarks", {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errText = await res.text();
        console.log("Bookmark fetch error:", errText);
        return;
      }

      const data = await res.json();
      setBookmarks(data.items ?? data);
    } catch (err) {
      console.error("Error fetching bookmarks:", err);
    }
  }, []);

  // Delete bookmark
  const handleDeleteBookmark = async (bookmarkId: number) => {
    try {
      const token = await AsyncStorage.getItem("userToken");
      if (!token) {
        Alert.alert("Error", "You must be logged in to delete bookmarks.");
        return;
      }

      const res = await fetch(
        `https://api.greasemeter.live/v1/my/bookmarks/${bookmarkId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.log("Delete bookmark error:", errText);
        Alert.alert("Error", "Failed to delete bookmark.");
        return;
      }

      // Refresh list after deletion
      setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId));
      Alert.alert("Success", "Bookmark deleted.");
    } catch (err) {
      console.error("Error deleting bookmark:", err);
      Alert.alert("Error", "Could not delete bookmark.");
    }
  };

  // Pull-to-refresh
  const onRefresh = async () => {
    setRefreshing(true);
    await fetchBookmarks();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchBookmarks();
  }, [fetchBookmarks]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Bookmarks</Text>
      <FlatList
        data={bookmarks}
        keyExtractor={(item) => item.id.toString()}
        refreshing={refreshing}
        onRefresh={onRefresh}
        renderItem={({ item }) => (
          <View style={styles.bookmarkItem}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bookmarkName}>{item.name}</Text>
              {item.address && (
                <Text style={styles.bookmarkAddress}>{item.address}</Text>
              )}
            </View>
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => handleDeleteBookmark(item.id)}
            >
              <Text style={styles.deleteButtonText}>Remove</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={<Text>No bookmarks yet</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 12 },
  bookmarkItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  bookmarkName: { fontSize: 16, fontWeight: "bold" },
  bookmarkAddress: { fontSize: 14, color: "#555" },
  deleteButton: {
    backgroundColor: "red",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginLeft: 10,
  },
  deleteButtonText: { color: "#fff", fontWeight: "bold" },
});
