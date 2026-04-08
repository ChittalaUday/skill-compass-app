import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearApolloCache } from './graphqlClient';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://51.20.182.252:5003/api';

const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

const CACHE_PREFIX = 'api_cache_';

// Request interceptor to add token and handle offline caching
api.interceptors.request.use(
    async (config) => {
        const token = await SecureStore.getItemAsync('authToken');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        
        // GLOBAL REQUEST LOGGING
        console.log(`🚀 [API Request] ${config.method?.toUpperCase()} ${config.url}`, config.data || '');
        
        return config;
    },
    (error) => {
        console.error(`❌ [API Request Error]`, error);
        return Promise.reject(error);
    }
);

// Response interceptor to handle caching
api.interceptors.response.use(
    async (response) => {
        // GLOBAL RESPONSE LOGGING
        console.log(`✅ [API Response] ${response.status} ${response.config.url}`, response.data);

        // Cache successful GET requests
        if (response.config.method === 'get' && response.data) {
            try {
                const cacheKey = CACHE_PREFIX + response.config.url;
                await AsyncStorage.setItem(cacheKey, JSON.stringify(response.data));
            } catch (e) {
                console.warn('[API Cache] Failed to save:', e);
            }
        }
        return response;
    },
    async (error) => {
        const config = error.config;
        
        // GLOBAL ERROR LOGGING
        console.error(`❌ [API Error] ${error.response?.status || 'Network'} ${config?.url}`, error.response?.data || error.message);
        
        // If it's a network error and it's a GET request, try searching the cache
        if ((!error.response || error.code === 'ERR_NETWORK') && config && config.method === 'get') {
            try {
                const cacheKey = CACHE_PREFIX + config.url;
                const cachedData = await AsyncStorage.getItem(cacheKey);
                if (cachedData) {
                    console.log('📶 [API Cache] Serving cached data for:', config.url);
                    return {
                        ...error,
                        data: JSON.parse(cachedData),
                        status: 200,
                        statusText: 'OK',
                        headers: {},
                        config: config,
                        isCached: true,
                    };
                }
            } catch (e) {
                console.warn('[API Cache] Failed to retrieve:', e);
            }
        }
        return Promise.reject(error);
    }
);

export const setAuthToken = async (token: string) => {
    await SecureStore.setItemAsync('authToken', token);
};

export const getAuthToken = async () => {
    return await SecureStore.getItemAsync('authToken');
};

export const removeAuthToken = async () => {
    await SecureStore.deleteItemAsync('authToken');
};

export const clearAllStorage = async () => {
    try {
        await SecureStore.deleteItemAsync('authToken');
        await SecureStore.deleteItemAsync('kid_total_points');
        await clearApolloCache();
        
        // Clear all API caches
        const keys = await AsyncStorage.getAllKeys();
        const apiKeys = keys.filter(key => key.startsWith(CACHE_PREFIX));
        if (apiKeys.length > 0) {
            await AsyncStorage.multiRemove(apiKeys);
        }
        
        console.log('All local storage and cache cleared');
    } catch (error) {
        console.error('Error clearing storage:', error);
    }
};

export default api;
