import { Stack, usePathname, Link } from "expo-router";
import { View, Text, Pressable, StyleSheet } from "react-native";
import React from "react";

export default function Layout() {
  const pathname = usePathname(); // current route

  return (
    <View style={{ flex: 1 }}>
      {/* Navigation stack with titles + no back button */}
      <Stack screenOptions={{ headerBackVisible: false }}>
        <Stack.Screen name="index" options={{ title: "Map" }} />
        <Stack.Screen name="bookmarks" options={{ title: "Bookmarks" }} />
        <Stack.Screen name="account" options={{ title: "Account" }} />
      </Stack>

      {/* Persistent bottom nav */}
      <View style={styles.navbar}>
        <NavButton label="Bookmarks" href="/bookmarks" active={pathname === "/bookmarks"} />
        <NavButton label="Map" href="/" active={pathname === "/"} />
        <NavButton label="Account" href="/account" active={pathname === "/account"} />
      </View>
    </View>
  );
}

type NavButtonProps = {
  label: string;
  href: string;
  active: boolean;
};

function NavButton({ label, href, active }: NavButtonProps) {
  return (
    <Link href={href} asChild>
      <Pressable
        style={[styles.button, active && styles.activeButton]}
        disabled={active}
      >
        <Text style={[styles.label, active && styles.activeLabel]}>{label}</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  navbar: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 25,
    borderTopWidth: 1,
    borderColor: "#ccc",
    backgroundColor: "#fff",
  },
  button: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
  },
  activeButton: {
    backgroundColor: "#eee",
  },
  label: {
    fontSize: 20,
    color: "#333",
  },
  activeLabel: {
    fontWeight: "bold",
    color: "#000",
  },
});
