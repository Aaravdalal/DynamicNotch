#Requires AutoHotkey v2.0
#SingleInstance Force

myGui := Gui("+AlwaysOnTop", "Gesture Diagnostic")
myGui.SetFont("s10", "Segoe UI")
infoText := myGui.Add("Text", "w300 h100", "Starting...")
myGui.Show()

SetTimer(UpdateInfo, 100)

UpdateInfo() {
    activeClass := WinGetClass("A")
    activeTitle := WinGetTitle("A")
    infoText.Value := "Active Window Class: " . activeClass . "`n" . "Active Title: " . activeTitle . "`n`nMonitoring gestures... (Swipe up/down now)"
}

~#Tab::
{
    LogGesture("Swipe Up Detected (Win+Tab)")
}

~#d::
{
    LogGesture("Swipe Down Detected (Win+D)")
}

LogGesture(msg) {
    ToolTip(msg)
    SetTimer(() => ToolTip(), -2000)
}
