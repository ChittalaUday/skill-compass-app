import axios from 'axios';

// Get API URL from environment variables
const BASE_URL =
    process.env.EXPO_PUBLIC_API_URL || 'https://api.example.com/v1';

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
        // In a real app, you would retrieve the token from SecureStore here
        // const token = await SecureStore.getItemAsync('user_token');
        // if (token) {
        //   config.headers.Authorization = `Bearer ${token}`;
        // }
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
        // Handle specific errors like 401 Unauthorized here
        if (error.response?.status === 401) {
            // Dispatch logout action or refresh token
            console.warn('Unauthorized access');
        }
        return Promise.reject(error);
    }
);

export default client;
