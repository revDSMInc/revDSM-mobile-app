import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import GoogleMaps
import FirebaseCore

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

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

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "revDSM_Sales",
      in: window,
      launchOptions: launchOptions
    )

    return true
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
