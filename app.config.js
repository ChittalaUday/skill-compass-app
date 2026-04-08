import 'dotenv/config';

export default {
  expo: {
    name: "skill compass app",
    slug: "skill-compass-app",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "skillcompassapp",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.udayniruthi.skillcompassapp"
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png"
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      package: "com.udayniruthi.skillcompassapp",
      usesCleartextTraffic: true,
      networkSecurityConfig: {
        domainConfig: [
          {
            domain: "51.20.182.252",
            cleartextTrafficPermitted: true
          }
        ]
      }
    },
    web: {
      output: "static",
      favicon: "./assets/images/favicon.png",
      bundler: "metro"
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
          dark: {
            backgroundColor: "#000000"
          }
        }
      ],
      "expo-secure-store",
      "expo-sqlite",
      "expo-localization"
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true
    },
    extra: {
      router: {},
      eas: {
        projectId: "927ba19c-b06f-4b36-ac96-885de0b43f6c"
      },
      EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
      EXPO_PUBLIC_SOCKET_URL: process.env.EXPO_PUBLIC_SOCKET_URL,
      EXPO_PUBLIC_GRAPHQL_WS_URL: process.env.EXPO_PUBLIC_GRAPHQL_WS_URL
    }
  }
};