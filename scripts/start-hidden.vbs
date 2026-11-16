Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "D:\抖音auto"
sh.Run """D:\NEWhongtu\.devtools\node-v22.23.4-win-x64\node.exe"" ""D:\抖音auto\scripts\run-electron.js""", 0, False
