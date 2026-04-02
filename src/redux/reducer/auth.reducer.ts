import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface AuthState {
  user: any;
  loading: boolean;
  isInitialized: boolean;
  isAuthenticated: boolean;
}

const initialState: AuthState = {
  user: null,
  loading: false,
  isInitialized: false,
  isAuthenticated: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setInitial: (state, action: PayloadAction<{ user: any }>) => {
      state.user = action.payload.user;
      state.isAuthenticated = !!action.payload.user;
      state.isInitialized = true;
      state.loading = false;
    },
    login: (state, action: PayloadAction<{ user: any }>) => {
      state.user = action.payload.user;
      state.isAuthenticated = true;
    },
    logout: (state) => {
      state.user = null;
      state.isAuthenticated = false;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
  },
});

export const { setInitial, login, logout, setLoading } = authSlice.actions;
export default authSlice.reducer;
