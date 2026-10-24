using System.Diagnostics;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text.Json;

namespace Tern.Windows;

public sealed record AvailableUpdate(string Version, string ReleaseUrl, string InstallerUrl);

/// <summary>Checks GitHub Releases and optionally installs a newer Windows build.</summary>
public static class UpdateChecker
{
    private const string LatestReleaseUrl = "https://api.github.com/repos/XiaolongZhang-dev/tern/releases/latest";

    public static async Task<AvailableUpdate?> CheckAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };
            client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Tern-Windows", "1.0"));
            client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
            using var response = await client.GetAsync(LatestReleaseUrl, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode) return null;
            var json = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            var tag = doc.RootElement.GetProperty("tag_name").GetString() ?? "";
            var releaseUrl = doc.RootElement.TryGetProperty("html_url", out var html) ? html.GetString() ?? "" : "";
            if (!TryParseVersion(tag, out var latest)) return null;

            var current = Assembly.GetExecutingAssembly().GetName().Version ?? new Version(0, 0, 0);
            if (latest <= current) return null;

            string? installer = null;
            if (doc.RootElement.TryGetProperty("assets", out var assets) && assets.ValueKind == JsonValueKind.Array)
            {
                foreach (var asset in assets.EnumerateArray())
                {
                    var name = asset.TryGetProperty("name", out var assetName) ? assetName.GetString() : null;
                    if (!string.Equals(name, "Tern-Windows-Setup.exe", StringComparison.OrdinalIgnoreCase)) continue;
                    installer = asset.TryGetProperty("browser_download_url", out var url) ? url.GetString() : null;
                    break;
                }
            }
            return installer is null ? null : new AvailableUpdate(tag.TrimStart('v', 'V'), releaseUrl, installer);
        }
        catch (Exception exception)
        {
            Log.Warn("update check failed: " + exception.Message);
            return null;
        }
    }

    public static async Task<string> DownloadAsync(AvailableUpdate update, CancellationToken cancellationToken = default)
    {
        var path = Path.Combine(Path.GetTempPath(), "Tern-Windows-Setup.exe");
        using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Tern-Windows", "1.0"));
        await using (var source = await client.GetStreamAsync(update.InstallerUrl, cancellationToken).ConfigureAwait(false))
        await using (var target = File.Create(path))
        {
            await source.CopyToAsync(target, cancellationToken).ConfigureAwait(false);
        }
        return path;
    }

    public static void LaunchInstaller(string path)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = path,
            Arguments = "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS",
            UseShellExecute = true,
        });
    }

    private static bool TryParseVersion(string tag, out Version version)
    {
        var text = tag.Trim().TrimStart('v', 'V');
        var parts = text.Split('.', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2 || !int.TryParse(parts[0], out var major) || !int.TryParse(parts[1], out var minor))
        {
            version = new Version(0, 0);
            return false;
        }
        var patch = parts.Length > 2 && int.TryParse(parts[2], out var p) ? p : 0;
        version = new Version(major, minor, patch);
        return true;
    }
}
