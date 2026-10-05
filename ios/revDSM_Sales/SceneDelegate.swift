import UIKit
import React_RCTAppDelegate

/**
 * The UIScene half of launch: this is where the window is created and React Native
 * is mounted into it.
 *
 * WARNING This class is NOT optional and must not be "simplified" back into
 * AppDelegate. An app built against the iOS 26+ SDK that does not adopt the UIScene
 * lifecycle is killed by UIKit at launch on iOS 27, inside
 * `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, before a single
 * line of our code (or of React Native) runs — an EXC_BREAKPOINT about 90ms after
 * launch, every single time. On iOS 26 the very same check is named
 * `_UIApplicationLogRuntimeIssueIfNeededForNoSceneLifecycleAdoption` and only logs a
 * warning, which is why this was invisible until one tester updated to iOS 27 while
 * everyone else stayed on 26. It is an OS-version trap, not a device-specific one.
 *
 * WARNING React Native 0.84 ships no UIScene support whatsoever (there is not one
 * `UISceneDelegate` in the whole package), so none of this comes from the RN
 * template — it is ours to maintain. `RCTReactNativeFactory` only needs a window to
 * mount into, and it calls `makeKeyAndVisible` itself.
 *
 * The factory is built in `AppDelegate.application(_:didFinishLaunchingWithOptions:)`
 * because Firebase and Google Maps must be configured before anything touches them,
 * and that runs before any scene exists. The scene arrives afterwards and borrows it.
 */
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory
    else {
      return
    }

    // The window has to be bound to the scene. `UIWindow(frame:)` produces a window
    // attached to no scene, which on iOS 27 renders nothing at all.
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    // Mirror it onto the app delegate - see the warning on `AppDelegate.window`.
    appDelegate.window = window

    factory.startReactNative(
      withModuleName: "revDSM_Sales",
      in: window,
      launchOptions: appDelegate.launchOptions
    )
  }
}
