import UIKit
import Capacitor
import AVFoundation
import WebKit

class FinderSeekViewController: CAPBridgeViewController, WKScriptMessageHandler {

    override func capacitorDidLoad() {
        bridge?.webView?.configuration.userContentController.add(
            self, name: "fsRequestCameraPermission"
        )
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "fsRequestCameraPermission" else { return }

        let current = AVCaptureDevice.authorizationStatus(for: .video)

        if current == .notDetermined {
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    let status = granted ? "granted" : "denied"
                    self.bridge?.webView?.evaluateJavaScript(
                        "if(window._fsCamResolve) window._fsCamResolve('\(status)');"
                    )
                }
            }
        } else {
            let status = (current == .authorized) ? "granted" : "denied"
            bridge?.webView?.evaluateJavaScript(
                "if(window._fsCamResolve) window._fsCamResolve('\(status)');"
            )
        }
    }
}
