using System.Runtime.InteropServices;
using System.Text;

namespace Tern.Windows;

public sealed record DriveMapResult(string DriveLetter, string RemotePath);

public static class DriveMapper
{
    private const int ResourceTypeDisk = 1;
    private const int ResourceDisplayTypeNetwork = 3;
    private const int ConnectUpdateProfile = 0x00000001;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NetResource
    {
        public int Scope;
        public int Type;
        public int DisplayType;
        public int Usage;
        public string? LocalName;
        public string? RemoteName;
        public string? Comment;
        public string? Provider;
    }

    [DllImport("mpr.dll", CharSet = CharSet.Unicode)]
    private static extern int WNetAddConnection2(ref NetResource netResource, string? password, string? username, int flags);

    [DllImport("mpr.dll", CharSet = CharSet.Unicode)]
    private static extern int WNetCancelConnection2(string name, int flags, bool force);

    [DllImport("mpr.dll", CharSet = CharSet.Unicode)]
    private static extern int WNetGetConnection(string localName, StringBuilder remoteName, ref int length);

    public static string NormalizeDriveLetter(string? value)
    {
        var text = (value ?? "").Trim().TrimEnd(':').ToUpperInvariant();
        return text.Length == 1 && text[0] >= 'D' && text[0] <= 'Z' ? text : "T";
    }

    public static IReadOnlyList<string> AvailableDriveLetters()
    {
        var used = new HashSet<char>();
        try
        {
            foreach (var drive in DriveInfo.GetDrives())
            {
                var name = drive.Name.TrimEnd('\\');
                if (name.Length > 0) used.Add(char.ToUpperInvariant(name[0]));
            }
        }
        catch (Exception ex)
        {
            Log.Warn($"枚举驱动器失败：{ex.Message}");
        }

        foreach (var letter in "TUVWXYZ")
        {
            if (!used.Contains(letter)) yield return letter.ToString();
        }
        foreach (var letter in "DEFGHIJKLMNOPQRS")
        {
            if (!used.Contains(letter)) yield return letter.ToString();
        }
    }

    public static string? GetMappedRemote(string driveLetter)
    {
        var name = NormalizeDriveLetter(driveLetter) + ":";
        var buffer = new StringBuilder(1024);
        var length = buffer.Capacity;
        var result = WNetGetConnection(name, buffer, ref length);
        return result == 0 ? buffer.ToString() : null;
    }

    public static bool IsMapped(string driveLetter) => GetMappedRemote(driveLetter) is not null;

    public static DriveMapResult Map(string serverUrl, string username, string password, string driveLetter)
    {
        var letter = NormalizeDriveLetter(driveLetter);
        var localName = letter + ":";

        var existing = GetMappedRemote(letter);
        if (existing is not null)
        {
            if (ServerUrl.AreSame(existing, serverUrl))
            {
                return new DriveMapResult(letter, existing);
            }
            throw new InvalidOperationException($"{localName} 已被其他位置占用，请换一个盘符。");
        }

        var resource = new NetResource
        {
            Type = ResourceTypeDisk,
            DisplayType = ResourceDisplayTypeNetwork,
            LocalName = localName,
            RemoteName = serverUrl,
        };

        var result = WNetAddConnection2(ref resource, password, username, ConnectUpdateProfile);
        if (result != 0)
        {
            throw new InvalidOperationException(FormatError(result, serverUrl));
        }

        for (var i = 0; i < 30; i++)
        {
            try
            {
                if (Directory.Exists(localName + "\\")) break;
            }
            catch
            {
                // WebClient can take a moment to initialize on first use.
            }
            Thread.Sleep(200);
        }

        if (!Directory.Exists(localName + "\\"))
        {
            throw new InvalidOperationException(
                $"{localName} 已映射，但暂时无法访问。\n请确认 Windows 的 WebClient 服务已启动，并检查 HTTPS 证书。");
        }

        return new DriveMapResult(letter, serverUrl);
    }

    public static void Unmap(string driveLetter, bool force = true)
    {
        var letter = NormalizeDriveLetter(driveLetter);
        var result = WNetCancelConnection2(letter + ":", 0, force);
        if (result != 0 && result != 2250)
        {
            throw new InvalidOperationException(FormatError(result, null));
        }
    }

    public static string FormatError(int code, string? serverUrl)
    {
        return code switch
        {
            0 => "成功",
            5 => "没有访问权限。",
            53 => $"找不到网络路径。请检查服务器地址：{serverUrl}",
            67 => $"网络名不存在。请检查服务器地址和 /Tern 路径：{serverUrl}",
            86 => "用户名或密码错误。",
            1200 => "设备名无效。通常表示 Windows WebClient 服务未运行，或 HTTPS 证书不受信任。",
            1204 => "网络连接不可用。",
            1219 => "此账号已有冲突的网络凭据。请断开其他映射后重试。",
            1326 => "用户名或密码错误。",
            2250 => "该网络连接不存在。",
            _ => $"Windows 网络错误 {code}。可在日志中查看详细信息。",
        };
    }

    public static bool IsWebClientServiceRunning()
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo("sc.exe", "query WebClient")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using var process = System.Diagnostics.Process.Start(psi);
            if (process is null) return false;
            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit(3000);
            return output.Contains("RUNNING", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    public static void OpenWebClientHelp()
    {
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(
                "https://github.com/XiaolongZhang-dev/tern/blob/main/docs/WINDOWS.md")
            {
                UseShellExecute = true,
            });
        }
        catch
        {
            // Ignore.
        }
    }
}
