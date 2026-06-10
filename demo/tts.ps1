param([string]$Project = "grailwatch")
Add-Type -AssemblyName System.Speech
$json = Get-Content -Raw -Path (Join-Path $PSScriptRoot "narration.json") | ConvertFrom-Json
$scenes = $json.$Project
$outDir = Join-Path $PSScriptRoot "out\vo\$Project"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
# prefer a clearer female voice if present, else default
try {
  $voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name }
  $pref = $voices | Where-Object { $_ -match "Zira|Aria|Jenny|Hazel" } | Select-Object -First 1
  if ($pref) { $synth.SelectVoice($pref) }
  Write-Output ("voice: " + $synth.Voice.Name)
} catch {}
$synth.Rate = -1     # slightly slower for clarity
$synth.Volume = 100

foreach ($s in $scenes) {
  $wav = Join-Path $outDir ($s.id + ".wav")
  $synth.SetOutputToWaveFile($wav)
  $synth.Speak($s.text)
  $synth.SetOutputToNull()
  Write-Output ("wrote " + $wav)
}
$synth.Dispose()
Write-Output "TTS DONE for $Project"
