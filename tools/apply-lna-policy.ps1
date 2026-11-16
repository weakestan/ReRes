# ReRes · Chrome LNA（本地网络访问）策略助手
# ------------------------------------------------------------------
# Chrome 142 起，公网页面请求本机/内网地址会被 LNA 强制拦截。
# 本脚本把「发起页面的来源」写入用户级 Chrome 策略，无需管理员权限。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\apply-lna-policy.ps1 -Origin https://dev.example.com
#   powershell -ExecutionPolicy Bypass -File tools\apply-lna-policy.ps1 -Origin https://dev.example.com -Remove
#   powershell -ExecutionPolicy Bypass -File tools\apply-lna-policy.ps1 -List
#
# 说明：
#   * 策略写在 HKCU\Software\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls
#   * 只对 https 页面够用；http 页面还需要启动参数
#     --unsafely-treat-insecure-origin-as-secure=<来源>
#   * 最省事的替代方案：启动参数 --disable-features=LocalNetworkAccessChecks
#     （http / https 页面都有效，已实测 Chrome 155）
#   * 修改后必须完全退出 Chrome（含后台进程）再启动才会生效

param(
    [string]$Origin,
    [switch]$Remove,
    [switch]$List
)

$ErrorActionPreference = 'Stop'
$keyPath = 'HKCU:\Software\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls'

function Get-NormalizedOrigin([string]$raw) {
    if ([string]::IsNullOrWhiteSpace($raw)) {
        throw '缺少 -Origin，例如 https://dev.example.com'
    }
    $text = $raw.Trim()
    if ($text -notmatch '^[a-z][a-z0-9+.-]*://') {
        $text = 'http://' + $text
    }
    $uri = $null
    if (-not [Uri]::TryCreate($text, [UriKind]::Absolute, [ref]$uri)) {
        throw "无法解析的地址：$raw"
    }
    if ($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https') {
        throw '只支持 http:// 或 https:// 来源'
    }
    return $uri.GetLeftPart([UriPartial]::Authority)
}

function Get-PolicyValues {
    if (-not (Test-Path $keyPath)) {
        return @()
    }
    return @((Get-ItemProperty -Path $keyPath).PSObject.Properties |
        Where-Object { $_.Name -notmatch '^PS' })
}

try {
    if ($List) {
        $values = Get-PolicyValues
        if ($values.Count -eq 0) {
            Write-Host '当前没有配置 LNA 白名单。'
            exit 0
        }
        Write-Host '当前 LNA 白名单：'
        $values | ForEach-Object { Write-Host ("  {0} = {1}" -f $_.Name, $_.Value) }
        exit 0
    }

    $origin = Get-NormalizedOrigin $Origin
    $values = Get-PolicyValues

    if ($Remove) {
        $removed = $false
        foreach ($item in $values) {
            if ([string]$item.Value -eq $origin) {
                Remove-ItemProperty -Path $keyPath -Name $item.Name
                $removed = $true
            }
        }
        if ((Get-PolicyValues).Count -eq 0 -and (Test-Path $keyPath)) {
            Remove-Item -Path $keyPath -Force
        }
        if ($removed) {
            Write-Host "已从 LNA 白名单移除：$origin"
        } else {
            Write-Host "白名单里没有：$origin"
        }
        Write-Host '请完全退出 Chrome（含后台进程）后重新启动。'
        exit 0
    }

    New-Item -Path $keyPath -Force | Out-Null
    $values = Get-PolicyValues
    $exists = $false
    $maxIndex = 0
    foreach ($item in $values) {
        if ([string]$item.Value -eq $origin) {
            $exists = $true
        }
        if ($item.Name -match '^\d+$') {
            $index = [int]$item.Name
            if ($index -gt $maxIndex) {
                $maxIndex = $index
            }
        }
    }

    if ($exists) {
        Write-Host "白名单里已有：$origin"
    } else {
        New-ItemProperty -Path $keyPath -Name ([string]($maxIndex + 1)) `
            -PropertyType String -Value $origin -Force | Out-Null
        Write-Host "已加入 LNA 白名单：$origin"
    }

    Write-Host ''
    Write-Host '接下来：完全退出 Chrome（含后台进程）再启动。'
    if ($origin -like 'http://*') {
        Write-Host '提示：发起页是 http://，只配策略仍会被硬拦截，还需要加启动参数：'
        Write-Host ('  --unsafely-treat-insecure-origin-as-secure=' + $origin)
    }
    Write-Host '更省事的方案：不配策略，直接给 Chrome 加启动参数 --disable-features=LocalNetworkAccessChecks'
} catch {
    Write-Host ('失败：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
