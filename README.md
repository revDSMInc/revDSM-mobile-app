# revDSM Sales — React Native App

A **Sales Representative** mobile application built with React Native, following **Feature-Sliced Design (FSD)** architecture. The app mirrors the functionality and design of the [mhalt-revdsm-frontend](https://github.com/your-org/mhalt-revdsm-frontend) web application, adapted for mobile.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native 0.84 |
| Language | TypeScript |
| Styling | NativeWind (Tailwind CSS for RN) |
| Navigation | React Navigation (Native Stack) |
| Auth | JWT via Axios + AsyncStorage |
| HTTP Client | Axios |
| Code Quality | Prettier |
| Architecture | Feature-Sliced Design (FSD) |

---

## Architecture — Feature-Sliced Design (FSD)

The codebase strictly follows [FSD](https://feature-sliced.design/) layer rules. Each layer can **only import from layers below it**. No cross-slice imports between siblings.

```
src/
├── app/                          ← Initialization: providers, navigation
│   ├── navigation/
│   │   └── RootNavigator.tsx     ← Auth-gated navigation
│   └── providers/
│       ├── AuthProvider.tsx      ← JWT auth state & session management
│       └── ThemeProvider.tsx     ← Dark / Light theme (follows device)
│
├── pages/                        ← Screen composition (UI only, no business logic)
│   ├── leads/
│   │   └── ui/LeadsPage.tsx      ← Main page shown after login
│   └── login/
│       └── ui/LoginScreen.tsx    ← JWT login form
│
├── features/                     ← Business logic / user scenarios
│   └── sales/
│       ├── index.ts              ← Public API
│       └── hooks/
│           └── useLeadsData.ts   ← Fetches leads from API
│
├── entities/                     ← Business entity types & models
│   └── lead/
│       ├── index.ts
│       └── model/types.ts        ← Lead type definition
│
└── shared/                       ← Pure reusables — no business logic
    ├── index.ts
    ├── api/axios.ts              ← Axios instance + all API endpoints
    ├── auth/context.ts           ← AuthContext definition & types
    ├── hooks/useAuth.ts          ← useAuth() hook
    └── config/
        ├── env.ts                ← API base URL config
        └── theme.ts              ← Web-app matched colour palette tokens
```

### Import Direction
```
app → pages → features → entities → shared
```

---

## Environment Configuration

Set the API base URL in `src/shared/config/env.ts`:

```ts
export const ENV = {
  API_URL: 'https://staging-api.revdsm.com',
};
```

Also mirrored in `.env`:
```
API_URL=https://staging-api.revdsm.com
```

---

## Authentication

JWT-based authentication mirroring the web app's `auth-provider.js`:

1. On app start, `AuthProvider` checks `AsyncStorage` for an existing `accessToken`
2. If found, calls `GET /company` to restore the session
3. On login, calls `POST /company/login` → stores token → fetches user profile
4. On logout, removes token and resets state
5. `RootNavigator` shows `LoginScreen` or `LeadsPage` based on auth state

---

## Theme

The app follows the device's dark/light mode automatically via `ThemeProvider`. The colour palette is directly mapped from the web app's `src/theme/palette.js` (MUI tokens → React Native style objects).

| Token | Value |
|-------|-------|
| Primary | `#4CBB17` |
| Secondary | `#8E33FF` |
| Success | `#22C55E` |
| Error | `#FF5630` |
| Warning | `#FFAB00` |

---

## Getting Started

### Prerequisites

- Node.js >= 22
- React Native environment (Android Studio / Xcode)
- Android device or emulator connected

### Install

```bash
nvm use 22
yarn install
cd ios && pod install && cd ..
```

### Run

```bash
# Start Metro bundler
yarn start --reset-cache

# Run on Android
yarn android

# Run on iOS
yarn ios
```

### Format Code

```bash
npx prettier --write "src/**/*.{ts,tsx}" "App.tsx"
```

---

## Key API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/company/login` | POST | JWT login |
| `/company` | GET | Fetch current user |
| `/demo/v1/leads/sales-portal?repId={id}` | GET | Fetch leads for rep |
| `/job-tracker` | GET | Fetch job tracker list |
| `/appointments` | GET | Fetch appointments |

---

## Screens

| Screen | Route | Description |
|--------|-------|-------------|
| Login | `Login` | Email/password JWT login |
| Leads | `Leads` | Leads list with search, stats, pull-to-refresh |

---

## Code Quality

- **Prettier** config in `.prettierrc` — single quotes, 100 char width, trailing commas
- **TypeScript** strict mode throughout
- **FSD** layer rules enforced — no cross-feature or upward imports
- Each feature slice exposes a public API via `index.ts`
