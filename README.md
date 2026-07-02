# ScreenControl Tasks

אפליקציה משפחתית למשימות תמורת דקות מסך עבור אורי ואיתן.

## Production

- Web app: https://screencontrol-tasks.pages.dev/
- API: https://screen-tasks-backend.yanivsa.workers.dev/
- Repository: https://github.com/yanivsa/screencontrol-tasks

## Architecture

- Frontend: React + Vite
- Mobile wrapper: Capacitor Android
- Hosting: Cloudflare Pages
- API: Cloudflare Worker
- Database: Cloudflare D1
- Photo storage: D1 fallback in production. R2 binding is prepared but disabled until R2 is enabled in the Cloudflare account.

## Local Development

Frontend:

```bash
cd frontend
npm install
npm run build
npm run lint
```

Backend:

```bash
cd backend
npm install
npx wrangler deploy
```

Android release bundle:

```bash
cd frontend
npm run build
npx cap sync android
cd android
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew bundleRelease
```

Release artifact:

```text
frontend/android/app/build/outputs/bundle/release/app-release.aab
```

## Required Cloudflare Secrets

Set these on the Worker:

- `TOKEN_SECRET`
- `PIN_PEPPER`

Optional local/dev init controls:

- `ALLOW_INIT`
- `INIT_SECRET`

## Current Production Notes

- Parent PIN: `2602`
- Uri PIN: `2611`
- Eitan PIN: `0603`
- `/api/init` is blocked in production.
- CORS is restricted to the production Pages domain and local development origins.
- R2 must be enabled in the Cloudflare dashboard before uncommenting the R2 binding in `backend/wrangler.toml`.
