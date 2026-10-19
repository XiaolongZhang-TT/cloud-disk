using Microsoft.Win32;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Tern.Windows;

public static class WindowsWebClient
{
    private const string ParametersKey = @"SYSTEM\CurrentControlSet\Services\WebClient\Parameters";
    private const uint ScManagerConnect = 0x0001;
    private const uint ServiceQueryStatus = 0x0004;
    private const uint ServiceRunning = 4;

    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatus
    {
        public uint ServiceType;
        public uint CurrentState;
        public uint ControlsAccepted;
        public uint Win32ExitCode;
        public uint ServiceSpecificExitCode;
        public uint CheckPoint;
        public uint WaitHint;
    }

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr OpenSCManager(string? machineName, string? databaseName, uint access);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr OpenService(IntPtr scManager, string serviceName, uint access);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool QueryServiceStatus(IntPtr service, ref ServiceStatus status);

    [DllImport("advapi32.dll")]
    private static extern bool CloseServiceHandle(IntPtr handle);

    /// <summary>Checks WebClient without parsing localized `sc.exe` output.</summary>
    public static bool IsWebClientRunning()
    {
        var manager = IntPtr.Zero;
        var service = IntPtr.Zero;
        try
        {
            manager = OpenSCManager(null, null, ScManagerConnect);
            if (manager == IntPtr.Zero) return QueryWithSc();
            service = OpenService(manager, "WebClient", ServiceQueryStatus);
            if (service == IntPtr.Zero) return QueryWithSc();
            var status = new ServiceStatus();
            return QueryServiceStatus(service, ref status) && status.CurrentState == ServiceRunning;
        }
        catch
        {
            return QueryWithSc();
        }
        finally
        {
            if (service != IntPtr.Zero) CloseServiceHandle(service);
            if (manager != IntPtr.Zero) CloseServiceHandle(manager);
        }
    }

    private static bool QueryWithSc()
    {
        try
        {
            var sc = Path.Combine(Environment.SystemDirectory, "sc.exe");
            var psi = new ProcessStartInfo(sc, "query WebClient")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using var process = Process.Start(psi);
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

    /// <summary>Starts WebClient with a UAC prompt, then waits for the service to be running.</summary>
    public static bool TryStartWebClient(out string error)
    {
        error = "";
        try
        {
            var sc = Path.Combine(Environment.SystemDirectory, "sc.exe");
            var psi = new ProcessStartInfo(sc, "start WebClient")
            {
                UseShellExecute = true,
                Verb = "runas",
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            using var process = Process.Start(psi);
            process?.WaitForExit(20000);

            for (var i = 0; i < 30; i++)
            {
                if (IsWebClientRunning()) return true;
                Thread.Sleep(500);
            }

            error = "WebClient 没有启动成功。请打开 services.msc，手动启动 WebClient 服务。";
            return false;
        }
        catch (System.ComponentModel.Win32Exception ex) when (ex.NativeErrorCode == 1223)
        {
            error = "已取消启动 WebClient。";
            return false;
        }
        catch (Exception ex)
        {
            error = $"无法启动 WebClient：{ex.Message}";
            return false;
        }
    }

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
