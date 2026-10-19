# Tern for Windows

Windows tray client that maps the Tern WebDAV endpoint to a drive letter.

## Requirements

- Windows 10 / 11 x64
- .NET 8 SDK only for building; the published app is self-contained
- Windows **WebClient** service available
- HTTPS endpoint, for example `https://nas.example.com:8080/Tern`

## Build

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

Outputs:

```text
windows\dist\Tern.exe
windows\Tern-Windows-x64.zip
windows\Tern-Windows-Setup.exe
```

Build the installer with Inno Setup:

```powershell
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" Tern.iss
```

CI builds the same artifact on `windows-latest` in
`.github/workflows/windows-client.yml`.

## Run

1. Extract the zip and run `Tern.exe`.
2. Open the tray icon → **设置**.
3. Enter:
   - server URL: `https://<NAS-IP>:8080/Tern`
   - web username and password
   - drive letter (default `T:`)
4. Click **保存并连接**.
5. `Tern (T:)` appears in **This PC**.

The password is stored in **Windows Credential Manager**, not in
`%LOCALAPPDATA%\Tern\settings.json`.

## Source layout

```text
Program.cs                  entry point / single instance
TrayApplicationContext.cs   tray icon and connection state
SettingsForm.cs             first-run and settings UI
DriveMapper.cs              WNetAddConnection2 drive mapping
CredentialStore.cs          Windows Credential Manager
WebDavProbe.cs              HTTPS WebDAV preflight
ServerUrl.cs                URL normalization
StartupManager.cs           launch at login (HKCU Run)
WindowsWebClient.cs         WebClient / file-size diagnostics
```

See [docs/WINDOWS.md](../docs/WINDOWS.md) for user setup, WebClient service,
large-file registry settings and troubleshooting.
