# Watches for the Windows Security / Windows Hello credential dialog (the
# "Making sure it's you" face prompt used for passkeys, e.g. Google sign-in) and
# for the Windows Hello facial-recognition setup/enrollment window (the
# "Improve recognition" / initial face setup wizard). Emits FACE:START when
# such a window appears and FACE:STOP when it goes away, so the notch can play
# its Face ID scan -> checkmark animation. These dialogs live on the normal
# desktop (unlike UAC's secure desktop), so we can detect + overlay.
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
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
} catch { exit }

# Matching on window TITLE text is unreliable here: the Settings app's own
# window stays titled "Windows Hello setup" for the entire time the user is
# anywhere on that settings page (not just while actively enrolling), which
# caused false positives, while missing the real capture window at other
# times. The enrollment / "improve recognition" wizard instead runs as its
# own dedicated process, BioEnrollmentHost.exe — matching on process identity
# is exact and doesn't depend on title text at all.
# EnumWindows invokes our callback from a P/Invoke marshaling thread, not the
# normal script thread — cmdlets like Get-Process aren't reliably runnable
# from there (they can silently fail). So the callback only does raw Win32
# calls (safe) and collects candidate process IDs; the actual Get-Process
# lookups happen afterwards, back on the normal thread.
function Test-HelloPresent {
  $script:helloFound = $false
  $script:candidatePids = New-Object 'System.Collections.Generic.List[uint32]'
  $cb = [HelloWin+EnumProc]{
    param($h, $l)
    if ([HelloWin]::IsWindowVisible($h)) {
      $cn = New-Object System.Text.StringBuilder 256
      [HelloWin]::GetClassName($h, $cn, 256) | Out-Null
      # The Windows Security / Windows Hello credential dialog (sign-in / passkey prompt).
      if ($cn.ToString() -eq 'Credential Dialog Xaml Host') { $script:helloFound = $true; return $false }

      $procId = 0
      [HelloWin]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
      if ($procId -ne 0) { $script:candidatePids.Add($procId) }
    }
    return $true
  }
  [HelloWin]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
  if ($script:helloFound) { return $true }

  # The Hello facial-recognition setup / "improve recognition" wizard.
  foreach ($procId in ($script:candidatePids | Select-Object -Unique)) {
    try {
      $proc = Get-Process -Id $procId -ErrorAction Stop
      if ($proc.ProcessName -eq 'BioEnrollmentHost') { return $true }
    } catch {}
  }
  return $false
}

$was = $false
while ($true) {
  $now = Test-HelloPresent
  if ($now -and -not $was) { Write-Output 'FACE:START'; [Console]::Out.Flush() }
  elseif (-not $now -and $was) { Write-Output 'FACE:STOP'; [Console]::Out.Flush() }
  $was = $now
  Start-Sleep -Milliseconds 350
}
