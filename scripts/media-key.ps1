param([string]$vk)
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class K{[DllImport("user32.dll")]public static extern void keybd_event(byte b,byte s,uint f,UIntPtr e);}'
$key = [Convert]::ToByte($vk, 16)
# 1 = KEYEVENTF_EXTENDEDKEY
[K]::keybd_event($key, 0, 1, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
# 3 = KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP
[K]::keybd_event($key, 0, 3, [UIntPtr]::Zero)
