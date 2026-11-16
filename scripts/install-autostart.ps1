# 把采集台注册到开机启动（当前用户，无需管理员）
$ErrorActionPreference = 'Stop'
$root = 'D:\抖音auto'
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup '抖音采集台.lnk'

$vbs = Join-Path $root 'scripts\start-hidden.vbs'
$node = (Get-Command node).Source

@"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$root"
sh.Run """$node"" ""$root\scripts\run-electron.js""", 0, False
"@ | Set-Content -Path $vbs -Encoding Default

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = 'wscript.exe'
$s.Arguments = '"' + $vbs + '"'
$s.WorkingDirectory = $root
$s.Description = '抖音拟人化采集台'
$s.WindowStyle = 7
$s.Save()

"已创建开机启动项: $lnk"
Test-Path $lnk
