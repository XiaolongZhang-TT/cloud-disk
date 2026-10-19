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

        using var mutex = new Mutex(true, @"Global\TernWindowsClient", out var createdNew);
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

        Application.Run(new TrayApplicationContext(args));
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
