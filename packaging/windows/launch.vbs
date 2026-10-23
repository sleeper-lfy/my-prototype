Option Explicit
Dim shell, files, root, command, arg, result, mode, environment, logPath, i
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
Set environment = shell.Environment("PROCESS")
If environment("STUDIO_DATA_DIR") <> "" Then
  logPath = environment("STUDIO_DATA_DIR") & "\.desktop-runtime\launcher.log"
ElseIf environment("STUDIO_DESKTOP_HOME") <> "" Then
  logPath = environment("STUDIO_DESKTOP_HOME") & "\runtime\launcher.log"
Else
  logPath = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\GameUIStudio\runtime\launcher.log")
End If
root = files.GetParentFolderName(WScript.ScriptFullName)
mode = ""
For i = 0 To WScript.Arguments.Count - 1
  arg = WScript.Arguments(i)
  If arg = "--stop" Or arg = "--no-open" Then
    mode = mode & " " & arg
  Else
    MsgBox "Unsupported Game UI Studio launch option.", 16, "Game UI Studio"
    WScript.Quit 1
  End If
Next
If Not files.FileExists(root & "\node.exe") Or Not files.FileExists(root & "\app\scripts\desktop-launcher.mjs") Then
  MsgBox "The installation is incomplete. Please run the Game UI Studio installer again.", 16, "Game UI Studio"
  WScript.Quit 1
End If
command = Chr(34) & root & "\node.exe" & Chr(34) & " " & Chr(34) & root & "\app\scripts\desktop-launcher.mjs" & Chr(34) & mode
On Error Resume Next
result = shell.Run(command, 0, True)
If Err.Number <> 0 Then
  MsgBox "Could not launch Game UI Studio: " & Err.Description, 16, "Game UI Studio"
  WScript.Quit 1
End If
On Error GoTo 0
If result <> 0 Then
  MsgBox "Game UI Studio could not complete the request. Check this log location:" & vbCrLf & logPath, 16, "Game UI Studio"
End If
WScript.Quit result
