# OneDrive 밖에 .next 캐시를 두고 프로덕션 모드로 실행 (로컬 테스트용)
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$CacheDir = Join-Path $env:LOCALAPPDATA "playai-next-cache"
$LinkPath = Join-Path $Root ".next"

Set-Location $Root

New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null

if (Test-Path $LinkPath) {
  $item = Get-Item $LinkPath -Force -ErrorAction SilentlyContinue
  if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    cmd /c rmdir "$LinkPath" 2>$null
  } else {
    cmd /c rmdir /s /q "$LinkPath" 2>$null
  }
}

if (-not (Test-Path $LinkPath)) {
  New-Item -ItemType Junction -Path $LinkPath -Target $CacheDir | Out-Null
  Write-Host "캐시 연결: $CacheDir" -ForegroundColor DarkGray
} else {
  Write-Host ".next 폴더를 교체하지 못했습니다. 기존 캐시로 진행합니다." -ForegroundColor Yellow
}

Write-Host "프로덕션 빌드 중… (최초 1회는 1~3분 걸릴 수 있습니다)" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "서버 시작: http://localhost:3000" -ForegroundColor Green
Write-Host "Chrome/Edge에서 여는 것을 권장합니다 (Cursor 내장 브라우저보다 빠름)." -ForegroundColor Yellow
Write-Host "종료: Ctrl+C" -ForegroundColor DarkGray
Write-Host ""

npm run start
