import { Image, ImageSourcePropType } from "react-native";
import { Tabs } from "expo-router";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";

const TITLE_IMAGE = require("../assets/images/GREASETEXT.png");
const MAP_ICON = require("../assets/images/mapIcon.png.png");
const BOOKMARK_ICON = require("../assets/images/bookmarkIcon.png.png");
const ACCOUNT_ICON = require("../assets/images/accountIcon.png.png");

const renderTabIcon =
  (source: ImageSourcePropType) =>
  ({ color }: { color: string }) =>
    (
      <Image
        source={source}
        resizeMode="contain"
        style={{ width: 28, height: 28, tintColor: color }}
      />
    );

export default function Layout() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: "orange", shadowColor: "#ccc", elevation:4 },
        headerTitle: () => (
          <Image
            source={TITLE_IMAGE}
            resizeMode="contain"
            style={{ width: 340, height: 110 }}
          />
        ),
        headerTitleAlign: "center",

        tabBarActiveTintColor: "#900202ff",
        tabBarInactiveTintColor: "#9b7504ff",
        tabBarStyle: { borderTopWidth: 1, borderColor: "#ccc", backgroundColor: "orange", paddingVertical: 5, height: 70 },
        tabBarLabelStyle: { fontSize: 14 },
      }}
    >
      <Tabs.Screen
        name="bookmarks"       
        options={{
          tabBarLabel: "Bookmarks",
          tabBarIcon: renderTabIcon(BOOKMARK_ICON),
        }}
      />
      <Tabs.Screen
        name="index"           
        options={{
          tabBarLabel: "Map",
          tabBarIcon: renderTabIcon(MAP_ICON),
        }}
      />
      <Tabs.Screen
        name="account"       
        options={{
          tabBarLabel: "Account",
          tabBarIcon: renderTabIcon(ACCOUNT_ICON),
        }}
      />
      </Tabs>
    </SafeAreaProvider>
  );
}
