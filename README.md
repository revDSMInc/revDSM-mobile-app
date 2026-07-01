# revDSM Sales — Mobile Application

This report provides a comprehensive breakdown of the architecture, folder structure, and the systematic workflow followed in the CommoPlast Mobile Application.

---

## 🏗️ Project Architecture

The application follows a **Modular Layered Architecture**, which ensures a strict separation of concerns between the user interface, data management, and business logic.

- **Presentation Layer** (`screens/`, `widgets/`): Focused purely on UI/UX using React Native components and stylized via a centralized theme.
- **Domain Layer** (`redux/`): Manages global application state (authentication, user profile, global data) using Redux Toolkit (RTK).
- **Data Layer** (`services/`): Handles all external communications. It includes an API service layer built on Axios with interceptors for token management.
- **Navigation Layer** (`navigation/`): Orchestrates screen transitions and authentication-gated routing.
- **Utility Layer** (`hooks/`, `utils/`, `config/`): Contains reusable logic, environment variables, and helper functions.

---

## 📂 Folder Structure Overview

```text
src/
├── assets/              # Static files (images, icons, fonts)
├── config/              # App constants, types, and environment configs
│   ├── types/           # Global TypeScript interfaces
│   └── env.ts           # API base URL config
├── hooks/               # Custom React hooks (e.g., useAuth)
├── locales/             # Multi-language support (i18n)
├── navigation/          # Navigation stacks (Auth, App, Drawer)
│   └── RootNavigator.tsx # Main entry point for navigation
├── redux/               # Global state management
│   ├── reducer/         # Redux Slices (Auth, Dashboard, etc.)
│   └── store.ts         # Redux store & persist configuration
├── screens/             # View components grouped by feature
│   ├── auth/            # Login, Signup, OTP
│   └── dashboard/       # Main App views (Leads, Profile, etc.)
├── services/            # Backend integration
│   ├── api/             # API endpoint definitions (Axios instance)
│   └── local.storage/   # Async storage wrappers
├── theme/               # Global styles (Colors, Typography, Spacing)
│   ├── ThemeProvider.tsx # Theme context provider
│   └── theme.ts         # Visual design tokens
├── utils/               # Formatters, Validators, and Helpers
└── widgets/             # Generic reusable components (Buttons, Inputs, Cards)
```

---

## 🛠️ Step-by-Step Implementation Workflow

When building a new module or feature, follow this exact sequence to maintain architectural integrity:

### Step 1: Define the API Service
Define your async functions and endpoints in `src/services/api/index.ts` (or a feature-specific file in that directory).

### Step 2: Set Up Global State
Create a slice in `src/redux/reducer/[feature].reducer.ts`.
- Use `createSlice` from `@reduxjs/toolkit`.
- Import and register the reducer in `src/redux/store.ts`.

### Step 3: Configure Navigation
If the new feature requires a new screen:
- Add the screen component to the appropriate stack in `src/navigation/RootNavigator.tsx`.

### Step 4: Build Reusable Widgets
Break down the UI into smaller pieces.
- Create components in `src/widgets/`.
- Apply styles using tokens from `src/theme/`.

### Step 5: Implement the Screen
Create the screen in `src/screens/[module]/[ScreenName].tsx`.
- Use the `useAuth` hook or custom hooks from `src/hooks/` to trigger API calls.
- Assemble the widgets to form the layout.

---

## 🔐 Authentication & Session Security

- **JWT Persistence**: Tokens are stored in `AsyncStorage` and persisted via `redux-persist` in the auth slice.
- **Axios Interceptors**: All requests automatically attach the `Authorization: Bearer [JWT]` header.
- **Session Conflict**: If a 401 Unauthorized error is received (e.g., logged in from another device), the app clears the session and notifies the user before redirecting to the login screen.

---

## 🎨 Theme & Design

The app uses a centralized theme system in `src/theme/`.
- **Dynamic Mode**: Supports Light and Dark modes based on device settings.
- **Standard Palette**:
  - Primary: `#4CBB17`
  - Success: `#22C55E`
  - Error: `#FF5630`

---

## 🧪 Testing

Tests are isolated to `__tests__/`, `jest.config.js`, `jest.setup.js`, and `__mocks__/`. **No production source files are modified** — the test suite is entirely additive.

### Running Tests

```bash
# Run all tests (440 tests across 34 suites)
npm test            # or: yarn test

# Run a specific file or directory
npx jest __tests__/utils/calculator/
npx jest __tests__/hooks/useTeamChannelPermission.test.ts

# Watch mode during development
npx jest --watch

# Verbose output (show every test name)
npx jest --verbose
```

### Test Categories

| Category | Suites | Tests | What It Covers |
|----------|--------|-------|----------------|
| **Calculator** | 14 | 202 | Pricing math, fee formulas, commission rates (thresholds/overage), payment plan validation (GreenSky, WF, Concora, Lowes), auto-confirm scheduling (MMKV), data normalization, tier ordering, tab naming, quote calculation object shape, title save order. |
| **Non-Calculator Utils** | 15 | 215 | Date parsing (`parseSafeISO`), error parsing (`parseApiError`), phone formatting (`formatUSPhoneNumber`), property normalization, distance (Haversine), S3 URL resolution, email/password/name validation, job builder summary/validation (gutter/LF/soffit/fascia), MMKV storage CRUD, zone canvasser constants/math, activity-log auto-field extraction. |
| **Hooks** | 1 | 11 | `useTeamChannelPermission` — channel permission logic (announcements/files blocked, general/sales-wins allowed). |
| **Parity** | 2 | 13 | Web parity comparison helpers (LF Calculator pricing alignment). |
| **App Smoke** | 1 | 1 | `App.tsx` renders without crashing (native modules mocked). |

### Test Design Principles

- **Pure unit tests preferred** — no React Native runtime mocking for business logic tests.
- **Calculator tests are highest priority** — pricing errors cause direct financial loss.
- **Mock strategy varies by dependency**:
  - Pure functions → no mock needed.
  - MMKV-dependent → mock `../../utils/storage` directly (not `react-native-mmkv`).
  - Complex hooks (Redux, Navigation) → deferred, only simple hooks covered.
- **Shared mutable state across tests is avoided** using per-test `beforeEach` store setup.

---

## 🚀 Getting Started

1. **Install Dependencies**: `npm install`
2. **Start Metro**: `npm start`
3. **Run on Android**: `npm run android`
4. **Run on iOS**: `npm run ios` (and `cd ios && pod install`)
