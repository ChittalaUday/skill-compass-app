import axios from 'axios';
import Constants from 'expo-constants';
import { showToast } from '../utils/toast';

// Get API URL - use Constants.expoConfig for runtime availability in APK
const getBaseUrl = () => {
  const extra = Constants.expoConfig?.extra || {};
  return (
    extra.EXPO_PUBLIC_API_URL || 
    process.env.EXPO_PUBLIC_API_URL || 
    'http://51.20.182.252:5003/api'
  );
};

const BASE_URL = getBaseUrl();

console.log('[API Client] Using BASE_URL:', BASE_URL);

const client = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
    },
    timeout: 10000,
});

// Request interceptor
client.interceptors.request.use(
    async (config) => {
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response interceptor
client.interceptors.response.use(
    (response) => response,
    (error) => {
        const message = error.response?.data?.message || error.message || 'Something went wrong';
        
        // Show toast for errors
        showToast(message, {
            status: 'error',
            title: error.response?.status ? `Error ${error.response.status}` : 'Network Error',
        });

        // Specific handling for 401
        if (error.response?.status === 401) {
            console.warn('Unauthorized access');
        }
        
        return Promise.reject(error);
    }
);

export default client;
