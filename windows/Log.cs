using System.Diagnostics;
using System.Text;

namespace Tern.Windows;

public static class Log
{
    private static readonly object Gate = new();

    public static void Info(string message) => Write("INFO", message);
    public static void Warn(string message) => Write("WARN", message);
    public static void Error(string message) => Write("ERROR", message);

    private static void Write(string level, string message)
    {
        try
        {
            lock (Gate)
            {
                AppPaths.EnsureDataDirectory();
                var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{level}] {message}{Environment.NewLine}";
                File.AppendAllText(AppPaths.LogFile, line, Encoding.UTF8);

                var info = new FileInfo(AppPaths.LogFile);
                if (info.Exists && info.Length > 2 * 1024 * 1024)
                {
                    var previous = AppPaths.LogFile + ".previous";
                    File.Delete(previous);
                    File.Move(AppPaths.LogFile, previous);
                }
            }
        }
        catch
        {
            // Logging must never take down the client.
        }
    }

    public static void OpenLog()
    {
        try
        {
            AppPaths.EnsureDataDirectory();
            if (!File.Exists(AppPaths.LogFile)) File.WriteAllText(AppPaths.LogFile, "");
            Process.Start(new ProcessStartInfo(AppPaths.LogFile) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show($"无法打开日志：{ex.Message}", "Tern", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
