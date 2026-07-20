# Watches for the Windows Security / Windows Hello credential dialog (the
# "Making sure it's you" face prompt used for passkeys, e.g. Google sign-in) and
# for the Windows Hello facial-recognition setup/enrollment window. Emits
# FACE:START when such a window appears and FACE:STOP when it goes away, so the
# notch can play its Face ID scan -> checkmark animation. These dialogs live on
# the normal desktop (unlike UAC's secure desktop), so we can detect + overlay.
$ErrorActionPreference = 'SilentlyContinue'

try {
  Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class HelloWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int max);
}
"@
} catch { exit }

function Test-HelloPresent {
  $script:helloFound = $false
  $cb = [HelloWin+EnumProc]{
    param($h, $l)
    if ([HelloWin]::IsWindowVisible($h)) {
      $cn = New-Object System.Text.StringBuilder 256
      [HelloWin]::GetClassName($h, $cn, 256) | Out-Null
      # The Windows Security / Windows Hello credential dialog.
      if ($cn.ToString() -eq 'Credential Dialog Xaml Host') { $script:helloFound = $true; return $false }
      $tn = New-Object System.Text.StringBuilder 512
      [HelloWin]::GetWindowText($h, $tn, 512) | Out-Null
      # The Hello facial-recognition setup / "improve recognition" window.
      if ($tn.ToString() -match 'Windows Hello|facial recognition') { $script:helloFound = $true; return $false }
    }
    return $true
  }
  [HelloWin]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
  return $script:helloFound
}

$was = $false
while ($true) {
  $now = Test-HelloPresent
  if ($now -and -not $was) { Write-Output 'FACE:START'; [Console]::Out.Flush() }
  elseif (-not $now -and $was) { Write-Output 'FACE:STOP'; [Console]::Out.Flush() }
  $was = $now
  Start-Sleep -Milliseconds 350
}
