# Building the mobile app (iOS / Android)

openGym ships in two flavors from the same codebase:

| | **Self-hosted** (this repo's default) | **Mobile app** (`VITE_MOBILE=1`) |
|---|---|---|
| Runs | in any browser, against your own server | natively on iPhone / Android (Capacitor shell) |
| Accounts | passkey sign-in, one profile per person | none — the phone *is* the account |
| Data | synced to your server, readable on desktop | stays on the device (file in the app's private storage) |
| Reminders | Web Push from your server | native local notifications, no server involved |
| Exercise media | served by your server (`img/`, `gif/`) | loaded from the jsDelivr CDN |

The mobile flavor never talks to a backend: no sign-in screen, no sync, no telemetry.
State is mirrored from `localStorage` into `opengym-state.json` in the app's private data
directory on every change (iOS is allowed to evict WebView storage under pressure — the
file mirror is the durable copy and is restored on launch). Backups go out through the
OS share sheet instead of a browser download.

## Prerequisites

- Node 20+
- **Android:** Android Studio (bundles the SDK). Java 21 for Gradle.
- **iOS:** a Mac with Xcode 15+ and CocoaPods (`brew install cocoapods`). A free Apple ID
  is enough to run the app on your own iPhone (see below); paid membership is only needed
  for App Store distribution, which openGym doesn't do.

## Build & run

```sh
cd frontend
npm install
npm run build:mobile        # VITE_MOBILE build + `cap sync` into android/ and ios/

npx cap open android        # opens Android Studio → run on emulator or device
npx cap open ios            # opens Xcode (Mac only) → set your signing team, then run
```

`npm run build:mobile` bakes the CDN media base into the bundle and copies the web build
into both native projects — re-run it after every web-code change before building natively.

> **Heads-up:** after `build:mobile`, `frontend/dist` contains the *mobile* bundle.
> Run a plain `npm run build` again before deploying `dist` to a server.

## App icons & splash screens

`frontend/resources/icon.svg` is the 1024×1024 source (the app's dumbbell glyph on the
app background). Generate all platform assets from it on a machine with the tooling:

```sh
cd frontend
npx @capacitor/assets generate --iconBackgroundColor '#0c0e12' --splashBackgroundColor '#0c0e12'
```

(If the generator won't take the SVG directly, export it to `resources/icon.png` at
1024×1024 first — any image tool can do it.)

## Distribution — deliberately no app stores

openGym's mobile app is not on the Play Store or App Store, and that's a choice: no store
accounts, no store rules, no yearly fees between you and an open-source app.

### Android — sideload the APK

The upstream project's signed APK is at
**[opengym.duarte-santos.ch](https://opengym.duarte-santos.ch)**. Android asks you to allow
installs from the browser the first time — that's standard for any app outside the Play Store.

#### Let GitHub build it (`.github/workflows/android.yml`)

This fork builds the APK in CI, so you never need Android Studio on your own machine:

- **Every push** to `main` or a `claude/**` branch runs the test suite and attaches the APK
  to the workflow run. Grab it from the run's **Artifacts** section (Actions → the run →
  scroll down), or trigger one by hand with **Run workflow**.
- **Pushing a `v*` tag** additionally publishes a GitHub Release with the APK attached, which
  is the link you can open directly on a phone.

  ```sh
  git tag v1.3.0 && git push origin v1.3.0
  ```

Without any setup the workflow publishes the **debug-signed** APK. It installs and runs
normally — the catch is that it carries Android's public debug key, so a later release-signed
build can't upgrade it in place. To get a properly signed APK, create a keystore once and add
four repository secrets (Settings → Secrets and variables → Actions):

```sh
keytool -genkeypair -keystore my.keystore -alias opengym -keyalg RSA -validity 10950
base64 -w0 my.keystore          # → paste as ANDROID_KEYSTORE_BASE64
```

| Secret | What it is |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the base64 above |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `opengym`, or whatever alias you chose |
| `ANDROID_KEY_PASSWORD` | key password (often the same as the keystore one) |

**Back the keystore up somewhere safe.** Android refuses to install an update signed with a
different key, and the only way out is uninstalling the app — which deletes the training log
with it.

#### Or build and sign it yourself

```sh
cd frontend && npm run build:mobile
cd android && ./gradlew assembleRelease            # → app/build/outputs/apk/release/app-release-unsigned.apk

# one-time: create a keystore. KEEP IT — updates must be signed with the same key,
# or Android refuses to install the new version over the old one.
keytool -genkeypair -keystore my.keystore -alias opengym -keyalg RSA -validity 10950

# align + sign (zipalign/apksigner ship with the Android SDK build-tools)
zipalign -f -p 4 app-release-unsigned.apk aligned.apk
apksigner sign --ks my.keystore --ks-key-alias opengym --out openGym.apk aligned.apk
```

### iPhone — what's actually possible

Apple does not allow installing apps outside the App Store, so there is no `.ipa` download
that would simply install. Your free options:

- **Self-host + PWA** (recommended): open your instance in Safari → Share → *Add to Home
  Screen*. Full-screen app, no expiry, plus sync and passkeys.
- **Xcode free signing:** open `ios/` in Xcode with a free Apple ID as the team and run it
  onto your own iPhone. Apple expires the signature after 7 days; re-run from Xcode to renew.
- **AltStore:** automates that 7-day re-signing over Wi-Fi via a Mac companion app.

### Release notes for maintainers

- Bump `versionName`/`versionCode` in `android/app/build.gradle` per release; keep them in
  step with `frontend/package.json`. `versionCode` must strictly increase or updates won't
  install over an existing APK.
- **License:** openGym is AGPL-3.0, which by itself sits badly with app-store terms of
  service. `NOTICE.md` carries an app-store exception (an additional permission under
  AGPL §7) granted by the copyright holder — relevant only if store distribution ever happens.
- The app requests notification permission only when the workout-day reminder is switched
  on, and (on Android) declares `SCHEDULE_EXACT_ALARM` so the reminder fires to the minute
  where the user allows it.
