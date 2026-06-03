import UIKit
import Capacitor

class FinderSeekViewController: CAPBridgeViewController {

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CameraPermissionPlugin())
    }
}
