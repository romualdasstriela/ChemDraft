# Installing ChemDraft_RS

<!-- One line per paragraph: GitHub release notes keep every line break. -->

ChemDraft_RS is a personal build of ChemDraft with the changes listed in STRIELA-CHANGES.txt. It is not an official ChemDraft release.

## Windows

1. Download the `...-windows-x64-setup.exe` file below, under **Assets**.
2. Run it. Windows may say **"Windows protected your PC"** because the installer is not code-signed: click **More info**, then **Run anyway**.
3. It installs for your user account only. No administrator rights are needed.

It installs as **ChemDraft (dev)**. If you also have the official ChemDraft, both stay installed side by side; this build does not replace or update it.

There is no macOS build of this version.

## Updating

This build does not update itself. To get a newer version, download the newest release from this page and run its installer; it replaces the earlier ChemDraft (dev).

## Checking the download (optional)

Each installer has a `.sha256` file next to it. In PowerShell:

```powershell
Get-FileHash .\ChemDraft_RS-*-windows-x64-setup.exe -Algorithm SHA256
```

The hash shown should match the one in the `.sha256` file.
