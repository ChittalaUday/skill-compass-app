import { ApolloProvider } from '@apollo/client/react';
import { PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold, useFonts } from '@expo-google-fonts/plus-jakarta-sans';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import "../global.css";
import CustomSplashScreen from '../src/components/CustomSplashScreen';
import { SocketProvider } from '../src/context/SocketContext';
import { ThemeProvider as AppThemeProvider } from '../src/context/ThemeContext';
import { ToastProvider } from '../src/context/ToastContext';
import { apolloClient } from '../src/services/graphqlClient';
import { store, persistor } from '../src/store';
import { aiService } from '../src/services/aiService';

configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });

SplashScreen.preventAutoHideAsync();

// Suppress deprecation warnings from dependencies (e.g. SafeAreaView from react-native core)
LogBox.ignoreLogs([
  'SafeAreaView has been deprecated',
  'statusBarTranslucent and navigationBarTranslucent',
]);

export default function RootLayout() {
  useEffect(() => {
    aiService.initialize();
  }, []);

  const [loaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  const [isSplashFinished, setIsSplashFinished] = useState(false);

  useEffect(() => {
    if (loaded) {
      // Hide native splash screen once fonts are loaded
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <ApolloProvider client={apolloClient}>
          <SafeAreaProvider>
            <ThemeProvider value={DefaultTheme}>
              <AppThemeProvider>
                <ToastProvider>
                  <SocketProvider>
                    <GestureHandlerRootView style={{ flex: 1 }}>
                      <KeyboardProvider>
                        <Stack screenOptions={{
                          headerShown: false,
                          contentStyle: { backgroundColor: '#fafaf9' },
                          animation: 'fade_from_bottom',
                        }} />
                        {!isSplashFinished && (
                          <CustomSplashScreen onFinish={() => setIsSplashFinished(true)} />
                        )}
                      </KeyboardProvider>
                    </GestureHandlerRootView>
                    <StatusBar style="auto" />
                  </SocketProvider>
                </ToastProvider>
              </AppThemeProvider>
            </ThemeProvider>
          </SafeAreaProvider>
        </ApolloProvider>
      </PersistGate>
    </Provider>
  );
}
