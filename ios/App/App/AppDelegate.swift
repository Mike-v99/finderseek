import Foundation
import Capacitor
import AVFoundation

/// Minimal Capacitor plugin that explicitly triggers the iOS camera permission
/// prompt via AVCaptureDevice. The built-in Capacitor Camera plugin uses
/// UIImagePickerController, which accesses the camera without triggering the
/// system "Allow Camera?" dialog — so iOS never shows the prompt and Apple
/// Review flags the missing permission flow.
///
/// USAGE FROM JS:
///   const { CameraPermission } = window.Capacitor.Plugins;
///   const result = await CameraPermission.request();
///   // result.status is 'granted' | 'denied' | 'prompt'
///
/// DROP THIS FILE into ios/App/App/ in Xcode (same folder as AppDelegate.swift).
/// No Podfile changes needed — it uses only system frameworks.

@objc(CameraPermissionPlugin)
public class CameraPermissionPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "CameraPermissionPlugin"
    public let jsName = "CameraPermission"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "check", returnType: CAPPluginReturnPromise)
    ]

    /// Check current camera authorization status without prompting
    @objc func check(_ call: CAPPluginCall) {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        call.resolve(["status": self.statusString(status)])
    }

    /// Request camera access — triggers the iOS permission dialog if status
    /// is .notDetermined.  If already decided, resolves immediately.
    @objc func request(_ call: CAPPluginCall) {
        let current = AVCaptureDevice.authorizationStatus(for: .video)

        if current == .notDetermined {
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    call.resolve(["status": granted ? "granted" : "denied"])
                }
            }
        } else {
            call.resolve(["status": self.statusString(current)])
        }
    }

    private func statusString(_ status: AVAuthorizationStatus) -> String {
        switch status {
        case .authorized:            return "granted"
        case .denied, .restricted:   return "denied"
        case .notDetermined:         return "prompt"
        @unknown default:            return "prompt"
        }
    }
}

