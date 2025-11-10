import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

type User = {
  name: string;
  email: string;
  token: string;
};

type Review = {
  id: number | string;
  text: string;
  rating: number;
  place_name?: string;
};

export default function Account() {
  const [loggedInUser, setLoggedInUser] = useState<User | null>(null);
  const [mode, setMode] = useState<"default" | "signup" | "login">("default");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [showReviews, setShowReviews] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [userReviewsPage, setUserReviewsPage] = useState(1);
  const [userReviewsMore, setUserReviewsMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const API_BASE = "https://api.greasemeter.live/v1";

  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem("userToken");
        if (token) {
          const storedEmail = (await AsyncStorage.getItem("userEmail")) || "";
          setLoggedInUser({ name: "User", email: storedEmail, token });
        }
      } catch (err) {
        console.error("Error loading saved user:", err);
      }
    })();
  }, []);

  //Sign up
  const handleSignUp = async () => {
    const trimmedEmail = email.trim();
    const trimmedName = username.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedName || !trimmedPassword) {
      Alert.alert("Sign Up Error", "Please fill in all fields.");
      return;
    }
    if (!trimmedEmail.includes("@") || !trimmedEmail.includes(".")) {
      Alert.alert("Sign Up Error", "Please enter a valid email address.");
      return;
    }
    if (trimmedPassword.length < 8) {
      Alert.alert("Sign Up Error", "Password must be at least 8 characters.");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/users/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          name: trimmedName,
          password: trimmedPassword,
        }),
      });

      const text = await res.text();
      if (!res.ok) {
        console.log("SignUp error:", text);
        let message = "Sign-up failed.";
        try {
          const err = JSON.parse(text);
          message = err.error || err.message || message;
        } catch {}
        Alert.alert("Error", message);
        return;
      }

      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        console.log("Signup response not JSON:", text);
      }

      if (!data.token) {
        Alert.alert(
          "Account Created",
          "Your account was created successfully! Please log in to continue."
      );
        setMode("login");
        return;
      }

      await AsyncStorage.setItem("userToken", data.token);
      await AsyncStorage.setItem("userEmail", data.email || trimmedEmail);
      setLoggedInUser({ name: data.name || trimmedName, email: data.email || trimmedEmail, token: data.token });
      setMode("default");
      Alert.alert("Success", "Account created successfully!");
    } catch (err) {
      console.error("Signup error:", err);
      Alert.alert("Error", "Could not connect to server.");
    }
  };

  //login
  const handleLogin = async () => {
    const trimmedName = username.trim();
    const trimmedPassword = password.trim();
    if (!trimmedName || !trimmedPassword) {
      Alert.alert("Login Error", "Enter both username and password.");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/users/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, password: trimmedPassword }),
      });

      const text = await res.text();
      if (!res.ok) {
        console.log("Login error:", text);
        let message = "Login failed.";
        try {
          const err = JSON.parse(text);
          message = err.error || err.message || message;
        } catch {}
        Alert.alert("Error", message);
        return;
      }

      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        console.log("Login response not JSON:", text);
      }

      if (!data.token) {
        Alert.alert("Error", "No token received from server.");
        return;
      }

      await AsyncStorage.setItem("userToken", data.token);
      const emailFromResponse = data?.email || data?.user?.email || data?.data?.email || "";
      if (emailFromResponse) await AsyncStorage.setItem("userEmail", emailFromResponse);
      setLoggedInUser({ name: data.name || trimmedName, email: emailFromResponse, token: data.token });
      setMode("default");
      Alert.alert("Success", `Welcome back, ${data.name || trimmedName}!`);
    } catch (err) {
      console.error("Login error:", err);
      Alert.alert("Error", "Could not connect to server.");
    }
  };

  //logout
  const handleLogout = async () => {
    try {
      await AsyncStorage.removeItem("userToken");
      await AsyncStorage.removeItem("userEmail");
      setLoggedInUser(null);
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  //get my reviews
  const fetchUserReviews = useCallback(async (page = 1) => {
    try {
      const token = await AsyncStorage.getItem("userToken");
      if (!token) {
        Alert.alert("Error", "You must be logged in to view reviews.");
        return;
      }

      const res = await fetch(`${API_BASE}/reviews?page=${page}&limit=20`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      const text = await res.text();
      if (!res.ok) {
        console.log("Review fetch error:", text);
        let message = "Failed to load reviews.";
        try {
          const err = JSON.parse(text);
          message = err.error || err.message || message;
        } catch {}
        Alert.alert("Error", message);
        return;
      }

      const data = text ? JSON.parse(text) : {};
      const rawItems = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.results)
        ? data.results
        : [];

      const mapped: Review[] = (rawItems as any[]).map((r: any, i) => ({
        id: r?.id ?? i,
        text: r?.text ?? "",
        rating: typeof r?.rating === "number" ? r.rating : parseFloat(r?.rating ?? 0) || 0,
        place_name: r?.place_name ?? r?.place?.name ?? undefined,
      }));

      if (page > 1) setReviews((prev) => [...prev, ...mapped]);
      else setReviews(mapped);

      setUserReviewsMore(Boolean((data && data.more === true) || (data?.data && data.data.more === true)));
      setUserReviewsPage(page);
    } catch (err) {
      console.error("Error fetching reviews:", err);
      Alert.alert("Error", "Network issue while fetching reviews.");
    }
  }, []);


  //delete a review
const handleDeleteReview = async (reviewId: number | string) => {
  Alert.alert("Confirm Deletion", "Are you sure you want to delete this review?", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Delete",
      style: "destructive",
      onPress: async () => {
        try {
          const token = await AsyncStorage.getItem("userToken");
          if (!token) {
            Alert.alert("Error", "You must be logged in to delete reviews.");
            return;
          }

          const res = await fetch(`${API_BASE}/reviews/${reviewId}`, {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          });

          const text = await res.text();
          if (!res.ok) {
            console.log("Delete review error:", text);
            let message = "Failed to delete review.";
            try {
              const err = JSON.parse(text);
              message = err.error || err.message || message;
            } catch {}
            Alert.alert("Error", message);
            return;
          }

          // remove deleted review from state
          setReviews((prev) => prev.filter((r) => r.id !== reviewId));
          Alert.alert("Success", "Your review has been deleted.");
        } catch (err) {
          console.error("Error deleting review:", err);
          Alert.alert("Error", "Network issue while deleting review.");
        }
      },
    },
  ]);
};


  //refresh reviews
  const onRefresh = async () => {
    setRefreshing(true);
    setUserReviewsPage(1);
    setUserReviewsMore(false);
    await fetchUserReviews(1);
    setRefreshing(false);
  };

  //delete account
  const handleDeleteAccount = async () => {
    Alert.alert("Confirm Deletion", "Are you sure you want to delete your account?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const token = await AsyncStorage.getItem("userToken");
            if (!token) return;
            const res = await fetch(`${API_BASE}/users`, {
              method: "DELETE",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
            });

            const text = await res.text();
            if (!res.ok) {
              console.log("Delete account error:", text);
              let message = "Failed to delete account.";
              try {
                const err = JSON.parse(text);
                message = err.error || err.message || message;
              } catch {}
              Alert.alert("Error", message);
              return;
            }

            await AsyncStorage.removeItem("userToken");
            setLoggedInUser(null);
            Alert.alert("Account Deleted", "Your account has been removed.");
          } catch (err) {
            console.error("Delete account error:", err);
            Alert.alert("Error", "Network issue while deleting account.");
          }
        },
      },
    ]);
  };

  //the app interface
  return (
    <View style={styles.container}>
      {loggedInUser ? (
        <>
          <Text style={styles.title}>Account Info</Text>
          <Text style={styles.infoItem}>👤 {loggedInUser.name}</Text>
          <Text style={styles.infoItem}>📧 {loggedInUser.email}</Text>

          <TouchableOpacity
            style={styles.button}
            onPress={async () => {
              setUserReviewsPage(1);
              setUserReviewsMore(false);
              await fetchUserReviews(1);
              setShowReviews(true);
            }}
          >
            <Text style={styles.buttonText}>View My Reviews</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.button, { backgroundColor: "#555" }]} onPress={handleLogout}>
            <Text style={styles.buttonText}>Log Out</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.button, { backgroundColor: "red" }]} onPress={handleDeleteAccount}>
            <Text style={styles.buttonText}>Delete Account</Text>
          </TouchableOpacity>

          <Modal visible={showReviews} animationType="slide">
            <View style={styles.modalContainer}>
              <Text style={styles.title}>My Reviews</Text>
              <FlatList
                data={reviews}
                keyExtractor={(item, i) => item.id?.toString() ?? i.toString()}
                renderItem={({ item }) => (
                  <View style={styles.reviewItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewText}>
                      ⭐ {item.rating} — {item.text}
                    </Text>
                      {item.place_name && (
                        <Text style={styles.reviewSub}>📍 {item.place_name}</Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => handleDeleteReview(item.id)}
                    >
                      <Text style={styles.deleteButtonText}>Delete</Text>
                    </TouchableOpacity>
                  </View>

                )}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                ListEmptyComponent={<Text>No reviews found.</Text>}
                ListFooterComponent={
                  userReviewsMore ? (
                    <TouchableOpacity
                      style={[styles.button, { alignSelf: "center", marginTop: 10 }]}
                      disabled={loadingMore}
                      onPress={async () => {
                        if (loadingMore) return;
                        setLoadingMore(true);
                        try {
                          await fetchUserReviews(userReviewsPage + 1);
                        } finally {
                          setLoadingMore(false);
                        }
                      }}
                    >
                      <Text style={styles.buttonText}>{loadingMore ? "Loading..." : "Load More"}</Text>
                    </TouchableOpacity>
                  ) : null
                }
              />
              <TouchableOpacity style={[styles.button, { backgroundColor: "#555" }]} onPress={() => setShowReviews(false)}>
                <Text style={styles.buttonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </Modal>
        </>
      ) : mode === "signup" ? (
        <>
          <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#666" value={email} onChangeText={setEmail} autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="Username" placeholderTextColor="#666" value={username} onChangeText={setUsername} />
          <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#666" value={password} onChangeText={setPassword} secureTextEntry />
          <TouchableOpacity style={styles.button} onPress={handleSignUp}>
            <Text style={styles.buttonText}>Sign Up</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode("default")}>
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </>
      ) : mode === "login" ? (
        <>
          <TextInput style={styles.input} placeholder="Username" placeholderTextColor="#666" value={username} onChangeText={setUsername} />
          <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#666" value={password} onChangeText={setPassword} secureTextEntry />
          <TouchableOpacity style={styles.button} onPress={handleLogin}>
            <Text style={styles.buttonText}>Log In</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode("default")}>
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.text}>Please log in or create an account.</Text>
          <TouchableOpacity style={styles.button} onPress={() => setMode("signup")}>
            <Text style={styles.buttonText}>Sign Up</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={() => setMode("login")}>
            <Text style={styles.buttonText}>Log In</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

//styles
const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", padding: 20 },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 10 },
  infoItem: { fontSize: 16, color: "#000", marginBottom: 5 },
  text: { fontSize: 18, marginBottom: 20, textAlign: "center", color: "#000" },
  input: {
    width: "80%",
    height: 50,
    borderColor: "#ccc",
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 15,
    paddingHorizontal: 10,
    fontSize: 16,
  },
  button: { backgroundColor: "#007AFF", paddingVertical: 12, paddingHorizontal: 30, borderRadius: 8, marginVertical: 6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  linkText: { color: "#007AFF", fontSize: 16, marginTop: 5 },
  modalContainer: { flex: 1, backgroundColor: "#fff", padding: 20 },
  reviewItem: { borderBottomWidth: 1, borderBottomColor: "#eee", paddingVertical: 10 },
  reviewText: { fontSize: 16, color: "#000" },
  reviewSub: { fontSize: 14, color: "#555" },
  deleteButton: {
  backgroundColor: "red",
  paddingVertical: 6,
  paddingHorizontal: 10,
  borderRadius: 6,
  alignSelf: "center",
},
deleteButtonText: {
  color: "#fff",
  fontWeight: "bold",
  fontSize: 14,
},

});
