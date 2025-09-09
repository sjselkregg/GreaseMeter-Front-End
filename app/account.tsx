import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";

export default function Account() {
  const [loggedIn, setLoggedIn] = useState(false);

  const handlePress = () => {
    setLoggedIn(!loggedIn);
  };

  return (
    <View style={styles.container}>
      {/* Avatar placeholder */}
      <View style={styles.avatar} />

      {/* Account info */}
      {loggedIn ? (
        <>
          <Text style={styles.name}>John Doe</Text>
          <Text style={styles.email}>john@example.com</Text>
        </>
      ) : (
        <Text style={styles.text}>You are not logged in</Text>
      )}

      {/* Login/Logout button */}
      <TouchableOpacity style={styles.button} onPress={handlePress}>
        <Text style={styles.buttonText}>
          {loggedIn ? "Log Out" : "Log In"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    justifyContent: "center", 
    alignItems: "center", 
    backgroundColor: "#fff", 
    padding: 20 
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#ccc",
    marginBottom: 20,
  },
  name: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 5,
    color: "#000",
  },
  email: {
    fontSize: 16,
    color: "#555",
    marginBottom: 20,
  },
  text: {
    fontSize: 18,
    marginBottom: 20,
    color: "#000",
  },
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});
