#Requires AutoHotkey v2.0
#SingleInstance Force
InstallKeybdHook()
InstallMouseHook()

; --- THE GURU'S LAST STAND ---
MsgBox("RELOADED. This version watches EVERYTHING silent.`n`nIf this doesn't catch it, we'll try a different sensing method.", "mac_swivel")

g := Gui("+AlwaysOnTop", "Gesture RAW Spy")
log := g.Add("Edit", "r20 w400 ReadOnly")
g.Show()

LogEvent(msg) {
    try {
        log.Value := FormatTime(, "HH:mm:ss") . ": " . msg . "`n" . log.Value
    }
}

; Check for Task View activity every 100ms
SetTimer(CheckTaskView, 100)
lastActive := ""

CheckTaskView() {
    global lastActive
    curr := WinGetClass("A")
    if (curr != lastActive) {
        LogEvent("WINDOW CHANGE: " . curr)
        lastActive := curr
    }
}

; Low-level hook to catch ALL Win key combinations
~*LWin::LogEvent("LWin Down")
~*LWin Up::LogEvent("LWin Up")
~*d::LogEvent("D Key Pressed")
~*Tab::LogEvent("Tab Key Pressed")

; Catch Show Desktop (Win+D) specifically
$#d::
{
    LogEvent("INTERCEPTED Win+D!")
    if WinActive("ahk_class XamlExplorerHostIslandWindow") 
       or WinActive("ahk_class MultitaskingViewHost")
    {
        LogEvent("MODE: Task View -> Clicking!")
        Click
        return
    }
    Send("#d")
}

; Catch Task View (Win+Tab)
~#Tab::LogEvent("Win+Tab triggered")

; Also monitor for sudden mouse moves (some trackpads simulate mouse)
SetTimer(CheckMouseVel, 50)
lastY := 0
CheckMouseVel() {
    global lastY
    MouseGetPos(, &y)
    diff := y - lastY
    if (Abs(diff) > 100) {
        LogEvent("SUDDEN MOUSE MOVE: " . diff)
    }
    lastY := y
}
