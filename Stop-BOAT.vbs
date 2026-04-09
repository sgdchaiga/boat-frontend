Option Explicit
Dim shell, fso, repoPath, batPath, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

repoPath = "C:\projects\BOAT"
batPath = repoPath & "\Stop-BOAT.bat"

If Not fso.FileExists(batPath) Then
  MsgBox "Stop script not found:" & vbCrLf & batPath, vbCritical, "BOAT Stop Error"
  WScript.Quit 1
End If

cmd = "cmd.exe /c cd /d """ & repoPath & """ && Stop-BOAT.bat"
shell.Run cmd, 0, False

MsgBox "BOAT stop requested." & vbCrLf & _
       "The system services are being stopped now.", vbInformation, "BOAT"
