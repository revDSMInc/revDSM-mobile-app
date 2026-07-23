# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# Keep custom Haptic Feedback native module and package
-keep class com.revdsm.HapticFeedbackModule { *; }
-keep class com.revdsm.HapticFeedbackPackage { *; }

# --- PDF / file libraries: keep classes used via JS bridge reflection ---

# react-native-pdf (wraps PDFium renderer, accessed via reflection)
-keep class org.wonday.pdf.** { *; }
-keep class com.shockwave.** { *; }
-dontwarn org.wonday.pdf.**

# react-native-blob-util (file download/transfer)
-keep class com.RNFetchBlob.** { *; }
-dontwarn com.RNFetchBlob.**
-keep class com.ReactNativeBlobUtil.** { *; }
-dontwarn com.ReactNativeBlobUtil.**

# react-native-fs (file system access)
-keep class com.rnfs.** { *; }
-dontwarn com.rnfs.**

# react-native-file-viewer (correct package: com.vinzscam.reactnativefileviewer)
# Critical: this includes its own FileProvider subclass referenced by the manifest.
# If stripped/renamed, the manifest's <provider android:name> won't resolve and
# previews fail silently in release builds.
-keep class com.vinzscam.reactnativefileviewer.** { *; }
-dontwarn com.vinzscam.reactnativefileviewer.**

# General safety net for any RN bridge module/package
-keep public class * extends com.facebook.react.bridge.ReactContextBaseJavaModule { *; }
-keep public class * implements com.facebook.react.bridge.NativeModule { *; }
-keep public class * implements com.facebook.react.ReactPackage { *; }

# Keep React Native core bridge classes
-keep class com.facebook.react.bridge.** { *; }
-keep class com.facebook.react.uimanager.** { *; }

# Keep all FileProvider subclasses (covers any library using this pattern)
-keep class * extends androidx.core.content.FileProvider { *; }
-keep class androidx.core.content.FileProvider { *; }