import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Modal,
  RefreshControl,
  TextInput,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";

type Bookmark = {
  id: number;
  name: string;
  address?: string;
};

type Review = {
  id: number | string;
  text: string;
  rating: number;
};

export default function Bookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedBookmark, setSelectedBookmark] = useState<Bookmark | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showRecommendModal, setShowRecommendModal] = useState(false);
  const [recName, setRecName] = useState("");
  const [recAddress, setRecAddress] = useState("");
  const [submittingRec, setSubmittingRec] = useState(false);

  const API_BASE = "https://api.greasemeter.live/v1";

  // Fetch bookmarks
  const fetchBookmarks = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("userToken");
      if (!token) {
        // Clear any previously loaded bookmarks when logged out
        setBookmarks([]);
        setSelectedBookmark(null);
        setReviews([]);
        Alert.alert("Error", "You must be logged in to see bookmarks.");
        return;
      }

      const res = await fetch(`${API_BASE}/my/bookmarks`, {
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

      const res = await fetch(`${API_BASE}/my/bookmarks/${bookmarkId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errText = await res.text();
        console.log("Delete bookmark error:", errText);
        Alert.alert("Error", "Failed to delete bookmark.");
        return;
      }

      setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId));
      Alert.alert("Success", "Bookmark deleted.");
    } catch (err) {
      console.error("Error deleting bookmark:", err);
      Alert.alert("Error", "Could not delete bookmark.");
    }
  };

  // Fetch reviews for a specific place
  const fetchReviews = async (placeId: number) => {
    try {
      const res = await fetch(`${API_BASE}/places/${placeId}/reviews?page=1&limit=20`, {
        headers: { "Content-Type": "application/json" },
      });

      const text = await res.text();
      if (!res.ok) {
        console.log("Review fetch error:", text);
        setReviews([]);
        return;
      }

      const data = text ? JSON.parse(text) : {};
      const items = Array.isArray(data) ? data : data.items ?? [];
      const mapped = items.map((r: any, idx: number) => ({
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

  // Open bookmark details modal
  const openBookmarkDetails = async (bookmark: Bookmark) => {
    setSelectedBookmark(bookmark);
    await fetchReviews(bookmark.id);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedBookmark(null);
    setReviews([]);
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

  // Also refresh when the screen regains focus (e.g., after logout/login)
  useFocusEffect(
    useCallback(() => {
      fetchBookmarks();
    }, [fetchBookmarks])
  );

  // Submit recommendation
  const handleSubmitRecommendation = async () => {
    const name = recName.trim();
    const address = recAddress.trim();
    if (!name || !address) {
      Alert.alert("Missing Info", "Please enter both name and address.");
      return;
    }

    try {
      setSubmittingRec(true);
      const token = await AsyncStorage.getItem("userToken");
      if (!token) {
        Alert.alert("Error", "You must be logged in to recommend a place.");
        return;
      }

      const res = await fetch(`${API_BASE}/places/recommend`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, address }),
      });

      const text = await res.text();
      if (!res.ok) {
        console.log("Recommend place error:", text);
        let message = "Failed to submit recommendation.";
        try {
          const err = JSON.parse(text);
          message = err.error || err.message || message;
        } catch {}
        Alert.alert("Error", message);
        return;
      }

      setShowRecommendModal(false);
      setRecName("");
      setRecAddress("");
      Alert.alert("Thank you!", "Your recommendation has been submitted.");
    } catch (err) {
      console.error("Error recommending place:", err);
      Alert.alert("Error", "Network issue while submitting recommendation.");
    } finally {
      setSubmittingRec(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Bookmarks</Text>
      <FlatList
        data={bookmarks}
        keyExtractor={(item) => item.id.toString()}
        refreshing={refreshing}
        onRefresh={onRefresh}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.bookmarkItem}
            onPress={() => openBookmarkDetails(item)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.bookmarkName}>{item.name}</Text>
              {item.address && <Text style={styles.bookmarkAddress}>{item.address}</Text>}
            </View>
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => handleDeleteBookmark(item.id)}
            >
              <Text style={styles.deleteButtonText}>Remove</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text>No bookmarks yet</Text>}
        ListFooterComponent={
          <View style={{ paddingVertical: 16 }}>
            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: "#007AFF" }]}
              onPress={() => setShowRecommendModal(true)}
            >
              <Text style={styles.closeButtonText}>Recommend a Place</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* Modal for bookmark details */}
      <Modal visible={showModal} animationType="slide">
        <View style={styles.modalContainer}>
          {selectedBookmark && (
            <>
              <Text style={styles.modalTitle}>{selectedBookmark.name}</Text>
              {selectedBookmark.address ? (
                <Text style={styles.modalAddress}>{selectedBookmark.address}</Text>
              ) : null}

              <Text style={styles.sectionTitle}>Reviews</Text>
              <FlatList
                data={reviews}
                keyExtractor={(item, index) => item.id?.toString() ?? index.toString()}
                renderItem={({ item }) => (
                  <View style={styles.review}>
                    <Text style={styles.reviewText}>
                      ⭐ {item.rating} - {item.text}
                    </Text>
                  </View>
                )}
                ListEmptyComponent={<Text>No reviews yet</Text>}
              />

              <TouchableOpacity
                style={[styles.closeButton, { backgroundColor: "#555" }]}
                onPress={closeModal}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </Modal>

      {/* Recommend a Place Modal */}
      <Modal visible={showRecommendModal} animationType="slide">
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Recommend a Place</Text>
          <TextInput
            style={styles.input}
            placeholder="Place name"
            value={recName}
            onChangeText={setRecName}
          />
          <TextInput
            style={styles.input}
            placeholder="Address"
            value={recAddress}
            onChangeText={setRecAddress}
          />
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: "#555", flex: 1, marginRight: 8 }]}
              onPress={() => {
                setShowRecommendModal(false);
                setRecName("");
                setRecAddress("");
              }}
            >
              <Text style={styles.closeButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: "#007AFF", flex: 1, marginLeft: 8 }]}
              onPress={handleSubmitRecommendation}
              disabled={submittingRec}
            >
              <Text style={styles.closeButtonText}>{submittingRec ? "Submitting..." : "Submit"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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

  modalContainer: { flex: 1, padding: 20, backgroundColor: "#fff" },
  modalTitle: { fontSize: 22, fontWeight: "bold", marginBottom: 6 },
  modalAddress: { fontSize: 14, color: "#555", marginBottom: 10 },
  sectionTitle: { fontSize: 18, fontWeight: "bold", marginVertical: 10 },
  review: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#eee" },
  reviewText: { fontSize: 14, color: "#000" },
  closeButton: {
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 20,
    alignItems: "center",
  },
  closeButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    backgroundColor: "#fff",
  },
});
