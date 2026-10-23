using Microsoft.Win32;

namespace Tern.Windows;

/// <summary>Explorer "Create Tern share link" context-menu registration.</summary>
public static class ShellContextMenu
{
    private const string Verb = "TernShare";

    public static void Register()
    {
        try
        {
            var exe = Environment.ProcessPath;
            if (string.IsNullOrWhiteSpace(exe)) return;
            RegisterFor(@"Software\Classes\*\shell", exe);
            RegisterFor(@"Software\Classes\Directory\shell", exe);
            Log.Info("shell: registered share context menu");
        }
        catch (Exception exception)
        {
            Log.Warn("shell context menu registration failed: " + exception.Message);
        }
    }

    private static void RegisterFor(string baseKey, string exe)
    {
        using var key = Registry.CurrentUser.CreateSubKey($@"{baseKey}\{Verb}");
        if (key is null) return;
        key.SetValue("", "创建 Tern 分享链接…");
        key.SetValue("MUIVerb", "创建 Tern 分享链接…");
        key.SetValue("Icon", $"\"{exe}\",0");
        using var command = key.CreateSubKey("command");
        command?.SetValue("", $"\"{exe}\" --share \"%1\"");
    }

    public static void Unregister()
    {
        try
        {
            Registry.CurrentUser.DeleteSubKeyTree($@"Software\Classes\*\shell\{Verb}", false);
            Registry.CurrentUser.DeleteSubKeyTree($@"Software\Classes\Directory\shell\{Verb}", false);
        }
        catch (Exception exception)
        {
            Log.Warn("shell context menu cleanup failed: " + exception.Message);
        }
    }
}
