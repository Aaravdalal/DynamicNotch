#Requires AutoHotkey v2.0
#SingleInstance Force
InstallKeybdHook()
InstallMouseHook()

myGui := Gui("+AlwaysOnTop", "Gesture Spy")
myGui.SetFont("s10", "Segoe UI")
infoText := myGui.Add("Text", "w400 h150", "Waiting for input...")
myGui.Show()

SetTimer(UpdateSpy, 50)

lastKeys := ""

UpdateSpy() {
    activeClass := "Unknown"
    activeTitle := "Unknown"
    try {
        if WinExist("A") {
            activeClass := WinGetClass("A")
            activeTitle := WinGetTitle("A")
        }
    }
    
    mouseWin := "Unknown"
    try {
        MouseGetPos(,, &mWin)
        if mWin
            mouseWin := WinGetClass(mWin)
    }
    
    text := "--- WINDOW INFO ---`n"
    text .= "Active Class: " . activeClass . "`n"
    text .= "Active Title: " . activeTitle . "`n"
    text .= "Under Mouse: " . mouseWin . "`n`n"
    text .= "--- LAST KEY COMBO ---`n"
    text .= lastKeys . "`n`n"
    text .= "(Press any keys or use trackpad gestures)"
    
    infoText.Value := text
}

; Hook every key combo to see what gestures send
~*LWin::global lastKeys := "Win"
~*RWin::global lastKeys := "Win"
~*Tab::global lastKeys .= " + Tab"
~*d::global lastKeys .= " + D"
~*s::global lastKeys .= " + S" ; Some use Win+S or Win+Z
~*Up::global lastKeys .= " + Up"
~*Down::global lastKeys .= " + Down"
~*Left::global lastKeys .= " + Left"
~*Right::global lastKeys .= " + Right"

; Clear on release
~LWin up::global lastKeys := ""
~RWin up::global lastKeys := ""
