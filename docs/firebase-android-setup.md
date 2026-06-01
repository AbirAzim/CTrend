# Firebase Android setup (Google services Gradle plugin)

To expose `google-services.json` config values to Firebase SDKs, add the **Google services Gradle plugin** to your Android app module.

> **CTrend API note:** This repo is the NestJS backend. Use these steps in your **Android client** project. Place `google-services.json` from the [Firebase console](https://console.firebase.google.com/) under `<app-module>/` (usually `app/google-services.json`). The API can send FCM pushes when `FIREBASE_SERVICE_ACCOUNT` is configured on the server (see root `CLAUDE.md`).

---

## 1. Root-level `build.gradle` (project)

Add the plugin dependency (do not apply it at the root):

**Groovy (`<project>/build.gradle`):**

```groovy
plugins {
  // ...

  // Add the dependency for the Google services Gradle plugin
  id 'com.google.gms.google-services' version '4.4.4' apply false
}
```

**Kotlin DSL (`<project>/build.gradle.kts`):**

```kotlin
plugins {
  // ...

  id("com.google.gms.google-services") version "4.4.4" apply false
}
```

---

## 2. App-level `build.gradle` (module)

Apply the plugin and add Firebase dependencies:

**Groovy (`<project>/<app-module>/build.gradle`):**

```groovy
plugins {
  id 'com.android.application'

  // Add the Google services Gradle plugin
  id 'com.google.gms.google-services'

  // ...
}

dependencies {
  // Import the Firebase BoM
  implementation platform('com.google.firebase:firebase-bom:34.14.0')

  // TODO: Add the dependencies for Firebase products you want to use
  // When using the BoM, don't specify versions in Firebase dependencies
  implementation 'com.google.firebase:firebase-analytics'

  // Add the dependencies for any other desired Firebase products
  // https://firebase.google.com/docs/android/setup#available-libraries
}
```

**Kotlin DSL (`<project>/<app-module>/build.gradle.kts`):**

```kotlin
plugins {
  id("com.android.application")
  id("com.google.gms.google-services")
}

dependencies {
  implementation(platform("com.google.firebase:firebase-bom:34.14.0"))
  implementation("com.google.firebase:firebase-analytics")
  // implementation("com.google.firebase:firebase-messaging") // FCM, if needed
}
```

---

## 3. Checklist

1. Create or open the Firebase project and register the Android app (package name must match `applicationId`).
2. Download **`google-services.json`** and copy it to the app module directory (e.g. `app/google-services.json`).
3. Sync Gradle after editing both build files.
4. For push notifications with CTrend, also configure the backend `FIREBASE_SERVICE_ACCOUNT` env var.

---

## References

- [Add Firebase to your Android project](https://firebase.google.com/docs/android/setup)
- [Available Firebase Android libraries](https://firebase.google.com/docs/android/setup#available-libraries)
