Option Explicit
Dim shell, fso, repoPath, batPath, cmd, rc
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

repoPath = "C:\projects\BOAT"
batPath = repoPath & "\Start-BOAT.bat"

If Not fso.FileExists(batPath) Then
  MsgBox "Start script not found:" & vbCrLf & batPath, vbCritical, "BOAT Start Error"
  WScript.Quit 1
End If

cmd = "cmd.exe /c cd /d """ & repoPath & """ && Start-BOAT.bat"
rc = shell.Run(cmd, 0, True)

If rc = 10 Then
  MsgBox "BOAT is already running." & vbCrLf & _
         "No duplicate start was launched.", vbExclamation, "BOAT"
ElseIf rc = 0 Then
  MsgBox "BOAT start requested." & vbCrLf & _
         "Server and web app are launching now." & vbCrLf & _
         "Browser should open automatically in a few seconds.", vbInformation, "BOAT"
Else
  MsgBox "BOAT start returned exit code " & rc & "." & vbCrLf & _
         "Please check Start-BOAT.bat logs.", vbExclamation, "BOAT Start"
End If
