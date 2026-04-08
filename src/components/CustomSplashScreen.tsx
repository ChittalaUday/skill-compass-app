import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as Network from 'expo-network';
import { jwtDecode, JwtPayload } from "jwt-decode";
import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming
} from 'react-native-reanimated';
import { useDispatch, useSelector } from 'react-redux';
import { useOnboardingRedirect } from '../hooks/useOnboardingRedirect';
import { setAuthToken } from '../services/api';
import { AppDispatch, RootState } from '../store';
import { checkOnboardingStatus, setToken } from '../store/slices/authSlice';

interface MyTokenPayload extends JwtPayload {
    id: number;
    email: string;
    role: "USER" | "ADMIN";
    age: number | null;
    group: "KIDS" | "TEENS" | "COLLEGE_STUDENTS" | "PROFESSIONALS" | "SENIORS" | null;
    isOnboarded: boolean;
}

interface CustomSplashScreenProps {
    onFinish: () => void;
}

const SPLASH_DURATION = 2000; // Total duration in ms

export default function CustomSplashScreen({ onFinish }: CustomSplashScreenProps) {
    const opacity = useSharedValue(1);
    const scale = useSharedValue(0.9);
    const dispatch = useDispatch<AppDispatch>();
    const router = useRouter();
    const { performRedirect } = useOnboardingRedirect();
    const { learningPath } = useSelector((state: RootState) => state.learning);

    useEffect(() => {
        // Start entrance animation
        scale.value = withTiming(1, { duration: 1000 });

        const handleFinish = (path: string) => {
            onFinish();
            router.replace(path as any);
        };

        const checkTokenAndRedirect = async () => {
            try {
                const networkState = await Network.getNetworkStateAsync();
                const isOnline = networkState.isConnected && networkState.isInternetReachable !== false;
                
                const token = await SecureStore.getItemAsync('authToken');
                console.log('🔑 [SPLASH] Token found:', token ? 'YES' : 'NO', 'Online:', isOnline);

                if (!token) {
                    console.log('❌ [SPLASH] No token found, redirecting to login');
                    setTimeout(() => {
                        opacity.value = withTiming(0, { duration: 500 }, (finished) => {
                            if (finished) runOnJS(handleFinish)('/(auth)/login');
                        });
                    }, SPLASH_DURATION);
                    return;
                }

                // If offline but we have a token, we skip the API check and assume previous state is valid (rehydrated by Redux Persist)
                if (!isOnline) {
                    console.log('📶 [SPLASH] Offline mode: Checking for cached data...');
                    const handleOfflineRedirect = () => {
                        onFinish();
                        // Only redirect to tabs if we actually have data, otherwise login/onboarding
                        if (learningPath) {
                            console.log('✅ [SPLASH] Cached data found, redirecting to dashboard');
                            router.replace('/(tabs)');
                        } else {
                            console.log('❌ [SPLASH] No cached data found, redirecting to login');
                            router.replace('/(auth)/login');
                        }
                    };

                    setTimeout(() => {
                        opacity.value = withTiming(0, { duration: 500 }, (finished) => {
                            if (finished) runOnJS(handleOfflineRedirect)();
                        });
                    }, SPLASH_DURATION);
                    return;
                }

                // Decode to check expiry first
                try {
                    const decoded = jwtDecode<MyTokenPayload>(token);
                    const currentTime = Date.now() / 1000;

                    if (decoded.exp && decoded.exp < currentTime) {
                        console.log('⏰ [SPLASH] Token expired, deleting and redirecting to login');
                        await SecureStore.deleteItemAsync('authToken');
                        setTimeout(() => {
                            opacity.value = withTiming(0, { duration: 500 }, (finished) => {
                                if (finished) runOnJS(handleFinish)('/(auth)/login');
                            });
                        }, SPLASH_DURATION);
                        return;
                    }
                } catch (e) {
                    // ignore decode error here, api call will fail if invalid
                    console.log('❌ [SPLASH] Token decode failed, redirecting to login', e);
                    await SecureStore.deleteItemAsync('authToken');
                    setTimeout(() => {
                        opacity.value = withTiming(0, { duration: 500 }, (finished) => {
                            if (finished) runOnJS(handleFinish)('/(auth)/login');
                        });
                    }, SPLASH_DURATION);
                    return;
                }

                // Token seems valid, set it and fetch profile
                await setAuthToken(token);
                dispatch(setToken(token)); // This trigger the global SocketProvider

                // Fetch fresh user status
                const actionResult = await dispatch(checkOnboardingStatus());

                if (checkOnboardingStatus.fulfilled.match(actionResult)) {
                    const status = actionResult.payload;
                    console.log('✅ [SPLASH] User status fetched:', status.user.id, status.group);

                    const handleSuccessRedirect = () => {
                        onFinish();
                        // Small delay to let splash finish unmounting
                        setTimeout(() => {
                            performRedirect(status);
                        }, 100);
                    };

                    setTimeout(() => {
                        opacity.value = withTiming(0, { duration: 500 }, (finished) => {
                            if (finished) {
                                runOnJS(handleSuccessRedirect)();
                            }
                        });
                    }, SPLASH_DURATION);

                } else {
                    const errorMessage = (actionResult.payload as string) || (actionResult.error?.message as string) || '';
                    console.error('❌ [SPLASH] Failed to fetch status:', errorMessage);

                    // PRIORITY 1: Application logic errors (Age selection, etc)
                    if (errorMessage.includes('Age is required')) {
                        console.log('👉 [SPLASH] Age missing, redirecting to age selection');

                        const handleAgeRedirect = () => {
                            onFinish();
                            router.replace({
                                pathname: '/(onboarding)/age' as any,
                                params: { toastMessage: 'Please set your age to continue' }
                            });
                        };

                        setTimeout(() => {
                            opacity.value = withTiming(0, { duration: 500 }, (finished) => {
                                if (finished) {
                                    runOnJS(handleAgeRedirect)();
                                }
                            });
                        }, SPLASH_DURATION);
                        return;
                    }

                    // PRIORITY 2: Network error bypass (ONLY if we have learning path data)
                    if (errorMessage.toLowerCase().includes('network') || errorMessage.toLowerCase().includes('fail')) {
                         console.log('📶 [SPLASH] API failed with network error, checking for cached data...');
                         if (learningPath) {
                             console.log('✅ [SPLASH] Cached data found, offline bypass enabled');
                             onFinish();
                             router.replace('/(tabs)');
                             return;
                         } else {
                             console.log('❌ [SPLASH] No cached data, cannot bypass network error');
                         }
                    }

                    // Priority 3: Fallback (Auth error, etc)
                    await SecureStore.deleteItemAsync('authToken');
                    setTimeout(() => {
                        opacity.value = withTiming(0, { duration: 500 }, (finished) => {
                            if (finished) runOnJS(handleFinish)('/(auth)/login');
                        });
                    }, SPLASH_DURATION);
                }

            } catch (error: any) {
                console.error('Splash screen error:', error);
                
                // If it's likely a network error, check for cache
                if (error?.message?.toLowerCase().includes('network')) {
                    if (learningPath) {
                        onFinish();
                        router.replace('/(tabs)');
                        return;
                    }
                }

                setTimeout(() => {
                    opacity.value = withTiming(0, { duration: 500 }, (finished) => {
                        if (finished) runOnJS(handleFinish)('/(auth)/login');
                    });
                }, SPLASH_DURATION);
            }
        };

        checkTokenAndRedirect();

    }, [opacity, scale, onFinish, learningPath]);

    const animatedStyle = useAnimatedStyle(() => {
        return {
            opacity: opacity.value,
            transform: [{ scale: scale.value }],
        };
    });

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={['#ffffff', '#f0f0f0']} // Subtle gradient for background
                style={StyleSheet.absoluteFill}
            />

            {/* Ambient Glow */}
            <View style={styles.glowContainer}>
                <LinearGradient
                    colors={['rgba(79, 70, 229, 0.15)', 'transparent']}
                    style={styles.glow}
                    start={{ x: 0.5, y: 0.5 }}
                    end={{ x: 1, y: 1 }}
                />
            </View>

            <Animated.View style={[styles.content, animatedStyle]}>
                {/* Placeholder for Logo - You can replace this with an Image */}
                <View style={styles.logoContainer}>
                    <View style={styles.logoCircle}>
                        <Text style={styles.logoText}>SC</Text>
                    </View>
                </View>

                <View style={styles.textContainer}>
                    <Text style={styles.title}>Skill Compass</Text>
                    <Text style={styles.subtitle}>Navigate your future</Text>
                </View>
            </Animated.View>
        </View>
    );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 99999,
        backgroundColor: '#ffffff', // Fallback
    },
    glowContainer: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
    },
    glow: {
        width: width * 1.5,
        height: width * 1.5,
        borderRadius: width * 0.75,
    },
    content: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    logoContainer: {
        marginBottom: 24,
        shadowColor: '#4F46E5',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 20,
        elevation: 10,
    },
    logoCircle: {
        width: 100,
        height: 100,
        borderRadius: 30,
        backgroundColor: '#ffffff',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.5)',
    },
    logoText: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#4F46E5',
        fontFamily: 'PlusJakartaSans_700Bold',
    },
    textContainer: {
        alignItems: 'center',
    },
    title: {
        fontSize: 28,
        fontFamily: 'PlusJakartaSans_700Bold',
        color: '#1e293b',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        fontFamily: 'PlusJakartaSans_500Medium',
        color: '#64748b',
    },
});
