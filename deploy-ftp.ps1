# Sobe o conteudo de client\dist para o FTP da HostGator.
# A senha sera solicitada de forma segura (SecureString).

param(
    [string]$LocalPath = "$PSScriptRoot\client\dist",
    [string]$RemoteHost = "ftp.projetormagcubic.com.br",
    [string]$RemoteUser = "aethelgard@projetormagcubic.online",
    [string]$RemoteDir  = "/",
    [int]$Port = 21
)

$ErrorActionPreference = "Stop"

# Pede a senha de forma segura (ou aceita via -Password / env FTP_PASSWORD)
if (-not $plainPwd) {
    if ($env:FTP_PASSWORD) {
        $plainPwd = $env:FTP_PASSWORD
    } else {
        $cred = Get-Credential -Message "Credenciais FTP para $RemoteUser" -UserName $RemoteUser
        $plainPwd = $cred.GetNetworkCredential().Password
    }
}

Write-Host "[upload] Conectando a ftp://$RemoteUser@$RemoteHost ..." -ForegroundColor Cyan

# Usa WinSCP se disponivel, senao cai no .NET WebClient
$useWinScp = (Get-Command winscp.exe -ErrorAction SilentlyContinue) -ne $null

if ($useWinScp) {
    # Monta script WinSCP
    $script = @"
option batch abort
option confirm off
open ftp://$RemoteUser`:$plainPwd@$RemoteHost`:$Port/
cd $RemoteDir
lcd "$LocalPath"
synchronize remote -criteria=size -delete
exit
"@
    $tmp = New-TemporaryFile
    $scriptPath = "$($tmp.FullName).txt"
    Move-Item -LiteralPath $tmp.FullName -Destination $scriptPath -Force
    Set-Content -LiteralPath $scriptPath -Value $script -Encoding UTF8
    & winscp.exe /script="$scriptPath"
    Remove-Item -LiteralPath $scriptPath -Force
} else {
    # Fallback: .NET WebRequest
    Add-Type -AssemblyName System.Net
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }

    function Ftp-Upload([string]$relPath) {
        $cleanRel = $relPath -replace '\\', '/'
        $cleanRel = $cleanRel.TrimStart('/', '\')
        $url = "ftp://${RemoteHost}:${Port}/$($RemoteDir.TrimStart('/'))/$cleanRel"
        $req = [System.Net.FtpWebRequest]::Create($url)
        $req.Credentials = New-Object System.Net.NetworkCredential($RemoteUser, $plainPwd)
        $req.Method = [System.Net.WebRequestMethods+Ftp]::UploadFile
        $req.UseBinary = $true
        $req.KeepAlive = $false
        $req.UsePassive = $true
        $req.Timeout = 30000
        return $req
    }

    function Ftp-Mkdir([string]$relDir) {
        $cleanRel = $relDir.TrimStart('/', '\').TrimEnd('/') -replace '\\', '/'
        $url = "ftp://${RemoteHost}:${Port}/$($RemoteDir.TrimStart('/'))/$cleanRel/"
        $req = [System.Net.FtpWebRequest]::Create($url)
        $req.Credentials = New-Object System.Net.NetworkCredential($RemoteUser, $plainPwd)
        $req.Method = [System.Net.WebRequestMethods+Ftp]::MakeDirectory
        $req.KeepAlive = $false
        $req.UsePassive = $true
        try {
            $resp = $req.GetResponse()
            $resp.Close()
            return @{ ok = $true; msg = "criado" }
        } catch {
            return @{ ok = $false; msg = $_.Exception.Message }
        }
    }

    # 1) Cria a pasta raiz se nao existir
    Write-Host "[upload] Garantindo pasta remota: $RemoteDir" -ForegroundColor Yellow
    $rootOk = Ftp-Mkdir $RemoteDir.TrimStart('/')
    if ($rootOk.ok) {
        Write-Host "  [mkdir] $($RemoteDir.TrimStart('/')) - $($rootOk.msg)" -ForegroundColor Cyan
    } else {
        Write-Host "  [mkdir-fail] $($RemoteDir.TrimStart('/')) - $($rootOk.msg)" -ForegroundColor Red
    }

    # 2) Cria subpastas e faz upload
    $files = Get-ChildItem -LiteralPath $LocalPath -Recurse -File
    $createdDirs = @{}
    $okCount = 0
    $failCount = 0

    foreach ($file in $files) {
        $rel = $file.FullName.Substring($LocalPath.Length).TrimStart('\', '/') -replace '\\', '/'
        $relDir = Split-Path -Parent $rel
        if ($relDir -and -not $createdDirs.ContainsKey($relDir)) {
            $parts = $relDir -split '/'
            $accum = ""
            foreach ($p in $parts) {
                if ($accum) { $accum = "$accum/$p" } else { $accum = $p }
                if (-not $createdDirs.ContainsKey($accum)) {
                    $r = Ftp-Mkdir $accum
                    if ($r.ok) {
                        Write-Host "  [mkdir] $accum" -ForegroundColor Cyan
                    } else {
                        Write-Host "  [mkdir-fail] $accum - $($r.msg)" -ForegroundColor Red
                    }
                    $createdDirs[$accum] = $true
                }
            }
        }
        try {
            $req = Ftp-Upload $rel
            $ftpStream = $req.GetRequestStream()
            $fileStream = [System.IO.File]::OpenRead($file.FullName)
            $fileStream.CopyTo($ftpStream)
            $fileStream.Close()
            $ftpStream.Close()
            $req.GetResponse().Close()
            Write-Host "  [ok] $rel" -ForegroundColor Green
            $okCount++
        } catch {
            Write-Host "  [fail] $rel - $($_.Exception.Message)" -ForegroundColor Red
            $failCount++
        }
    }

    Write-Host "[upload] Concluido! $okCount ok, $failCount falhas." -ForegroundColor Cyan
}

# Limpa senha da memoria
$plainPwd = $null
[System.GC]::Collect()

Write-Host "[upload] Concluido!" -ForegroundColor Cyan
