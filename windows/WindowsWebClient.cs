using Microsoft.Win32;

namespace Tern.Windows;

public static class WindowsWebClient
{
    private const string ParametersKey = @"SYSTEM\CurrentControlSet\Services\WebClient\Parameters";

    public static long? FileSizeLimitBytes()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(ParametersKey);
            var value = key?.GetValue("FileSizeLimitInBytes");
            return value switch
            {
                int i => i,
                long l => l,
                _ => null,
            };
        }
        catch
        {
            return null;
        }
    }

    public static string LimitDescription()
    {
        var value = FileSizeLimitBytes();
        if (value is null) return "未知（Windows 默认约 50MB）";
        if (value < 0) return "不限制";
        if (value >= 1L * 1024 * 1024 * 1024) return $"{value / (1024.0 * 1024 * 1024):0.#} GB";
        return $"{value / (1024.0 * 1024):0.#} MB";
    }
}
