$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$environmentPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $environmentPath)) {
    throw "O arquivo backend\.env não existe. Execute primeiro .\configurar.ps1."
}

function Convert-SecureString {
    param([System.Security.SecureString]$Value)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $Value.Dispose()
    }
}

$token = $null
$webhookSecret = $null
$tokenSecure = Read-Host "Token TEST- de acesso do Mercado Pago" -AsSecureString
$secretSecure = Read-Host "Segredo de assinatura do webhook" -AsSecureString
$publicUrl = Read-Host "URL HTTPS pública que encaminha para este NEXA (túnel ou domínio)"

try {
    $token = Convert-SecureString $tokenSecure
    $webhookSecret = Convert-SecureString $secretSecure

    if (-not $token.StartsWith("TEST-", [StringComparison]::Ordinal)) {
        throw "Para este ambiente local, use uma credencial de teste iniciada por TEST-."
    }
    if ($webhookSecret.Length -lt 16) {
        throw "O segredo do webhook parece curto demais."
    }

    $uri = $null
    if (-not [Uri]::TryCreate($publicUrl, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -ne "https" -or $uri.IsLoopback) {
        throw "Informe uma URL HTTPS pública; localhost não consegue receber webhooks do Mercado Pago."
    }
    $baseUrl = $uri.GetLeftPart([UriPartial]::Authority).TrimEnd("/")

    $keys = @{
        "MP_ACCESS_TOKEN" = $token
        "MP_WEBHOOK_SECRET" = $webhookSecret
        "APP_BASE_URL" = $baseUrl
    }
    $lines = [System.Collections.Generic.List[string]]::new()
    $found = @{}
    foreach ($line in [System.IO.File]::ReadAllLines($environmentPath)) {
        $replaced = $false
        foreach ($key in $keys.Keys) {
            if ($line.StartsWith("$key=", [StringComparison]::Ordinal)) {
                $lines.Add("$key=$($keys[$key])")
                $found[$key] = $true
                $replaced = $true
                break
            }
        }
        if (-not $replaced) {
            $lines.Add($line)
        }
    }
    foreach ($key in $keys.Keys) {
        if (-not $found.ContainsKey($key)) {
            $lines.Add("$key=$($keys[$key])")
        }
    }

    $encoding = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllLines($environmentPath, $lines, $encoding)

    Write-Output "Credenciais de teste e URL do webhook salvas em backend\.env sem exibi-las."
    Write-Output "No painel do Mercado Pago, configure notificações de pagamento para:"
    Write-Output "$baseUrl/api/payments/webhook"
    Write-Output "Reinicie o NEXA para carregar a configuração."
} finally {
    $token = $null
    $webhookSecret = $null
}
