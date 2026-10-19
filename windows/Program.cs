using System.Threading;
using Tern.Windows;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
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
}
