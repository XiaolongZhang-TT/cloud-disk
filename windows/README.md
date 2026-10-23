# Tern for Windows

Windows tray client built on the **Windows Cloud Files API**. Finder-style
on-demand files appear in Explorer; optional `T:` drive letter via `subst`.

## Requirements

- Windows 10 1709+ / Windows 11 x64
- Local NTFS folder for the sync root (default `%USERPROFILE%\Tern`)
- .NET 8 SDK only for building; the published app is self-contained
- No WebClient / WebDAV setup required

## Build

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

Outputs `windows\dist\Tern.exe`; install Inno Setup 6 for the installer.
CI builds the same artifacts on `windows-latest`.

## Run

1. Extract the zip and run `Tern.exe`.
2. Tray icon → **设置**.
3. Enter server URL, username and password.
4. Choose the sync folder (default `%USERPROFILE%\Tern`) and optional drive letter.
5. Click **保存并启用**.
6. **Tern** appears in Explorer; `T:` appears if mapped.

Credentials live in **Windows Credential Manager**, not in `settings.json`.

## Features

- On-demand download through Cloud Files placeholders
- Offline read for hydrated files, native **Always keep on this device**
- Offline writes queued and uploaded when the network returns
- Conflict copies instead of silent overwrite
- New folders/files, edits, renames and deletes sync
- FileSystemWatcher for immediate local-change sync
- Network change listeners for reconnect and immediate refresh
- Real-time remote changes through `/api/sync/watch`
- Optional `T:` drive letter (`subst`)

## Source layout

```text
Program.cs                  entry point, screenshot and uninstall cleanup
TrayApplicationContext.cs   tray icon, connect/disconnect, status
SettingsForm.cs             first-run and settings UI
CloudFiles/                 Cloud Files native registration, placeholders,
                            hydration, sync service and Tern REST backend
AppSettings.cs              preferences + settings.json
CredentialStore.cs          Windows Credential Manager
ServerUrl.cs                URL normalization
StartupManager.cs           launch at login (HKCU Run)
```

See [docs/WINDOWS.md](../docs/WINDOWS.md) for setup, offline behavior and
troubleshooting.
