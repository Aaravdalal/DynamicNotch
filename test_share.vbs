Set objShell = CreateObject("Shell.Application")
Set objFolder = objShell.NameSpace("c:\Users\aarav\scratch\dynamic-notch")
Set objItem = objFolder.ParseName("package.json")
objItem.InvokeVerb("Share")
WScript.Sleep 5000
