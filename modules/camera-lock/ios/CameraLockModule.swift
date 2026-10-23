import AVFoundation
import ExpoModulesCore

// Auto-exposure follows the brightness change of every heartbeat and flattens the pulse, so once the
// torch-lit finger has settled we freeze exposure, white balance and focus on the shared camera device.
public class CameraLockModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CameraLock")

    AsyncFunction("setLocked") { (locked: Bool) -> [String: Double] in
      guard let d = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
        throw Exception(name: "NoCamera", description: "Back wide-angle camera not found")
      }
      try d.lockForConfiguration()
      defer { d.unlockForConfiguration() }
      if locked {
        if d.isExposureModeSupported(.locked) { d.exposureMode = .locked }
        if d.isWhiteBalanceModeSupported(.locked) { d.whiteBalanceMode = .locked }
        if d.isFocusModeSupported(.locked) { d.focusMode = .locked }
      } else {
        if d.isExposureModeSupported(.continuousAutoExposure) { d.exposureMode = .continuousAutoExposure }
        if d.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { d.whiteBalanceMode = .continuousAutoWhiteBalance }
        if d.isFocusModeSupported(.continuousAutoFocus) { d.focusMode = .continuousAutoFocus }
      }
      return ["iso": Double(d.iso), "duration": d.exposureDuration.seconds]
    }
  }
}
