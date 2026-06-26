#Requires AutoHotkey v2.0
#SingleInstance Force

; The path to our custom Electron Mac Swivel mission control
electronAppPath := "C:\Users\aarav\.gemini\antigravity\scratch\mac-swivel-ui"

SetWorkingDir(electronAppPath)
GroupAdd("ElectronApp", "Mac Mission Control")
if !ProcessExist("electron.exe") and !ProcessExist("node.exe") {
    Run("cmd.exe /c npm start", electronAppPath, "Hide")
}

; Override Win+Tab (3-finger swipe up) to launch our custom Mission Control instead!
$*#Tab::
{
    ; Send the global shortcut registered in Electron (Ctrl+Shift+Alt+M)
    Send("^+!m")
    return
}

#HotIf WinActive("Mac Mission Control")

; 3-finger down (Show Desktop) inside Mission Control shouldn't minimize everything. Let's just act like Escape or Enter.
$#d::
{
    Send("{Enter}")
    return
}

#HotIf
