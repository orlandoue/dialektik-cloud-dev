plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val releaseStorePath = providers.environmentVariable("DIALEKTIK_ANDROID_KEYSTORE_PATH").orNull
val releaseStorePassword = providers.environmentVariable("DIALEKTIK_ANDROID_KEYSTORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("DIALEKTIK_ANDROID_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("DIALEKTIK_ANDROID_KEY_PASSWORD").orNull
val releaseSigningReady = listOf(
    releaseStorePath, releaseStorePassword, releaseKeyAlias, releaseKeyPassword
).all { !it.isNullOrBlank() }
// Beta builds shared by hand (not the store) may be signed with the debug key,
// but only on explicit request: an unset key never silently falls back to it.
val betaDebugSignedRelease = providers.environmentVariable(
    "DIALEKTIK_ANDROID_BETA_DEBUG_SIGNING"
).orNull == "true"

android {
    namespace = "com.dialektik.dialektik"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.dialektik.dialektik"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("dialektikRelease") {
            if (releaseSigningReady) {
                storeFile = file(checkNotNull(releaseStorePath))
                storePassword = checkNotNull(releaseStorePassword)
                keyAlias = checkNotNull(releaseKeyAlias)
                keyPassword = checkNotNull(releaseKeyPassword)
            }
        }
    }

    buildTypes {
        release {
            if (releaseSigningReady) {
                signingConfig = signingConfigs.getByName("dialektikRelease")
            } else if (betaDebugSignedRelease) {
                signingConfig = signingConfigs.getByName("debug")
            }
        }
    }
}

flutter {
    source = "../.."
}

// A production build must never silently fall back to a debug or unsigned key.
if (!releaseSigningReady && !betaDebugSignedRelease) {
    tasks.configureEach {
        if (name.contains("Release", ignoreCase = true)) {
            doFirst {
                throw GradleException("Android release signing requires DIALEKTIK_ANDROID_KEYSTORE_PATH, DIALEKTIK_ANDROID_KEYSTORE_PASSWORD, DIALEKTIK_ANDROID_KEY_ALIAS and DIALEKTIK_ANDROID_KEY_PASSWORD (or DIALEKTIK_ANDROID_BETA_DEBUG_SIGNING=true for a hand-shared beta).")
            }
        }
    }
}
