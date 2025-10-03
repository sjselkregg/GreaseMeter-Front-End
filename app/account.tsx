import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

type User = {
  name: string;
  email: string;
  token: string;
};

export default function Account() {
  const [loggedInUser, setLoggedInUser] = useState<User | null>(null);
  const [mode, setMode] = useState<"default" | "signup" | "login">("default");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  //API base
  const API_BASE = "https://api.greasemeter.live/v1";

  // --- SIGN UP ---
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
    if (trimmedName.length < 3) {
      Alert.alert("Sign Up Error", "Username must be at least 3 characters long.");
      return;
    }
    if (trimmedPassword.length < 8) {
      Alert.alert("Sign Up Error", "Password must be at least 8 characters long.");
      return;
    }

    try {
      const payload = { email: trimmedEmail, name: trimmedName, password: trimmedPassword };
      console.log("📤 Sending signup payload:", payload);

      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        console.log("🔴 SignUp error raw response:", text);
        Alert.alert("Sign Up Failed", "Something went wrong. Please try again.");
        return;
      }

      const data = await res.json();
      console.log("✅ SignUp success response:", data);

      await AsyncStorage.setItem("userToken", data.token);

      setLoggedInUser({ name: data.name || trimmedName, email: data.email, token: data.token });
      setEmail("");
      setUsername("");
      setPassword("");
      setMode("default");
      Alert.alert("Sign Up Success", "Your account has been created!");
    } catch (err) {
      console.error("Network error:", err);
      Alert.alert("Error", "Cannot reach server. Check your connection.");
    }
  };

  //LOGIN
  const handleLogin = async () => {
    const trimmedName = username.trim();
    const trimmedPassword = password.trim();

    if (!trimmedName || !trimmedPassword) {
      Alert.alert("Login Error", "Please enter both username and password.");
      return;
    }

    try {
      const payload = { name: trimmedName, password: trimmedPassword };
      console.log("📤 Sending login payload:", payload);

      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        console.log("🔴 Login error raw response:", text);
        Alert.alert("Login Failed", text);
        return;
      }

      const data = await res.json();
      console.log("✅ Login success response:", data);

      await AsyncStorage.setItem("userToken", data.token);

      setLoggedInUser({ name: data.name, email: data.email, token: data.token });
      setUsername("");
      setPassword("");
      setMode("default");
      Alert.alert("Login Success", `Welcome back, ${data.name}!`);
    } catch (err) {
      console.error("Network error:", err);
      Alert.alert("Error", "Cannot reach server. Check your connection.");
    }
  };

  //LOGOUT
  const handleLogout = async () => {
    await AsyncStorage.removeItem("userToken");
    setLoggedInUser(null);
  };

  return (
    <View style={styles.container}>
      <View style={styles.avatar} />

      {loggedInUser ? (
        <>
          <Text style={styles.name}>{loggedInUser.name}</Text>
          <Text style={styles.email}>{loggedInUser.email}</Text>
          <TouchableOpacity style={styles.button} onPress={handleLogout}>
            <Text style={styles.buttonText}>Log Out</Text>
          </TouchableOpacity>
        </>
      ) : mode === "signup" ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#333"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor="#333"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#333"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <TouchableOpacity style={styles.button} onPress={handleSignUp}>
            <Text style={styles.buttonText}>Sign Up</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode("default")}>
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </>
      ) : mode === "login" ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor="#333"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#333"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <TouchableOpacity style={styles.button} onPress={handleLogin}>
            <Text style={styles.buttonText}>Log In</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode("default")}>
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.text}>You are not logged in to GreaseMeter.</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff", padding: 20 },
  avatar: { width: 100, height: 100, borderRadius: 50, backgroundColor: "#ccc", marginBottom: 20 },
  name: { fontSize: 22, fontWeight: "bold", marginBottom: 5, color: "#000" },
  email: { fontSize: 16, color: "#555", marginBottom: 20 },
  text: { fontSize: 18, marginBottom: 20, color: "#000", textAlign: "center" },
  input: { width: "80%", height: 50, borderColor: "#ccc", borderWidth: 1, borderRadius: 8, marginBottom: 15, paddingHorizontal: 10, fontSize: 16 },
  button: { backgroundColor: "#007AFF", paddingVertical: 12, paddingHorizontal: 30, borderRadius: 8, marginBottom: 10 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  linkText: { color: "#007AFF", fontSize: 16, marginTop: 5 },
});
