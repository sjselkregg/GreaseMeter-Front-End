import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";

type User = {
  username: string;
  email: string;
  password: string;
};

export default function Account() {
  const [loggedInUser, setLoggedInUser] = useState<User | null>(null);
  const [mode, setMode] = useState<"default" | "signup" | "login">("default");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // In-memory "database" for demo purposes
  const [users, setUsers] = useState<User[]>([]);

  const handleSignUp = () => {
    if (!email || !username || !password) {
      Alert.alert("Error", "Please fill all fields");
      return;
    }
    if (users.find(u => u.username === username)) {
      Alert.alert("Error", "Username already exists");
      return;
    }
    const newUser = { email, username, password };
    setUsers([...users, newUser]);
    setLoggedInUser(newUser);
    setEmail("");
    setUsername("");
    setPassword("");
    setMode("default");
  };

  const handleLogin = () => {
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
      setLoggedInUser(user);
      setEmail("");
      setUsername("");
      setPassword("");
      setMode("default");
    } else {
      Alert.alert("Error", "Invalid username or password");
    }
  };

  const handleLogout = () => {
    setLoggedInUser(null);
  };

  return (
    <View style={styles.container}>
      <View style={styles.avatar} />

      {loggedInUser ? (
        <>
          <Text style={styles.name}>{loggedInUser.username}</Text>
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
            placeholderTextColor={"#333"}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor={"#333"}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={"#333"}
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
            placeholderTextColor={"#333"}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={"#333"}
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
    textAlign: "center",
  },
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
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 8,
    marginBottom: 10,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  linkText: {
    color: "#007AFF",
    fontSize: 16,
    marginTop: 5,
  },
});
