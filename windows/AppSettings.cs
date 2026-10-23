using System.Text.Json;

namespace Tern.Windows;

public sealed class AppSettings
{
    public string ServerUrl { get; set; } = "";
    public string Username { get; set; } = "";
    public string SyncFolder { get; set; } = DefaultSyncFolder();
    public string DriveLetter { get; set; } = "T";
    public bool AutoConnect { get; set; } = true;
    public bool LaunchAtLogin { get; set; }

    public static string DefaultSyncFolder() =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Tern");

    public AppSettings Clone() => new()
    {
        ServerUrl = ServerUrl,
        Username = Username,
        SyncFolder = SyncFolder,
        DriveLetter = DriveLetter,
        AutoConnect = AutoConnect,
        LaunchAtLogin = LaunchAtLogin,
    };
}

public sealed class SettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
    };

    public AppSettings Load()
    {
        try
        {
            if (!File.Exists(AppPaths.SettingsFile)) return new AppSettings();
            var json = File.ReadAllText(AppPaths.SettingsFile);
            var settings = JsonSerializer.Deserialize<AppSettings>(json, JsonOptions) ?? new AppSettings();
            if (string.IsNullOrWhiteSpace(settings.SyncFolder))
                settings.SyncFolder = AppSettings.DefaultSyncFolder();
            return settings;
        }
        catch (Exception ex)
        {
            Log.Warn($"读取设置失败：{ex.Message}");
            return new AppSettings();
        }
    }

    public void Save(AppSettings settings)
    {
        AppPaths.EnsureDataDirectory();
        File.WriteAllText(AppPaths.SettingsFile, JsonSerializer.Serialize(settings, JsonOptions));
    }
}
