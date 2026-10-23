import AVFoundation
import ExpoModulesCore

// Camera capture set up the way InPulse's CameraDeviceManager does it (from its shipped binary):
// back wide-angle camera, AVCaptureSessionPresetLow, 30 fps active format, continuous auto-exposure,
// video HDR off, BGRA frames and the torch at AVCaptureMaxAvailableTorchLevel. Each frame is reduced
// here to the numbers the JS engine needs, so no pixels cross the bridge.
public class PulseCameraModule: Module {
  private var camera: PulseCamera?

  public func definition() -> ModuleDefinition {
    Name("PulseCamera")
    Events("onSample")

    AsyncFunction("start") { (fps: Int) in
      let cam = PulseCamera(fps: fps) { [weak self] sample in
        self?.sendEvent("onSample", sample)
      }
      try cam.start()
      self.camera = cam
    }

    AsyncFunction("stop") {
      self.camera?.stop()
      self.camera = nil
    }
  }
}

final class PulseCamera: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  private let session = AVCaptureSession()
  private let queue = DispatchQueue(label: "pulse.camera.frames")
  private let fps: Int
  private let emit: ([String: Any]) -> Void
  private var device: AVCaptureDevice?
  // InPulse's adaptive threshold on the HSV value: nudged by 1 per frame to keep 40-60% of pixels above it.
  private var threshold = 170.0

  init(fps: Int, emit: @escaping ([String: Any]) -> Void) {
    self.fps = fps
    self.emit = emit
  }

  func start() throws {
    guard let d = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
      throw Exception(name: "NoCamera", description: "Back wide-angle camera not found")
    }
    device = d
    session.beginConfiguration()
    let input = try AVCaptureDeviceInput(device: d)
    if session.canAddInput(input) { session.addInput(input) }
    session.sessionPreset = .low

    try d.lockForConfiguration()
    // The smallest format that still runs at the requested rate, as InPulse's format pick does.
    let formats = d.formats.filter { f in
      f.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= Double(fps) && $0.minFrameRate <= Double(fps) }
    }
    if let f = formats.min(by: { a, b in
      let da = CMVideoFormatDescriptionGetDimensions(a.formatDescription)
      let db = CMVideoFormatDescriptionGetDimensions(b.formatDescription)
      return Int(da.width) * Int(da.height) < Int(db.width) * Int(db.height)
    }) {
      d.activeFormat = f
    }
    d.activeVideoMinFrameDuration = CMTimeMake(value: 1, timescale: Int32(fps))
    d.activeVideoMaxFrameDuration = CMTimeMake(value: 1, timescale: Int32(fps))
    if d.isExposureModeSupported(.continuousAutoExposure) { d.exposureMode = .continuousAutoExposure }
    if d.activeFormat.isVideoHDRSupported {
      d.automaticallyAdjustsVideoHDREnabled = false
      d.isVideoHDREnabled = false
    }
    d.unlockForConfiguration()

    let output = AVCaptureVideoDataOutput()
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(self, queue: queue)
    if session.canAddOutput(output) { session.addOutput(output) }
    session.commitConfiguration()

    queue.async {
      self.session.startRunning()
      self.setTorch(on: true)
    }
  }

  func stop() {
    queue.async {
      self.setTorch(on: false)
      self.session.stopRunning()
    }
  }

  private func setTorch(on: Bool) {
    guard let d = device, d.hasTorch, d.isTorchAvailable else { return }
    do {
      try d.lockForConfiguration()
      if on {
        try d.setTorchModeOn(level: AVCaptureDevice.maxAvailableTorchLevel)
      } else {
        d.torchMode = .off
      }
      d.unlockForConfiguration()
    } catch {}
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let px = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    CVPixelBufferLockBaseAddress(px, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(px, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(px) else { return }
    let w = CVPixelBufferGetWidth(px)
    let h = CVPixelBufferGetHeight(px)
    let stride = CVPixelBufferGetBytesPerRow(px)
    let buf = base.assumingMemoryBound(to: UInt8.self)

    let thr = threshold
    var sr = 0, sg = 0, sb = 0, all = 0, clipped = 0, above = 0
    for y in 0..<h {
      let row = buf + y * stride
      for x in 0..<w {
        let p = row + x * 4
        let b = Int(p[0]), g = Int(p[1]), r = Int(p[2])
        sr += r; sg += g; sb += b
        all += 1
        if r >= 250 || g >= 250 { clipped += 1 }
        if Double(max(r, g, b)) > thr { above += 1 }
      }
    }
    guard all > 0 else { return }
    let v = Double(above) / Double(all)
    threshold = min(230, max(100, thr + (v > 0.6 ? 1 : v < 0.4 ? -1 : 0)))
    let t = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
    let n = Double(all)
    emit([
      "t": t,
      "r": Double(sr) / n,
      "g": Double(sg) / n,
      "b": Double(sb) / n,
      "clip": Double(clipped) / n,
      "v": v,
      "thr": thr,
      "w": w,
      "h": h,
    ])
  }
}
