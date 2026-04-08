import { configureStore, combineReducers, Middleware } from '@reduxjs/toolkit';
import { persistStore, persistReducer, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER } from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import authReducer from './slices/authSlice';
import clipReducer from './slices/clipSlice';
import commonReducer from './slices/commonSlice';
import learningReducer from './slices/learningSlice';
import onboardingReducer from './slices/onboardingSlice';
import userReducer from './slices/userSlice';
import { clearAllStorage } from '../services/api';

const persistConfig = {
    key: 'root',
    version: 1,
    storage: AsyncStorage,
    whitelist: ['auth', 'learning', 'users', 'onboarding'], // Only these will be persisted
};

const appReducer = combineReducers({
    auth: authReducer,
    onboarding: onboardingReducer,
    common: commonReducer,
    learning: learningReducer,
    clip: clipReducer,
    users: userReducer,
});

const storageMiddleware: Middleware = (store) => (next) => (action: any) => {
    if (action.type === 'auth/logout') {
        // Clear storage side effect
        clearAllStorage();
    }
    return next(action);
};

const rootReducer = (state: any, action: any) => {
    if (action.type === 'auth/logout') {
        // Clear all Redux state
        state = undefined;
    }
    return appReducer(state, action);
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
    reducer: persistedReducer,
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: {
                ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
            },
        }).concat(storageMiddleware),
});

export const persistor = persistStore(store);

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
