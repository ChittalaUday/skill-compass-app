import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import api, { removeAuthToken, setAuthToken } from '../../services/api';
import { LoginResponse, OnboardingStatus, User, UserPreferences } from '../../types/auth'; // Import UserPreferences
import { updateAge, updateSkillsAndInterests } from './onboardingSlice';

interface AuthState {
    user: User | null;
    token: string | null;
    fullAuthData: any | null; // Added to store full response as requested
    isAuthenticated: boolean;
    loading: boolean;
    error: string | null;
}

// Initial state
const initialState: AuthState = {
    user: null,
    token: null,
    fullAuthData: null,
    isAuthenticated: false,
    loading: false,
    error: null,
};

// Async Thunks

// Helper to extract error message
const extractErrorMessage = (err: any): string => {
    console.log('FULL ERROR OBJECT:', err);
    console.log('Server Response:', err.response?.data);
    if (err.response) {
        const data = err.response.data;
        if (data && typeof data === 'object') {
            if (data.message) return data.message;
            if (data.error) return data.error;
        }
        if (typeof data === 'string') return data;
    }
    return err.message || 'An unexpected error occurred';
};

export const loginUser = createAsyncThunk(
    'auth/login',
    async (credentials: { email: string; password: string }, { rejectWithValue }) => {
        try {
            const response = await api.post<LoginResponse>('/auth/login', credentials);
            console.log('LOGIN RESPONSE:', JSON.stringify(response.data, null, 2));
            const { token } = response.data.body;

            if (token) {
                await setAuthToken(token);
            }

            return response.data.body;
        } catch (err: any) {
            return rejectWithValue(extractErrorMessage(err));
        }
    }
);

export const registerUser = createAsyncThunk(
    'auth/register',
    async (userData: { name: string; email: string; password: string; age?: number }, { rejectWithValue }) => {
        try {
            const response = await api.post<LoginResponse>('/auth/register', userData);
            console.log('REGISTER RESPONSE:', JSON.stringify(response.data, null, 2));
            const { token } = response.data.body;

            if (token) {
                await setAuthToken(token);
            }

            return response.data.body;
        } catch (err: any) {
            return rejectWithValue(extractErrorMessage(err));
        }
    }
);



export const updateProfile = createAsyncThunk(
    'auth/updateProfile',
    async (data: Partial<User>, { rejectWithValue }) => {
        try {
            const response = await api.put<{ status: boolean; message: string; body: User }>('/users/profile', data);
            return response.data.body;
        } catch (err: any) {
            return rejectWithValue(extractErrorMessage(err));
        }
    }
);

export const checkOnboardingStatus = createAsyncThunk(
    'auth/checkStatus',
    async (_, { rejectWithValue }) => {
        try {
            const response = await api.get<{ status: boolean; message: string; body: OnboardingStatus }>('/onboarding/status');
            return response.data.body;
        } catch (err: any) {
            return rejectWithValue(extractErrorMessage(err));
        }
    }
);

const authSlice = createSlice({
    name: 'auth',
    initialState,
    reducers: {
        logout: (state) => {
            state.user = null;
            state.token = null;
            state.isAuthenticated = false;
            state.error = null;
        },
        setToken: (state, action: PayloadAction<string>) => {
            state.token = action.payload;
            state.isAuthenticated = true;
        },
        clearError: (state) => {
            state.error = null;
        },
        updateUserProfile: (state, action: PayloadAction<Partial<User>>) => {
            if (state.user) {
                state.user = { ...state.user, ...action.payload };
            }
        }
    },
    extraReducers: (builder) => {
        // Login
        builder.addCase(loginUser.pending, (state) => {
            state.loading = true;
            state.error = null;
        });
        builder.addCase(loginUser.fulfilled, (state, action: PayloadAction<any>) => {
            state.loading = false;
            state.isAuthenticated = true;
            state.user = action.payload.user;
            state.token = action.payload.token;
            state.fullAuthData = action.payload;
        });
        builder.addCase(loginUser.rejected, (state, action) => {
            state.loading = false;
            state.error = action.payload as string;
        });

        // Register
        builder.addCase(registerUser.pending, (state) => {
            state.loading = true;
            state.error = null;
        });
        builder.addCase(registerUser.fulfilled, (state, action: PayloadAction<any>) => {
            state.loading = false;
            state.isAuthenticated = true;
            state.user = action.payload.user;
            state.token = action.payload.token;
            state.fullAuthData = action.payload;
        });
        builder.addCase(registerUser.rejected, (state, action) => {
            state.loading = false;
            state.error = action.payload as string;
        });



        // Update Profile
        builder.addCase(updateProfile.fulfilled, (state, action) => {
            if (state.user) {
                state.user = { ...state.user, ...action.payload };
            }
        });

        // Check OnboardingStatus - merges user and preferences
        builder.addCase(checkOnboardingStatus.fulfilled, (state, action: PayloadAction<OnboardingStatus>) => {
            state.user = {
                ...action.payload.user,
                preferences: action.payload.preferences,
                isOnboarded: action.payload.isOnboarded, // Ensure the latest onboarding flag is used
                age: action.payload.age,
                group: action.payload.group
            };
            state.isAuthenticated = true;
        });

        // Update preferences when skills/interests are updated
        builder.addCase(updateSkillsAndInterests.fulfilled, (state, action: PayloadAction<UserPreferences>) => {
            if (state.user) {
                state.user.preferences = action.payload;
            }
        });

        // Update user age and group when age is set (used by interests, skills, course, etc.)
        builder.addCase(updateAge.fulfilled, (state, action: PayloadAction<{ age?: number; group?: string; user?: User }>) => {
            if (!state.user || !action.payload) return;
            const payload = action.payload;
            // Handle both { age, group } and { user: {...} } response shapes
            if (payload.user) {
                state.user = { ...state.user, ...payload.user };
            } else if (payload.age != null || payload.group != null) {
                state.user = {
                    ...state.user,
                    ...(payload.age != null && { age: payload.age }),
                    ...(payload.group != null && { group: payload.group }),
                };
            }
        });
    },
});

export const { logout, clearError, updateUserProfile, setToken } = authSlice.actions;
export default authSlice.reducer;
