using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

namespace Tern.Windows;

public sealed class TrayApplicationContext : ApplicationContext
{
    private readonly SettingsStore _store = new();
    private readonly NotifyIcon _notifyIcon;
    private readonly ToolStripMenuItem _statusItem;
    private readonly ToolStripMenuItem _connectItem;
    private readonly ToolStripMenuItem _openItem;
    private readonly System.Windows.Forms.Timer _stateTimer;
    private readonly System.Windows.Forms.Timer _startupTimer;

    private AppSettings _settings;
    private string? _savedPassword;
    private SettingsForm? _settingsForm;
    private bool _busy;
    private bool? _lastConnected;

    public TrayApplicationContext(string[] args)
    {
        _settings = _store.Load();
        _savedPassword = HasCredentials(_settings) ? CredentialStore.Load(_settings.ServerUrl, _settings.Username) : null;

        _statusItem = new ToolStripMenuItem("未连接") { Enabled = false };
        _connectItem = new ToolStripMenuItem("连接", null, async (_, _) => await ConnectAsync(true));
        _openItem = new ToolStripMenuItem("在资源管理器中打开", null, (_, _) => OpenDrive()) { Enabled = false };

        var menu = new ContextMenuStrip();
        menu.Items.Add(new ToolStripMenuItem("Tern") { Enabled = false });
        menu.Items.Add(_statusItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_connectItem);
        menu.Items.Add(_openItem);
        menu.Items.Add(new ToolStripMenuItem("设置…", null, (_, _) => ShowSettings()));
        menu.Items.Add(new ToolStripMenuItem("打开日志", null, (_, _) => Log.OpenLog()));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("退出 Tern", null, (_, _) => ExitApplication()));

        _notifyIcon = new NotifyIcon
        {
            Icon = LoadIcon(),
            Text = "Tern · 未连接",
            Visible = true,
            ContextMenuStrip = menu,
        };
        _notifyIcon.DoubleClick += (_, _) =>
        {
            if (IsConnected()) OpenDrive();
            else ShowSettings();
        };

        _stateTimer = new System.Windows.Forms.Timer { Interval = 5000 };
        _stateTimer.Tick += (_, _) => RefreshState();
        _stateTimer.Start();

        _startupTimer = new System.Windows.Forms.Timer { Interval = 700 };
        _startupTimer.Tick += (_, _) =>
        {
            _startupTimer.Stop();
            Start();
        };
        _startupTimer.Start();

        UpdateMenu();
    }

    private void Start()
    {
        SyncLaunchSetting();

        if (!HasConfig(_settings))
        {
            ShowSettings();
            return;
        }

        var autostart = Environment.GetCommandLineArgs().Any(a =>
            string.Equals(a, "--autostart", StringComparison.OrdinalIgnoreCase));
        if (_settings.AutoConnect || autostart)
        {
            _ = ConnectAsync(false);
        }
    }

    private void SyncLaunchSetting()
    {
        try
        {
            if (_settings.LaunchAtLogin)
            {
                if (!StartupManager.IsEnabled()) StartupManager.SetEnabled(true);
            }
            else
            {
                // Also removes a stale value left by an older install path.
                StartupManager.SetEnabled(false);
            }
        }
        catch (Exception ex)
        {
            Log.Warn($"同步开机启动设置失败：{ex.Message}");
        }
    }

    private static bool HasConfig(AppSettings settings) =>
        !string.IsNullOrWhiteSpace(settings.ServerUrl) && !string.IsNullOrWhiteSpace(settings.Username);

    private static bool HasCredentials(AppSettings settings) =>
        HasConfig(settings) && CredentialStore.Has(settings.ServerUrl, settings.Username);

    private static Icon LoadIcon()
    {
        try
        {
            var path = Environment.ProcessPath ?? Application.ExecutablePath;
            return Icon.ExtractAssociatedIcon(path) ?? SystemIcons.Application;
        }
        catch
        {
            return SystemIcons.Application;
        }
    }

    private bool IsConnected()
    {
        return DriveMapper.IsMappedToServer(_settings.DriveLetter, _settings.ServerUrl);
    }

    private void RefreshState() => UpdateMenu();

    private void UpdateMenu()
    {
        var connected = IsConnected();
        var drive = _settings.DriveLetter + ":";

        if (_lastConnected != connected)
        {
            var remote = DriveMapper.GetMappedRemote(_settings.DriveLetter);
            Log.Info($"托盘连接状态：connected={connected}, drive={drive}, remote={remote ?? "<none>"}, server={_settings.ServerUrl}");
            _lastConnected = connected;
        }

        _statusItem.Text = connected ? $"已连接 · {drive}" : "未连接";
        _connectItem.Text = connected ? "断开连接" : "连接";
        _connectItem.Enabled = !_busy;
        _openItem.Enabled = connected;

        var trayText = connected ? $"Tern · {drive}" : "Tern · 未连接";
        _notifyIcon.Text = trayText.Length > 63 ? trayText[..63] : trayText;
    }

    private async Task ConnectAsync(bool interactive)
    {
        if (_busy) return;

        if (!HasConfig(_settings))
        {
            ShowSettings();
            return;
        }

        _savedPassword ??= CredentialStore.Load(_settings.ServerUrl, _settings.Username);
        if (string.IsNullOrWhiteSpace(_savedPassword))
        {
            if (interactive) ShowSettings();
            else Notify("缺少密码", "请打开 Tern 设置，填写服务器密码。", ToolTipIcon.Warning);
            return;
        }

        _busy = true;
        UpdateMenu();

        try
        {
            var result = await Task.Run(() => DriveMapper.Map(
                _settings.ServerUrl,
                _settings.Username,
                _savedPassword,
                _settings.DriveLetter));

            _settings.DriveLetter = result.DriveLetter;
            _store.Save(_settings);
            Log.Info($"已连接 {result.DriveLetter}: -> {result.RemotePath}");
            if (interactive) OpenDrive();
        }
        catch (Exception ex)
        {
            Log.Error($"连接失败：{ex.Message}");
            if (interactive)
            {
                MessageBox.Show(ex.Message, "Tern 连接失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            else
            {
                Notify("Tern 连接失败", ex.Message, ToolTipIcon.Error);
            }
        }
        finally
        {
            _busy = false;
            UpdateMenu();
        }
    }

    private void ShowSettings()
    {
        if (_settingsForm is not null)
        {
            _settingsForm.Activate();
            return;
        }

        _savedPassword = HasConfig(_settings)
            ? CredentialStore.Load(_settings.ServerUrl, _settings.Username)
            : null;

        _settingsForm = new SettingsForm(_settings.Clone(), _savedPassword, !HasConfig(_settings));
        var result = _settingsForm.ShowDialog();
        _settingsForm.Dispose();
        _settingsForm = null;

        if (result != DialogResult.OK) return;

        _settings = _store.Load();
        _savedPassword = CredentialStore.Load(_settings.ServerUrl, _settings.Username);
        UpdateMenu();
        OpenDrive();
    }

    private void OpenDrive()
    {
        if (!IsConnected())
        {
            ShowSettings();
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = _settings.DriveLetter + ":\\",
                UseShellExecute = true,
            });
        }
        catch (Exception ex)
        {
            MessageBox.Show($"无法打开资源管理器：{ex.Message}", "Tern", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void Notify(string title, string message, ToolTipIcon icon)
    {
        _notifyIcon.BalloonTipTitle = title;
        _notifyIcon.BalloonTipText = message;
        _notifyIcon.BalloonTipIcon = icon;
        _notifyIcon.ShowBalloonTip(5000);
    }

    private void ExitApplication()
    {
        try
        {
            var mappedToUs = DriveMapper.IsMappedToServer(_settings.DriveLetter, _settings.ServerUrl);
            if (mappedToUs)
            {
                var result = MessageBox.Show(
                    $"退出并断开 {_settings.DriveLetter}: 吗？",
                    "Tern",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question);
                if (result != DialogResult.Yes) return;
                DriveMapper.Unmap(_settings.DriveLetter);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"断开失败：{ex.Message}", "Tern", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        _stateTimer.Stop();
        _startupTimer.Stop();
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _stateTimer.Dispose();
            _startupTimer.Dispose();
            _notifyIcon.Dispose();
        }
        base.Dispose(disposing);
    }
}
