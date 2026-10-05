import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import GoogleMaps
import FirebaseCore

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  /// A MIRROR of the scene's window, assigned by `SceneDelegate`. Never assign a
  /// window of your own here.
  ///
  /// WARNING This property looks redundant under the UIScene lifecycle - the scene
  /// owns the window - but removing it CRASHES THE APP AT LAUNCH. `window` is an
  /// @optional member of `UIApplicationDelegate`, and react-native-firebase/messaging
  /// reads `[UIApplication sharedApplication].delegate.window` unguarded from its
  /// `UIApplicationDidFinishLaunchingNotification` observer
  /// (`RNFBMessaging+NSNotificationCenter.m`). With no such property the selector does
  /// not exist and the app dies in `doesNotRecognizeSelector:`. It must EXIST; it may
  /// be nil, which it still is when that observer runs, because the scene has not
  /// connected yet. That is safe: RNFB only uses the value behind nil checks, and
  /// solely to flip an `isHeadless` prop on an `RCTRootView` - which this app never
  /// has anyway, since the new architecture mounts an `RCTSurfaceHostingProxyRootView`.
  var window: UIWindow?

  /// Held for `SceneDelegate`, which is what actually starts React Native.
  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Firebase FIRST, before anything can touch a Firebase API.
    //
    // WARNING Without this call there is no default FirebaseApp, so every
    // @react-native-firebase call fails: `getToken()` never returns a token, the
    // device is never bound, and no push is ever delivered. Nothing surfaces on
    // screen when it is missing - the app simply receives nothing.
    //
    // WARNING It reads `GoogleService-Info.plist` FROM THE APP BUNDLE. The file
    // existing on disk is not enough: it has to be a member of the target Resources
    // build phase (it is - see project.pbxproj), or this throws
    // "Could not locate configuration file".
    if FirebaseApp.app() == nil {
      FirebaseApp.configure()
    }

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    GMSServices.provideAPIKey("AIzaSyBT3b_a8aWTuI0l9wqjhiT7lSgV_36pkUg")
    GMSServices.setMetalRendererEnabled(true)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    // React Native is started by `SceneDelegate.scene(_:willConnectTo:options:)`,
    // which runs right after this and owns the window.
    self.launchOptions = launchOptions

    return true
  }

  // MARK: - UIScene lifecycle

  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    // The name must match `UISceneConfigurationName` in Info.plist, which is what
    // names `SceneDelegate` as the delegate class. A mismatch gives you a scene with
    // no delegate, i.e. a blank white app.
    UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
