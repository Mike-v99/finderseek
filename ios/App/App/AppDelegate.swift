import UIKit
import Capacitor
import AVFoundation
import WebKit

private class CamPermHandler: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?

    func userContentController(
        _ ucc: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "fsRequestCameraPermission" else { return }
        let current = AVCaptureDevice.authorizationStatus(for: .video)
        if current == .notDetermined {
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    let s = granted ? "granted" : "denied"
                    self.webView?.evaluateJavaScript(
                        "if(window._fsCamResolve) window._fsCamResolve('\(s)');"
                    )
                }
            }
        } else {
            let s = (current == .authorized) ? "granted" : "denied"
            webView?.evaluateJavaScript(
                "if(window._fsCamResolve) window._fsCamResolve('\(s)');"
            )
        }
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private let camHandler = CamPermHandler()
    private var handlerInstalled = false

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
            self.installCameraHandler()
        }
        return true
    }

    private func installCameraHandler() {
        if handlerInstalled { return }
        guard let vc = window?.rootViewController as? CAPBridgeViewController,
              let webView = vc.webView else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                self.installCameraHandler()
            }
            return
        }
        handlerInstalled = true
        camHandler.webView = webView
        webView.configuration.userContentController.add(
            camHandler, name: "fsRequestCameraPermission"
        )
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
