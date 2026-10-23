Pod::Spec.new do |s|
  s.name           = 'CameraLock'
  s.version        = '1.0.0'
  s.summary        = 'Locks exposure, white balance and focus of the back wide camera for PPG.'
  s.author         = 'hieucocc'
  s.homepage       = 'https://github.com/hieucocc/heartrate-pro'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
