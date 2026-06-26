param([string]$vk)
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class K{[DllImport("user32.dll")]public static extern void keybd_event(byte b,byte s,uint f,UIntPtr e);}'
$key = [Convert]::ToByte($vk, 16)
[K]::keybd_event($key, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
[K]::keybd_event($key, 0, 2, [UIntPtr]::Zero)
