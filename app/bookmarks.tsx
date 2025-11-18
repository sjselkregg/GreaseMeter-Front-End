import React, { useEffect, useState, useCallback, useRef } from "react";
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
  Image,
  Dimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { formatRelativeTime } from "../utils/time";

type Bookmark = {
  id: number;
  name: string;
  address?: string;
  place_id?: number | string;
  placeId?: number | string;
};

type Review = {
  id: number | string;
  text: string;
  rating: number;
  relativeTime?: string;
};

export default function Bookmarks() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const screenWidth = Dimensions.get("window").width;
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedBookmark, setSelectedBookmark] = useState<Bookmark | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showRecommendModal, setShowRecommendModal] = useState(false);
  const [recName, setRecName] = useState("");
  const [recAddress, setRecAddress] = useState("");
  const [submittingRec, setSubmittingRec] = useState(false);
  const [editBookmarks, setEditBookmarks] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewHasMore, setReviewHasMore] = useState(false);
  const [reviewLoadingMore, setReviewLoadingMore] = useState(false);
  const [currentPlaceId, setCurrentPlaceId] = useState<number | string | null>(null);
  const [bookmarkImages, setBookmarkImages] = useState<string[]>([]);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [imageViewerIndex, setImageViewerIndex] = useState(0);
  const imageViewerRef = useRef<FlatList<string> | null>(null);

  const API_BASE = "https://api.greasemeter.live/v1";

  // Fetch bookmarks
  const fetchBookmarks = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("userToken");
      const logged = Boolean(token);
      setIsLoggedIn(logged);
      if (!logged) {
        // Clear any previously loaded bookmarks when logged out
        setBookmarks([]);
        setSelectedBookmark(null);
        setReviews([]);
        return;
      }

      const res = await fetch(`${API_BASE}/bookmarks`, {
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

      const raw = await res.json().catch(() => null);
      if (!raw) {
        setBookmarks([]);
        return;
      }
      const candidates = [
        Array.isArray(raw) ? raw : undefined,
        Array.isArray(raw?.items) ? raw.items : undefined,
        Array.isArray(raw?.data?.items) ? raw.data.items : undefined,
      ];
      const normalized = (candidates.find((c) => Array.isArray(c)) as Bookmark[]) ?? [];
      setBookmarks(normalized);
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

      const res = await fetch(`${API_BASE}/bookmarks/${bookmarkId}`, {
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
  const fetchReviews = async (
    placeId?: number | string | null,
    opts?: { page?: number; append?: boolean }
  ) => {
    if (placeId == null || (typeof placeId === "string" && !placeId.trim())) {
      setReviews([]);
      return;
    }
    const page = Math.max(1, opts?.page ?? 1);
    const limit = 20;
    const append = opts?.append ?? page > 1;
    if (append) setReviewLoadingMore(true);
    try {
      const token = await AsyncStorage.getItem("userToken");
      const pidStr = typeof placeId === "string" ? placeId : String(placeId);
      const res = await fetch(`${API_BASE}/reviews/places/${pidStr}?page=${page}&limit=${limit}`, {
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const text = await res.text();
      if (!res.ok) {
        console.log("Review fetch error:", text);
        setReviews([]);
        return;
      }

      const data = text ? JSON.parse(text) : {};
      const candidates = [
        Array.isArray(data) ? data : undefined,
        data?.items,
        data?.data?.items,
        data?.data?.results,
        data?.data?.reviews,
        data?.data,
        data?.results,
        data?.reviews,
      ];
      const items = (candidates.find((c) => Array.isArray(c)) as any[]) ?? [];
      const mapped = items.map((r: any, idx: number) => ({
        id: r.id ?? r.review_id ?? idx,
        text: r.text ?? r.comment ?? "",
        rating: r.rating ?? r.stars ?? 0,
        relativeTime: formatRelativeTime(r?.time),
      }));

      setReviews((prev) => (append ? [...prev, ...mapped] : mapped));
      const moreFlag =
        data?.more === true ||
        data?.data?.more === true ||
        data?.pagination?.hasMore === true;
      setReviewHasMore(Boolean(moreFlag || (mapped.length >= limit)));
      setReviewPage(page);
    } catch (err) {
      console.error("Error fetching reviews:", err);
      if (!opts?.append) setReviews([]);
    } finally {
      if (append) setReviewLoadingMore(false);
    }
  };

  const fetchBookmarkImages = async (placeId?: number | string | null) => {
    if (placeId == null || (typeof placeId === "string" && !placeId.trim())) {
      setBookmarkImages([]);
      return;
    }
    try {
      const pidStr = typeof placeId === "string" ? placeId : String(placeId);
      const res = await fetch(`${API_BASE}/places/${pidStr}/map`, {
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        setBookmarkImages([]);
        return;
      }
      const payload = await res.json();
      const data = payload?.data ?? payload;
      const candidates = [
        Array.isArray(data?.images) ? data.images : undefined,
        Array.isArray(data?.items) ? data.items : undefined,
        Array.isArray(data?.data) ? data.data : undefined,
      ];
      const arr = (candidates.find((c) => Array.isArray(c)) as any[]) ?? [];
      const urls = arr
        .map((img) =>
          typeof img === "string" ? img : img?.url ?? img?.src ?? img?.image ?? img?.link ?? null
        )
        .filter((u): u is string => typeof u === "string" && !!u);
      setBookmarkImages(urls);
    } catch (err) {
      console.warn("Failed to fetch bookmark images:", err);
      setBookmarkImages([]);
    }
  };

  // Open bookmark details modal
  const openBookmarkDetails = async (bookmark: Bookmark) => {
    setSelectedBookmark(bookmark);
    const placeId = bookmark.place_id ?? bookmark.placeId ?? bookmark.id;
    setCurrentPlaceId(placeId ?? null);
    setReviewPage(1);
    setReviewHasMore(false);
    setReviewLoadingMore(false);
    setBookmarkImages([]);
    setImageViewerIndex(0);
    setImageViewerVisible(false);
    await Promise.all([
      fetchReviews(placeId, { page: 1, append: false }),
      fetchBookmarkImages(placeId),
    ]);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedBookmark(null);
    setReviews([]);
    setReviewPage(1);
    setReviewHasMore(false);
    setReviewLoadingMore(false);
    setCurrentPlaceId(null);
    setBookmarkImages([]);
    setImageViewerIndex(0);
    setImageViewerVisible(false);
  };

  const handleLoadMoreReviews = async () => {
    if (!currentPlaceId || reviewLoadingMore || !reviewHasMore) return;
    await fetchReviews(currentPlaceId, { page: reviewPage + 1, append: true });
  };

  const handleOpenImageViewer = (index: number) => {
    if (!bookmarkImages.length) return;
    const safeIndex = Math.max(0, Math.min(index, Math.max(bookmarkImages.length - 1, 0)));
    setImageViewerIndex(safeIndex);
    setImageViewerVisible(true);
  };

  useEffect(() => {
    if (!imageViewerVisible || !imageViewerRef.current) return;
    const safeIndex = Math.max(0, Math.min(imageViewerIndex, Math.max(bookmarkImages.length - 1, 0)));
    try {
      imageViewerRef.current.scrollToOffset({
        offset: screenWidth * safeIndex,
        animated: false,
      });
    } catch {}
  }, [imageViewerVisible, imageViewerIndex, screenWidth, bookmarkImages.length]);


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

      const res = await fetch(`${API_BASE}/recommendations`, {
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
      {isLoggedIn === false ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 18, color: "#000", textAlign: "center", marginBottom: 12 }}>
            Sign in to add/view bookmarks!
          </Text>
          <TouchableOpacity
            style={{ backgroundColor: "#007AFF", paddingVertical: 12, paddingHorizontal: 30, borderRadius: 8, marginVertical: 6 }}
            onPress={() => router.push({ pathname: "/account", params: { mode: "login" } })}
          >
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "bold" }}>Sign In</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { marginBottom: 0 }]}>My Bookmarks</Text>
        <TouchableOpacity style={styles.headerAction} onPress={() => setEditBookmarks((e) => !e)}>
          <Text style={styles.headerActionText}>{editBookmarks ? "Done" : "Edit"}</Text>
        </TouchableOpacity>
      </View>
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
            {editBookmarks && (
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDeleteBookmark(item.id)}
              >
                <Text style={styles.deleteButtonText}>Remove</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text>No bookmarks yet</Text>}
        ListFooterComponent={<View style={{ paddingVertical: 16 }} />}
      />

      {/* Modal for bookmark details */}
      <Modal visible={showModal} animationType="slide" presentationStyle="fullScreen" statusBarTranslucent>
        <SafeAreaView
          style={[
            styles.modalContainer,
            { paddingTop: Math.max(36, (insets.top || 0) + 20) },
          ]}
          edges={["top", "bottom", "left", "right"]}
        >
          {selectedBookmark && (
            <>
              <Text style={styles.modalTitle}>{selectedBookmark.name}</Text>
              {selectedBookmark.address ? (
                <Text style={styles.modalAddress}>{selectedBookmark.address}</Text>
              ) : null}

              {bookmarkImages.length > 0 && (
                <View style={styles.imagesContainer}>
                  <FlatList
                    horizontal
                    data={bookmarkImages}
                    keyExtractor={(uri, idx) => `${uri}-${idx}`}
                    showsHorizontalScrollIndicator={false}
                    renderItem={({ item, index }) => (
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => handleOpenImageViewer(index)}
                      >
                        <Image source={{ uri: item }} style={styles.bookmarkImage} />
                      </TouchableOpacity>
                    )}
                  />
                </View>
              )}

              <Text style={styles.sectionTitle}>Reviews</Text>
              <FlatList
                data={reviews}
                keyExtractor={(item, index) => item.id?.toString() ?? index.toString()}
                renderItem={({ item }) => (
                  <View style={styles.review}>
                    <Text style={styles.reviewText}>
                      ⭐ {item.rating} - {item.text}{item.relativeTime ? ` • ${item.relativeTime}` : ""}
                    </Text>
                  </View>
                )}
                ListEmptyComponent={<Text>No reviews yet</Text>}
              />
              {reviewHasMore && reviews.length >= 20 && (
                <TouchableOpacity
                  style={[
                    styles.closeButton,
                    {
                      backgroundColor: "#555",
                      marginTop: 12,
                      opacity: reviewLoadingMore ? 0.6 : 1,
                    },
                  ]}
                  onPress={handleLoadMoreReviews}
                  disabled={reviewLoadingMore}
                >
                  <Text style={styles.closeButtonText}>
                    {reviewLoadingMore ? "Loading…" : "Load More"}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.closeButton, { backgroundColor: "#555" }]}
                onPress={closeModal}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>

              {imageViewerVisible && bookmarkImages.length > 0 && (
                <View
                  style={[
                    styles.viewerOverlay,
                    { paddingTop: Math.max(28, (insets.top || 0) + 16) },
                  ]}
                >
                  <TouchableOpacity
                    style={styles.imageCloseButton}
                    onPress={() => setImageViewerVisible(false)}
                  >
                    <Text style={styles.imageCloseText}>Close</Text>
                  </TouchableOpacity>
                  <FlatList
                    ref={(r) => {
                      imageViewerRef.current = r;
                    }}
                    data={bookmarkImages}
                    keyExtractor={(uri, idx) => `${uri}-${idx}`}
                    horizontal
                    pagingEnabled
                    getItemLayout={(_, index) => ({
                      length: screenWidth,
                      offset: screenWidth * index,
                      index,
                    })}
                    renderItem={({ item }) => (
                      <View
                        style={{
                          width: screenWidth,
                          flex: 1,
                          justifyContent: "center",
                          alignItems: "center",
                        }}
                      >
                        <Image
                          source={{ uri: item }}
                          style={styles.fullscreenImage}
                          resizeMode="contain"
                        />
                      </View>
                    )}
                    onMomentumScrollEnd={(e) => {
                      const idx = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
                      setImageViewerIndex(idx);
                    }}
                    showsHorizontalScrollIndicator={false}
                  />
                  <View style={styles.imageIndexBadge}>
                    <Text style={styles.imageIndexText}>
                      {`${Math.min(imageViewerIndex + 1, Math.max(bookmarkImages.length, 1))} / ${Math.max(
                        bookmarkImages.length,
                        1
                      )}`}
                    </Text>
                  </View>
                </View>
              )}
            </>
          )}
        </SafeAreaView>
      </Modal>

      {/* Recommend a Place Modal moved to Account screen */}
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 12 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  headerAction: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  headerActionText: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "600",
  },
  imagesContainer: {
    marginVertical: 12,
  },
  bookmarkImage: {
    width: 140,
    height: 100,
    borderRadius: 10,
    marginRight: 10,
    backgroundColor: "#f0f0f0",
  },
  viewerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    zIndex: 20,
    justifyContent: "center",
  },
  fullscreenImage: {
    width: "100%",
    height: "100%",
  },
  imageCloseButton: {
    alignSelf: "flex-end",
    marginRight: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  imageCloseText: {
    color: "#fff",
    fontWeight: "bold",
  },
  imageIndexBadge: {
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 24,
  },
  imageIndexText: {
    color: "#fff",
    fontWeight: "600",
  },
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

  modalContainer: { flex: 1, padding: 20, backgroundColor: "#fff", position: "relative" },
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
