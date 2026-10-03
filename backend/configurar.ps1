$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (Test-Path ".env") {
    throw "O arquivo .env já existe. Para protegê-lo, este configurador não o substituirá."
}

$passwordSecure = Read-Host "Digite a senha do usuário postgres definida na instalação" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure)
$password = $null

try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $encodedPassword = [Uri]::EscapeDataString($password)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    $passwordSecure.Dispose()
}

$adminEmail = Read-Host "Digite o e-mail que você usará na conta moderadora"
if ($adminEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
    $password = $null
    throw "Informe um endereço de e-mail válido para a conta moderadora."
}

$secretBytes = New-Object byte[] 32
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $random.GetBytes($secretBytes)
} finally {
    $random.Dispose()
}
$jwtSecret = -join ($secretBytes | ForEach-Object { $_.ToString("x2") })
[Array]::Clear($secretBytes, 0, $secretBytes.Length)

$environment = @(
    "NODE_ENV=development"
    "PORT=3000"
    "DATABASE_URL=postgres://postgres:$encodedPassword@localhost:5432/nexa"
    "JWT_SECRET=$jwtSecret"
    "MP_ACCESS_TOKEN="
    "MP_WEBHOOK_SECRET="
    "APP_BASE_URL=http://localhost:3000"
    "ADMIN_EMAILS=$($adminEmail.Trim().ToLowerInvariant())"
)
$utf8WithoutBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllLines(
    (Join-Path $PSScriptRoot ".env"),
    $environment,
    $utf8WithoutBom
)
$password = $null
$encodedPassword = $null
$jwtSecret = $null

Write-Output "Configuração local criada. Aplicando as tabelas do NEXA..."
npm run db:migrate
if ($LASTEXITCODE -ne 0) {
    throw "A migração falhou. O arquivo backend\.env foi preservado; confira se a senha está correta e se o banco nexa existe."
}

Write-Output ""
Write-Output "Banco do NEXA configurado com sucesso."
Write-Output "Para iniciar o site, execute: npm run dev"
Write-Output "Depois, abra: http://localhost:3000"
