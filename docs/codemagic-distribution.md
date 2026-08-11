# Codemagic Mobile Distribution

Codemagic is the exclusive CI/CD build and distribution path for the Bizlee
Expo-framework mobile app. EAS Build and EAS Submit are not used.
The repository-root `codemagic.yaml` defines two production workflows:

- `bizlee-android-internal` builds a signed AAB and APK, retains both as build
  artifacts, and publishes the AAB to the Google Play internal track.
- `bizlee-ios-testflight` builds a signed IPA and uploads it to App Store
  Connect, where it becomes available for TestFlight configuration after Apple
  finishes processing it.

It also defines `bizlee-android-test-apk`, a manual build-only workflow that
creates a debug-signed APK for direct device testing. It does not require a
Play service account, production keystore, or Firebase configuration and never
publishes to a store.

Neither production workflow runs for an ordinary branch push. Run one manually
from Codemagic, or create a Git tag matching `mobile-v*` to trigger both
production workflows.

For the first device test, select **Bizlee Android - Downloadable Test APK** in
Codemagic and start a manual build. After it completes, download the `.apk` from
the build's **Artifacts** section and install it on an Android device. Android
may ask you to allow installs from the browser or file manager used to open it.

## 1. Import the YAML configuration

In the Codemagic application connected to the GitHub repository:

1. Select the `master` branch.
2. Choose **Check for configuration file**.
3. Confirm that Codemagic finds `/codemagic.yaml`.
4. Create or update the repository webhook if tag-triggered releases are
   required. Manual builds work without enabling automatic tag builds.

## 2. Shared mobile environment

Create an application-level variable group named `bizlee_mobile` containing:

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_API_URL` | Production HTTPS mobile API root, ending in `/api/mobile/v1` |
| `EXPO_PUBLIC_SUPABASE_URL` | Production Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Production Supabase publishable/anon key |
| `EXPO_PUBLIC_EXPO_PROJECT_ID` | Expo project ID used only by the existing Expo push client |
| `ANDROID_GOOGLE_SERVICES_JSON_BASE64` | Base64-encoded Firebase `google-services.json`; mark secret |

The `EXPO_PUBLIC_*` values are embedded in the client bundle. Codemagic decodes
the Firebase value only on its ephemeral build machine. Never add a Supabase
service role key, database password, Apple private key, Android keystore,
Razorpay secret, or worker secret to an `EXPO_PUBLIC_*` variable.

The production workflow rejects a non-HTTPS API URL. Expo remains a runtime
framework and push transport dependency; Codemagic performs all native builds,
signing, artifact retention, and store uploads.

## 3. Android signing and Google Play

### Signing identity

Under **Team settings → codemagic.yaml settings → Code signing identities →
Android keystores**, upload the production upload keystore using this exact
reference name:

```text
bizlee_android_keystore
```

Enter the keystore password, key alias, and key password in Codemagic. Keep an
independent encrypted backup of the keystore. If the package has previously
been uploaded to Google Play, use the existing upload key rather than creating
a different one.

The workflow obtains `CM_KEYSTORE_PATH`, `CM_KEYSTORE_PASSWORD`,
`CM_KEY_ALIAS`, and `CM_KEY_PASSWORD` from this identity. The generated Expo
Gradle project is patched during CI so the release build uses this keystore
instead of Expo's debug signing configuration.

### Google Play publishing

Create a secret variable group named `google_play` with:

| Variable | Value |
|---|---|
| `GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS` | Complete Google service-account JSON document |

In Google Play Console, grant that service account release access only to the
Bizlee application (`com.bizlee.mobile`). Financial permissions and account
administrator access are not required.

Google Play requires the first store version to be uploaded manually. Run the
Android workflow, download the signed `.aab` artifact, create the Play Console
application if needed, and upload that first bundle manually. Subsequent builds
can publish automatically to the internal testing track.

The workflow also produces a signed APK for direct internal installation. The
APK is a Codemagic artifact and is not uploaded to Google Play.

## 4. iOS signing and TestFlight

The production bundle identifier is:

```text
com.bizlee.mobile
```

Before the first iOS workflow:

1. Create the matching app identifier in Apple Developer and the app record in
   App Store Connect.
   Enable Push Notifications and Associated Domains for the identifier.
2. Add an Apple Distribution certificate and an App Store provisioning profile
   to **Code signing identities**. Both must match `com.bizlee.mobile`.
3. Create a secret variable group named `app_store_credentials` containing:

| Variable | Value |
|---|---|
| `APP_STORE_CONNECT_PRIVATE_KEY` | Full `.p8` API-key content |
| `APP_STORE_CONNECT_KEY_IDENTIFIER` | App Store Connect API Key ID |
| `APP_STORE_CONNECT_ISSUER_ID` | App Store Connect Issuer ID |

Use an App Store Connect API key with **App Manager** access. The workflow uses
the matching uploaded signing identity to create the IPA and the API variables
to upload it. It does not automatically submit the build for App Store review
or external TestFlight beta review. Assign internal testers after processing,
then promote deliberately when release metadata and compliance answers are
complete.

## 5. Versioning and release operation

`APP_VERSION` is currently `0.1.0` in both workflows. Codemagic's built-in
`BUILD_NUMBER` is written to Android `versionCode` and iOS `buildNumber`, so
every workflow run produces a store-distinct build.

For a coordinated release:

```bash
git tag mobile-v0.1.0
git push origin mobile-v0.1.0
```

Use a new tag for every release. To distribute only one platform, start that
workflow manually from the Codemagic UI instead of creating a tag.

Before promoting beyond internal testing, verify login, push registration,
role-scoped navigation, Field Staff survey/project transitions, deep links,
and production API connectivity on physical Android and iOS devices.
