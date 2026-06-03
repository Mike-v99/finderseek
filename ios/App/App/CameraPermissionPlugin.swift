import Foundation
import Capacitor
import AVFoundation

@objc(CameraPermissionPlugin)
public class CameraPermissionPlugin: CAPPlugin {

    /// Check current camera authorization status without prompting
    @objc func check(_ call: CAPPluginCall) {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        call.resolve(["status": statusString(status)])
    }

    /// Request camera access — triggers the iOS permission dialog if status
    /// is .notDetermined. If already decided, resolves immediately.
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
