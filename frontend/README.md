# ScreenControl Tasks Frontend

React + Vite frontend for the ScreenControl Tasks family app.

## Commands

```bash
npm install
npm run build
npm run lint
```

## Environment

Production API:

```text
VITE_API_BASE=https://screen-tasks-backend.yanivsa.workers.dev
```

## Android

The Android project is managed by Capacitor.

```bash
npm run build
npx cap sync android
cd android
./gradlew bundleRelease
```
