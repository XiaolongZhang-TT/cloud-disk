using System.Drawing;
using System.Drawing.Imaging;
using System.Threading;
using Tern.Windows;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length >= 2 && args[0] == "--screenshot")
        {
            RenderScreenshot(args[1]);
            return;
        }

        if (args.Length >= 1 && args[0] == "--cloudfiles-selftest")
        {
            Environment.ExitCode = RunCloudFilesSelfTest();
            return;
        }

        if (args.Length >= 1 && args[0] == "--uninstall-cleanup")
        {
            TernSyncService.CleanupForUninstall(new SettingsStore().Load());
            return;
        }

        using var mutex = new Mutex(true, @"Local\TernWindowsClient", out var createdNew);
        if (!createdNew)
        {
            MessageBox.Show(
                "Tern 已经在运行。\n请在任务栏通知区域点击 Tern 图标。",
                "Tern",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return;
        }

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        Application.ThreadException += (_, e) =>
        {
            Log.Error($"UI 线程异常：{e.Exception}");
            MessageBox.Show(
                $"Tern 遇到一个错误：\n{e.Exception.Message}\n\n详细信息已写入日志。",
                "Tern",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        };
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            if (e.ExceptionObject is Exception ex) Log.Error($"未处理异常：{ex}");
        };

        Application.Run(new TrayApplicationContext(args));
    }

    private static int RunCloudFilesSelfTest()
    {
        var id = Guid.NewGuid().ToString("N");
        var root = Path.Combine(Path.GetTempPath(), "TernCloudSelfTest-" + id);
        var data = Path.Combine(Path.GetTempPath(), "TernCloudSelfTestData-" + id);
        try
        {
            Directory.CreateDirectory(root);
            Directory.CreateDirectory(data);
            var backend = new TernBackendClient("http://127.0.0.1:9/Tern", "selftest", "selftest");
            var provider = new CloudFilesProvider(root, data, backend);
            provider.RegisterAndConnectAsync().GetAwaiter().GetResult();
            var entry = new ManifestEntry
            {
                RelativePath = "hello.txt",
                Kind = "file",
                CourseId = "root",
                SourceId = Guid.NewGuid().ToString(),
                Revision = "1",
                Size = 5,
                UpdatedAt = DateTimeOffset.UtcNow.ToString("O"),
                ContentType = "text/plain",
            };
            provider.CreateAsync(entry, "hello.txt", CancellationToken.None).GetAwaiter().GetResult();
            var local = provider.SnapshotAsync(CancellationToken.None).GetAwaiter().GetResult();
            Console.WriteLine($"SELF_TEST_OK files={local.Count} root={root}");
            provider.DisposeAsync().AsTask().GetAwaiter().GetResult();
            backend.DisposeAsync().AsTask().GetAwaiter().GetResult();
            CloudFilesProvider.Unregister(root);
            return local.Count == 1 ? 0 : 2;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine("SELF_TEST_FAILED: " + exception);
            return 1;
        }
        finally
        {
            try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch { }
            try { if (Directory.Exists(data)) Directory.Delete(data, true); } catch { }
        }
    }

    private static void RenderScreenshot(string path)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        using var form = new SettingsForm(new AppSettings
        {
            ServerUrl = "https://nas.example.com:8080/Tern",
            Username = "demo",
            SyncFolder = AppSettings.DefaultSyncFolder(),
            DriveLetter = "T",
            AutoConnect = true,
            LaunchAtLogin = true,
        }, "demo-password", firstRun: true);

        form.Show();
        Application.DoEvents();
        form.Refresh();
        Application.DoEvents();

        using var bitmap = new Bitmap(form.Width, form.Height);
        form.DrawToBitmap(bitmap, new Rectangle(0, 0, form.Width, form.Height));
        bitmap.Save(path, ImageFormat.Png);
        form.Close();
    }
}
