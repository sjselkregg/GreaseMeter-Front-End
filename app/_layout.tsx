import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function Layout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: "orange", shadowColor: "#ccc", elevation: 4 },
        headerTitle: "GREASEMETER",
        headerTitleStyle: {fontWeight: "bold", fontSize: 20, color: "white"},
        headerTitleAlign: "center",

        tabBarActiveTintColor: "#900202ff",
        tabBarInactiveTintColor: "#9b7504ff",
        tabBarStyle: { borderTopWidth: 1, borderColor: "#ccc", backgroundColor: "orange", paddingVertical: 5, height: 70 },
        tabBarLabelStyle: { fontSize: 14 },
      }}
    >
      <Tabs.Screen
        name="bookmarks"       // must match bookmarks.tsx
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bookmark-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="index"           // must match index.tsx (Map)
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="map-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"        // must match account.tsx
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
