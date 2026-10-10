# PREPARATION HELPER. Not run by Codex. Execute only after reviewing the deployment.
# Generates secrets locally without printing values. Does not run Docker or PostgreSQL.
$ErrorActionPreference = 'Stop'
$taskSecrets = Join-Path $PSScriptRoot 'secrets'
$taskAdminPath = Join-Path $taskSecrets 'admin-password.txt'
$taskRuntimePath = Join-Path $taskSecrets 'runtime-password.txt'
$taskEnvPath = Join-Path $PSScriptRoot '.env'
foreach ($taskPath in @($taskAdminPath, $taskRuntimePath, $taskEnvPath)) {
    if (Test-Path -LiteralPath $taskPath) { throw 'Local configuration already exists; inspect it instead of overwriting.' }
}
[System.IO.Directory]::CreateDirectory($taskSecrets) | Out-Null
if ($env:OS -eq 'Windows_NT') {
    $taskPrincipal = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $taskAcl = Get-Acl -LiteralPath $taskSecrets
    $taskAcl.SetAccessRuleProtection($true, $false)
    foreach ($taskIdentity in @($taskPrincipal, 'SYSTEM')) {
        $taskRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $taskIdentity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $taskAcl.AddAccessRule($taskRule)
    }
    Set-Acl -LiteralPath $taskSecrets -AclObject $taskAcl
}
function Write-NewTaskFile([string]$taskTarget, [string]$taskContent) {
    $taskStream = [System.IO.File]::Open($taskTarget, [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $taskBytes = [System.Text.Encoding]::UTF8.GetBytes($taskContent)
        $taskStream.Write($taskBytes, 0, $taskBytes.Length)
    } finally { $taskStream.Dispose() }
}
$taskRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    foreach ($taskTarget in @($taskAdminPath, $taskRuntimePath)) {
        $taskBytes = New-Object byte[] 32
        $taskRng.GetBytes($taskBytes)
        $taskPassword = [System.BitConverter]::ToString($taskBytes).Replace('-', '').ToLowerInvariant()
        Write-NewTaskFile $taskTarget $taskPassword
        $taskPassword = $null
        [System.Array]::Clear($taskBytes, 0, $taskBytes.Length)
    }
} finally { $taskRng.Dispose() }
Write-NewTaskFile $taskEnvPath "TICKET_ADMIN_SECRET_FILE=./secrets/admin-password.txt`nTICKET_RUNTIME_SECRET_FILE=./secrets/runtime-password.txt`n"
Write-Output 'Local secret files and path-only .env created. Password values were not printed.'
