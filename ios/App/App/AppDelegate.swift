import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var polling = false

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
            self.startPolling()
        }
        return true
    }

    private func startPolling() {
        if polling { return }
        polling = true
        pollForCameraRequest()
    }

    private func findBridgeVC() -> CAPBridgeViewController? {
        var rootVC = window?.rootViewController
        // Unwrap if nested inside UINavigationController
        if let navVC = rootVC as? UINavigationController {
            rootVC = navVC.viewControllers.first
        }
        // Unwrap if nested inside UITabBarController
        if let tabVC = rootVC as? UITabBarController {
            rootVC = tabVC.selectedViewController
        }
        // Try direct cast, or search children
        if let capVC = rootVC as? CAPBridgeViewController {
            return capVC
        }
        // Search one level of children
        for child in rootVC?.children ?? [] {
            if let capVC = child as? CAPBridgeViewController {
                return capVC
            }
        }
        return nil
    }

    private func pollForCameraRequest() {
        guard let vc = findBridgeVC(),
              let webView = vc.webView else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                self.pollForCameraRequest()
            }
            return
        }

        webView.evaluateJavaScript("window._fsNeedCamPerm === true") { [weak self] result, _ in
            guard let self = self else { return }

            if let needs = result as? Bool, needs {
                webView.evaluateJavaScript("window._fsNeedCamPerm = false")

                let current = AVCaptureDevice.authorizationStatus(for: .video)
                if current == .notDetermined {
                    AVCaptureDevice.requestAccess(for: .video) { granted in
                        DispatchQueue.main.async {
                            let s = granted ? "granted" : "denied"
                            webView.evaluateJavaScript(
                                "if(window._fsCamResolve) window._fsCamResolve('\(s)');"
                            )
                        }
                    }
                } else {
                    DispatchQueue.main.async {
                        let s = (current == .authorized) ? "granted" : "denied"
                        webView.evaluateJavaScript(
                            "if(window._fsCamResolve) window._fsCamResolve('\(s)');"
                        )
                    }
                }
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                self.pollForCameraRequest()
            }
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationDidBecomeActive(_ application: UIApplication) {}
    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}
