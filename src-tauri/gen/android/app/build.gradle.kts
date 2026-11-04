import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "com.mediahub.rssreader"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.mediahub.rssreader"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    // Release signing. The keystore is never in the repo: CI writes it from a
    // secret before building, and `keystore.properties` (gitignored) or the
    // RSS_KEYSTORE_* environment variables carry the passwords. Without them the
    // release falls back to the debug key, which installs but is not a release
    // signature anyone should distribute.
    val releaseStore = file(System.getenv("RSS_KEYSTORE") ?: "release.keystore")
    val releaseProperties = java.util.Properties().apply {
        val file = file("keystore.properties")
        if (file.exists()) file.inputStream().use { load(it) }
    }
    fun signingValue(key: String, env: String, fallback: String? = null): String? =
        releaseProperties.getProperty(key) ?: System.getenv(env) ?: fallback

    signingConfigs {
        getByName("debug") {
            storeFile = file("rss-reader-debug.keystore")
            storePassword = "rssreaderdebug"
            keyAlias = "rssreaderdebug"
            keyPassword = "rssreaderdebug"
        }
        create("release") {
            if (releaseStore.exists()) {
                storeFile = releaseStore
                storePassword = signingValue("storePassword", "RSS_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "RSS_KEY_ALIAS", "rss-reader")
                keyPassword = signingValue(
                    "keyPassword", "RSS_KEY_PASSWORD",
                    signingValue("storePassword", "RSS_KEYSTORE_PASSWORD"),
                )
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            // Signed with the release key when one is present; the debug key is
            // only a fallback so a local `assemble` still works.
            signingConfig = signingConfigs.getByName(if (releaseStore.exists()) "release" else "debug")
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
