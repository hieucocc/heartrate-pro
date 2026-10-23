Pod::Spec.new do |s|
  s.name           = 'PulseCamera'
  s.version        = '1.0.0'
  s.summary        = 'InPulse-style PPG camera capture (preset Low, torch max, continuous auto-exposure).'
  s.author         = 'hieucocc'
  s.homepage       = 'https://github.com/hieucocc/heartrate-pro'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
