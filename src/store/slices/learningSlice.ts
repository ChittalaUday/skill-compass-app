import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api from '../../services/api';

interface LearningState {
    pathStatus: string | null;
    learningPath: any | null; // Detailed path
    currentModules: any[];
    activeModule: any | null;
    progress: any[];
    schedule: any[];
    loading: boolean;
    error: string | null;
}

const initialState: LearningState = {
    pathStatus: null,
    learningPath: null,
    currentModules: [],
    activeModule: null,
    progress: [],
    schedule: [],
    loading: false,
    error: null,
};

const extractErrorMessage = (err: any): string => {
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

export const fetchLearningPathStatus = createAsyncThunk('learning/fetchStatus', async (_, { rejectWithValue }) => {
    try {
        const response = await api.get('/learning-path/status');
        return response.data.body;
    } catch (err: any) { return rejectWithValue(extractErrorMessage(err)); }
});

export const fetchMyLearningPath = createAsyncThunk('learning/fetchPath', async (_, { rejectWithValue }) => {
    try {
        const response = await api.get('/learning-path/my-path');
        return response.data.body;
    } catch (err: any) { return rejectWithValue(extractErrorMessage(err)); }
});

export const regeneratePath = createAsyncThunk('learning/regenerate', async (_, { rejectWithValue }) => {
    try {
        const response = await api.post('/learning-path/regenerate', {});
        return response.data.body;
    } catch (err: any) { return rejectWithValue(extractErrorMessage(err)); }
});

export const fetchMyProgress = createAsyncThunk('learning/fetchProgress', async (_, { rejectWithValue }) => {
    try {
        const response = await api.get('/learning-progress/my-progress');
        return response.data.body;
    } catch (err: any) { return rejectWithValue(extractErrorMessage(err)); }
});

export const updateModuleProgress = createAsyncThunk('learning/updateProgress', async ({ moduleId, data }: { moduleId: number, data: any }, { rejectWithValue }) => {
    try {
        const response = await api.post(`/learning-progress/module/${moduleId}`, data);
        return response.data.body;
    } catch (err: any) { return rejectWithValue(extractErrorMessage(err)); }
});

export const fetchMySchedule = createAsyncThunk('learning/fetchSchedule', async (_, { rejectWithValue }) => {
    try {
        const response = await api.get('/learning-schedule/my-schedule');
        return response.data.body;
    } catch (err: any) { return rejectWithValue(extractErrorMessage(err)); }
});

export const updateScheduleStatus = createAsyncThunk('learning/updateSchedule', async ({ id, status }: { id: number, status: string }, { rejectWithValue }) => {
    try {
        const response = await api.put(`/learning-schedule/${id}/status`, { status });
        return response.data.body;
    } catch (err: any) { return rejectWithValue(extractErrorMessage(err)); }
});

export const fetchModules = createAsyncThunk('learning/fetchModules', async (_, { rejectWithValue }) => {
    try {
        const response = await api.get('/learning-path/modules');
        return response.data.body.modules;
    } catch (err: any) { return rejectWithValue(extractErrorMessage(err)); }
});

export const fetchModuleById = createAsyncThunk('learning/fetchModuleById', async (moduleId: string, { rejectWithValue }) => {
    try {
        const response = await api.get(`/learning-path/modules/${moduleId}`);
        return response.data.body;
    } catch (err: any) { return rejectWithValue(extractErrorMessage(err)); }
});

export const completeModule = createAsyncThunk('learning/completeModule', async ({ moduleId, testResults }: { moduleId: number | string, testResults: any }, { rejectWithValue }) => {
    try {
        const response = await api.post(`/learning-progress/module/${moduleId}/complete`, { testResults });
        return response.data;
    } catch (err: any) { return rejectWithValue(extractErrorMessage(err)); }
});

export const resummarizeModule = createAsyncThunk('learning/resummarize', async (moduleId: string, { rejectWithValue }) => {
    try {
        const response = await api.post(`/learning-path/modules/${moduleId}/resummarize`);
        return response.data.body;
    } catch (err: any) { return rejectWithValue(extractErrorMessage(err)); }
});

const processSequentialLocking = (modules: any[]) => {
    if (!modules || modules.length === 0) return [];
    
    // Sort by orderInPath to ensure sequence
    const sorted = [...modules].sort((a, b) => (a.orderInPath || 0) - (b.orderInPath || 0));
    
    let firstIncompleteFound = false;
    
    return sorted.map((m, index) => {
        // Explicitly check for completion: prioritize user-specific progress flags
        const isDone = m.userStatus === 'completed' || m.isCompleted === true;
        
        let isLocked = false;
        if (index === 0) {
            isLocked = false; // First is always open
        } else {
            // Unlocked only if all previous were completed
            isLocked = firstIncompleteFound;
        }
        
        // ONLY consider "userStatus": "pending" and "isCompleted": false for locking subsequent modules
        if (m.userStatus === 'pending' && m.isCompleted === false) {
            firstIncompleteFound = true;
        }
        
        return {
            ...m,
            isCompleted: isDone,
            isLocked: isLocked
        };
    });
};

const learningSlice = createSlice({
    name: 'learning',
    initialState,
    reducers: {
        setLearningPath: (state, action) => {
            state.learningPath = {
                ...action.payload,
                modules: processSequentialLocking(action.payload.modules)
            };
            state.pathStatus = 'COMPLETED';
        },
        markModuleWatched: (state, action: { payload: { moduleId: number | string } }) => {
            const { moduleId } = action.payload;
            if (state.activeModule && (state.activeModule.id === moduleId)) {
                state.activeModule.isWatched = true;
            }
            state.currentModules = state.currentModules.map(m => 
                m.id === moduleId ? { ...m, isWatched: true } : m
            );
            if (state.learningPath?.modules) {
                state.learningPath.modules = state.learningPath.modules.map((m: any) => 
                    m.id === moduleId ? { ...m, isWatched: true } : m
                );
            }
        }
    },
    extraReducers: (builder) => {
        const handlePending = (state: LearningState) => { state.loading = true; state.error = null; };
        const handleRejected = (state: LearningState, action: any) => { state.loading = false; state.error = action.payload as string; };

        builder.addCase(fetchLearningPathStatus.fulfilled, (state, action) => {
            state.loading = false;
            state.pathStatus = action.payload.status; // Adjust based on API response
        });

        builder.addCase(fetchMyLearningPath.fulfilled, (state, action) => {
            state.loading = false;
            if (action.payload) {
                state.learningPath = {
                    ...action.payload,
                    modules: processSequentialLocking(action.payload.modules)
                };
                state.pathStatus = action.payload?.status || null;
            }
        });

        builder.addCase(regeneratePath.fulfilled, (state, action) => {
            state.loading = false;
            if (action.payload) {
                state.learningPath = {
                    ...action.payload,
                    modules: processSequentialLocking(action.payload.modules)
                };
                state.pathStatus = action.payload?.status || null;
            }
        });

        builder.addCase(fetchModules.fulfilled, (state, action) => {
            state.loading = false;
            state.currentModules = processSequentialLocking(action.payload);
        });

        builder.addCase(fetchModuleById.fulfilled, (state, action) => {
            state.loading = false;
            state.activeModule = action.payload;
        });

        builder.addCase(resummarizeModule.fulfilled, (state, action) => {
            state.loading = false;
            state.activeModule = action.payload;
        });

        builder.addCase(completeModule.fulfilled, (state, action) => {
            state.loading = false;
            const moduleId = action.meta.arg.moduleId;

            if (state.activeModule && (state.activeModule.id == moduleId)) {
                state.activeModule.status = 'completed';
                state.activeModule.isCompleted = true;
                state.activeModule.userStatus = 'completed';
            }

            const updateList = (modules: any[]) => {
                const updated = modules.map(m => 
                    m.id == moduleId ? { ...m, isCompleted: true, userStatus: 'completed' } : m
                );
                return processSequentialLocking(updated);
            };

            state.currentModules = updateList(state.currentModules);
            
            if (state.learningPath?.modules) {
                state.learningPath.modules = updateList(state.learningPath.modules);
            }
        });

        builder.addCase(fetchMyProgress.fulfilled, (state, action) => {
            state.loading = false;
            state.progress = action.payload;
        });

        builder.addCase(fetchMySchedule.fulfilled, (state, action) => {
            state.loading = false;
            state.schedule = action.payload;
        });

        // Add pending/rejected handlers for all
        builder.addCase(fetchLearningPathStatus.pending, handlePending).addCase(fetchLearningPathStatus.rejected, handleRejected);
        builder.addCase(fetchMyLearningPath.pending, handlePending).addCase(fetchMyLearningPath.rejected, handleRejected);
        builder.addCase(fetchModules.pending, handlePending).addCase(fetchModules.rejected, handleRejected);
        builder.addCase(fetchModuleById.pending, handlePending).addCase(fetchModuleById.rejected, handleRejected);
        builder.addCase(fetchMyProgress.pending, handlePending).addCase(fetchMyProgress.rejected, handleRejected);
        builder.addCase(fetchMySchedule.pending, handlePending).addCase(fetchMySchedule.rejected, handleRejected);
        builder.addCase(regeneratePath.pending, handlePending).addCase(regeneratePath.rejected, handleRejected);
        builder.addCase(updateModuleProgress.pending, handlePending).addCase(updateModuleProgress.rejected, handleRejected);
        builder.addCase(updateScheduleStatus.pending, handlePending).addCase(updateScheduleStatus.rejected, handleRejected);
        builder.addCase(resummarizeModule.pending, handlePending).addCase(resummarizeModule.rejected, handleRejected);
    },
});

export const { setLearningPath, markModuleWatched } = learningSlice.actions;
export default learningSlice.reducer;
