import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import {
  persistStore,
  persistReducer,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from 'redux-persist';
import { reduxPersistStorage } from '../utils/storage';
import authReducer from './reducer/auth.reducer';

const persistConfig = {
  key: 'root',
  storage: reduxPersistStorage,
  // ⚠️ These are keys of `AuthState` — `user` / `loading` / `isInitialized` /
  // `isAuthenticated` — NOT slice names. `persistReducer` is applied to `authReducer`
  // itself, not to a `combineReducers` root, so redux-persist filters the SLICE'S OWN
  // keys here. This read `['auth']` (a slice name that is not a key of this state), so
  // `passWhitelistBlacklist` rejected every field and **nothing but `_persist` was ever
  // written** — the persisted profile the offline bootstrap falls back to
  // (`useAppInitialization`'s catch) was always null, which is why killing the app
  // offline returned the rep to the login screen with a perfectly good token in MMKV.
  //
  // ⚠️ Only `user`. `loading` / `isInitialized` gate the splash (`App.tsx`,
  // `navigation/index.tsx`): a persisted `isInitialized: true` would render the
  // navigator before bootstrap had run, and a persisted `loading: true` — written if the
  // app was killed mid-sign-in — would hang the splash forever. `isAuthenticated` needs
  // no persisting either: every path out of `initialize()` dispatches `setInitial`,
  // which derives it from `user`, and nothing reads it while `isInitialized` is false.
  whitelist: ['user'],
};

const persistedAuthReducer = persistReducer(persistConfig, authReducer);

export const store = configureStore({
  reducer: {
    auth: persistedAuthReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
});

export const persistor = persistStore(store);

setupListeners(store.dispatch);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
