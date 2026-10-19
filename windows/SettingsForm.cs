using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

namespace Tern.Windows;

public sealed class SettingsForm : Form
{
    private readonly AppSettings _initial;
    private readonly string? _savedPassword;
    private readonly SettingsStore _store = new();

    private readonly TextBox _serverBox = new();
    private readonly TextBox _usernameBox = new();
    private readonly TextBox _passwordBox = new();
    private readonly ComboBox _driveBox = new();
    private readonly CheckBox _launchAtLogin = new();
    private readonly CheckBox _autoConnect = new();
    private readonly Label _statusLabel = new();
    private readonly Label _serviceLabel = new();
    private readonly Button _startServiceButton = new();
    private readonly Label _limitLabel = new();
    private readonly Button _testButton = new();
    private readonly Button _saveButton = new();
    private readonly Button _cancelButton = new();

    public bool Saved { get; private set; }

    public SettingsForm(AppSettings settings, string? savedPassword, bool firstRun = false)
    {
        _initial = settings.Clone();
        _savedPassword = savedPassword;

        Text = firstRun ? "连接 Tern" : "Tern 设置";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.Sizable;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = true;
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 9F);
        ClientSize = new Size(640, 560);
        MinimumSize = new Size(620, 500);
        BackColor = Color.FromArgb(248, 247, 244);

        FormClosing += (_, _) => Log.Info("设置窗口关闭");
        BuildUi(firstRun);
        LoadValues();
        UpdateDiagnostics();
    }

    private void BuildUi(bool firstRun)
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 2,
            Margin = new Padding(0),
            Padding = new Padding(0),
        };
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        // The form body scrolls; the action bar is fixed at the bottom so text
        // can never cover the buttons again.
        var content = new Panel
        {
            Dock = DockStyle.Fill,
            AutoScroll = true,
            Padding = new Padding(26, 22, 26, 10),
        };

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 2,
            RowCount = 11,
            Margin = new Padding(0),
            Padding = new Padding(0),
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 108));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        for (var i = 0; i < 11; i++) layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var title = new Label
        {
            Text = "Tern",
            Font = new Font("Segoe UI Semibold", 20F),
            AutoSize = true,
            Margin = new Padding(0, 0, 0, 2),
        };
        layout.Controls.Add(title, 0, 0);
        layout.SetColumnSpan(title, 2);

        var subtitle = new Label
        {
            Text = firstRun
                ? "连接你的私有网盘，连接后会作为 T 盘出现在“此电脑”中。"
                : "修改连接信息和启动行为。",
            ForeColor = Color.FromArgb(105, 101, 116),
            AutoSize = true,
            MaximumSize = new Size(540, 0),
            Margin = new Padding(0, 0, 0, 14),
        };
        layout.Controls.Add(subtitle, 0, 1);
        layout.SetColumnSpan(subtitle, 2);

        AddRow(layout, 2, "服务器地址", _serverBox);
        _serverBox.PlaceholderText = "https://your-nas:8080/Tern";

        AddRow(layout, 3, "用户名", _usernameBox);
        _usernameBox.PlaceholderText = "与网页端账号相同";

        AddRow(layout, 4, "密码", _passwordBox);
        _passwordBox.UseSystemPasswordChar = true;
        _passwordBox.PlaceholderText = _savedPassword is null
            ? "输入网页端密码"
            : "已保存，留空保持不变";

        AddRow(layout, 5, "盘符", _driveBox);
        _driveBox.DropDownStyle = ComboBoxStyle.DropDownList;
        _driveBox.Width = 120;

        _launchAtLogin.Text = "登录 Windows 时自动启动 Tern";
        _launchAtLogin.AutoSize = true;
        _launchAtLogin.Margin = new Padding(0, 8, 0, 2);
        layout.Controls.Add(_launchAtLogin, 1, 6);

        _autoConnect.Text = "启动后自动连接";
        _autoConnect.AutoSize = true;
        _autoConnect.Margin = new Padding(0, 2, 0, 8);
        layout.Controls.Add(_autoConnect, 1, 7);

        _serviceLabel.AutoSize = true;
        _serviceLabel.Margin = new Padding(0, 4, 12, 2);

        _startServiceButton.Text = "启动服务";
        _startServiceButton.Width = 92;
        _startServiceButton.Height = 26;
        _startServiceButton.Margin = new Padding(0, 2, 0, 2);
        _startServiceButton.Click += async (_, _) => await StartServiceAsync();

        var serviceRow = new FlowLayoutPanel
        {
            AutoSize = true,
            WrapContents = false,
            Margin = new Padding(0),
        };
        serviceRow.Controls.Add(_serviceLabel);
        serviceRow.Controls.Add(_startServiceButton);
        layout.Controls.Add(serviceRow, 0, 8);
        layout.SetColumnSpan(serviceRow, 2);

        _limitLabel.AutoSize = false;
        _limitLabel.Dock = DockStyle.Fill;
        _limitLabel.Height = 22;
        _limitLabel.AutoEllipsis = true;
        _limitLabel.Margin = new Padding(0, 2, 0, 2);
        layout.Controls.Add(_limitLabel, 0, 9);
        layout.SetColumnSpan(_limitLabel, 2);

        var helpLink = new LinkLabel
        {
            Text = "Windows 客户端说明 / 大文件限制",
            AutoSize = true,
            Margin = new Padding(0, 2, 0, 8),
        };
        helpLink.LinkClicked += (_, _) => OpenHelp();
        layout.Controls.Add(helpLink, 0, 10);
        layout.SetColumnSpan(helpLink, 2);

        content.Controls.Add(layout);

        var bottom = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 2,
            AutoSize = true,
            Padding = new Padding(26, 8, 26, 10),
            BackColor = Color.FromArgb(248, 247, 244),
        };
        bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        bottom.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        bottom.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        _statusLabel.AutoSize = false;
        _statusLabel.Height = 22;
        _statusLabel.Dock = DockStyle.Fill;
        _statusLabel.AutoEllipsis = true;
        _statusLabel.TextAlign = ContentAlignment.MiddleLeft;
        _statusLabel.ForeColor = Color.FromArgb(105, 101, 116);
        _statusLabel.Margin = new Padding(0, 0, 0, 2);
        _statusLabel.Text = "未连接";

        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Margin = new Padding(0),
        };

        _saveButton.Text = "保存并连接";
        _saveButton.AutoSize = true;
        _saveButton.AutoSizeMode = AutoSizeMode.GrowAndShrink;
        _saveButton.MinimumSize = new Size(110, 36);
        _saveButton.Padding = new Padding(10, 3, 10, 3);
        _saveButton.Click += async (_, _) => await SaveAndConnectAsync();

        _cancelButton.Text = "取消";
        _cancelButton.AutoSize = true;
        _cancelButton.AutoSizeMode = AutoSizeMode.GrowAndShrink;
        _cancelButton.MinimumSize = new Size(76, 36);
        _cancelButton.Padding = new Padding(10, 3, 10, 3);
        _cancelButton.Click += (_, _) => { DialogResult = DialogResult.Cancel; Close(); };

        _testButton.Text = "测试连接";
        _testButton.AutoSize = true;
        _testButton.AutoSizeMode = AutoSizeMode.GrowAndShrink;
        _testButton.MinimumSize = new Size(96, 36);
        _testButton.Padding = new Padding(10, 3, 10, 3);
        _testButton.Click += async (_, _) => await TestAsync();

        buttons.Controls.Add(_saveButton);
        buttons.Controls.Add(_cancelButton);
        buttons.Controls.Add(_testButton);

        bottom.Controls.Add(_statusLabel, 0, 0);
        bottom.Controls.Add(buttons, 0, 1);

        root.Controls.Add(content, 0, 0);
        root.Controls.Add(bottom, 0, 1);

        Controls.Add(root);
        AcceptButton = _saveButton;
        CancelButton = _cancelButton;
    }

    private static void AddRow(TableLayoutPanel layout, int row, string label, Control control)
    {
        var text = new Label
        {
            Text = label,
            AutoSize = true,
            TextAlign = ContentAlignment.MiddleLeft,
            Margin = new Padding(0, 7, 10, 3),
        };
        control.Dock = DockStyle.Fill;
        control.Margin = new Padding(0, 3, 0, 3);
        layout.Controls.Add(text, 0, row);
        layout.Controls.Add(control, 1, row);
    }

    private void LoadValues()
    {
        _serverBox.Text = _initial.ServerUrl;
        _usernameBox.Text = _initial.Username;

        var letters = DriveMapper.AvailableDriveLetters().ToList();
        var current = DriveMapper.NormalizeDriveLetter(_initial.DriveLetter);
        if (!letters.Contains(current)) letters.Insert(0, current);
        _driveBox.Items.Clear();
        foreach (var letter in letters) _driveBox.Items.Add(letter + ":");
        _driveBox.SelectedItem = current + ":";
        if (_driveBox.SelectedIndex < 0) _driveBox.SelectedIndex = 0;

        _launchAtLogin.Checked = StartupManager.IsEnabled();
        _autoConnect.Checked = _initial.AutoConnect;
    }

    private void UpdateDiagnostics()
    {
        var running = WindowsWebClient.IsWebClientRunning();
        _serviceLabel.Text = running ? "WebClient：运行中" : "WebClient：未运行";
        _serviceLabel.ForeColor = running ? Color.FromArgb(35, 117, 82) : Color.FromArgb(180, 95, 25);
        _startServiceButton.Visible = !running;

        var limit = WindowsWebClient.FileSizeLimitBytes();
        _limitLabel.Text = "文件大小限制：" + WindowsWebClient.LimitDescription();
        _limitLabel.ForeColor = limit is null || limit < 100L * 1024 * 1024
            ? Color.FromArgb(180, 95, 25)
            : Color.FromArgb(105, 101, 116);
    }

    private bool TryReadInputs(out string serverUrl, out string username, out string password, out string driveLetter, out string error)
    {
        serverUrl = username = password = driveLetter = "";
        error = "";

        if (!ServerUrl.TryNormalize(_serverBox.Text, out serverUrl, out error)) return false;
        username = _usernameBox.Text.Trim();
        if (username.Length == 0)
        {
            error = "请输入用户名。";
            return false;
        }

        password = _passwordBox.Text.Length > 0 ? _passwordBox.Text : (_savedPassword ?? "");
        if (password.Length == 0)
        {
            error = "请输入密码。";
            return false;
        }

        driveLetter = DriveMapper.NormalizeDriveLetter(
            (_driveBox.SelectedItem?.ToString() ?? "T:").TrimEnd(':'));
        return true;
    }

    private async Task StartServiceAsync()
    {
        SetBusy(true);
        SetStatus("正在请求管理员权限启动 WebClient…", false);
        try
        {
            var error = "";
            var started = await Task.Run(() => WindowsWebClient.TryStartWebClient(out error));
            UpdateDiagnostics();
            SetStatus(started ? "WebClient 服务已启动。" : error, !started);
        }
        catch (Exception ex)
        {
            SetStatus($"启动 WebClient 失败：{ex.Message}", true);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async Task TestAsync()
    {
        if (!TryReadInputs(out var serverUrl, out var username, out var password, out _, out var error))
        {
            SetStatus(error, true);
            return;
        }

        SetBusy(true);
        SetStatus("正在测试连接…", false);
        try
        {
            var result = await WebDavProbe.ProbeAsync(new Uri(serverUrl), username, password);
            SetStatus(result.Message, !result.Ok);
        }
        catch (Exception ex)
        {
            SetStatus($"测试失败：{ex.Message}", true);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async Task SaveAndConnectAsync()
    {
        if (!TryReadInputs(out var serverUrl, out var username, out var password, out var driveLetter, out var error))
        {
            SetStatus(error, true);
            return;
        }

        if (!WindowsWebClient.IsWebClientRunning())
        {
            SetStatus("请先启动 WebClient 服务（点击上方“启动服务”）。", true);
            return;
        }

        SetBusy(true);
        SetStatus("正在验证服务器…", false);
        try
        {
            var probe = await WebDavProbe.ProbeAsync(new Uri(serverUrl), username, password);
            if (!probe.Ok)
            {
                SetStatus(probe.Message, true);
                return;
            }

            SetStatus("正在连接 T 盘…", false);
            try
            {
                var oldLetter = DriveMapper.NormalizeDriveLetter(_initial.DriveLetter);
                if (oldLetter != driveLetter)
                {
                    var oldRemote = DriveMapper.GetMappedRemote(oldLetter);
                    if (oldRemote is not null && ServerUrl.MatchesRemote(oldRemote, serverUrl))
                    {
                        DriveMapper.Unmap(oldLetter);
                    }
                }

                DriveMapper.Map(serverUrl, username, password, driveLetter);
            }
            catch (Exception ex)
            {
                SetStatus(ex.Message, true);
                Log.Error($"映射网络驱动器失败：{ex.Message}");
                return;
            }

            if (_passwordBox.Text.Length > 0 || !CredentialStore.Has(serverUrl, username))
            {
                if (!CredentialStore.Save(serverUrl, username, password))
                {
                    Log.Warn("无法保存密码到 Windows 凭据管理器；本次连接仍然有效。");
                }
            }

            var updated = new AppSettings
            {
                ServerUrl = serverUrl,
                Username = username,
                DriveLetter = driveLetter,
                AutoConnect = _autoConnect.Checked,
                LaunchAtLogin = _launchAtLogin.Checked,
            };

            try
            {
                StartupManager.SetEnabled(updated.LaunchAtLogin);
            }
            catch (Exception ex)
            {
                Log.Warn($"设置开机启动失败：{ex.Message}");
            }

            _store.Save(updated);
            Saved = true;
            _passwordBox.Clear();
            Log.Info($"设置已保存，准备关闭设置窗口：{driveLetter}:");
            SetStatus($"已连接：{driveLetter}:", false);
            CloseFromSuccess();
        }
        catch (Exception ex)
        {
            SetStatus($"连接失败：{ex.Message}", true);
            Log.Error($"保存并连接失败：{ex.Message}");
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void CloseFromSuccess()
    {
        // Setting DialogResult normally closes a modal form, but do it on the
        // next message loop iteration so any pending layout/paint completes.
        void Finish()
        {
            DialogResult = DialogResult.OK;
            Close();
        }

        if (IsHandleCreated) BeginInvoke(new Action(Finish));
        else Finish();
    }

    private void SetBusy(bool busy)
    {
        _testButton.Enabled = !busy;
        _saveButton.Enabled = !busy;
        _cancelButton.Enabled = !busy;
        Cursor = busy ? Cursors.WaitCursor : Cursors.Default;
    }

    private void SetStatus(string message, bool error)
    {
        if (message.Length > 90) message = message[..87] + "…";
        _statusLabel.Text = message;
        _statusLabel.ForeColor = error ? Color.FromArgb(180, 45, 55) : Color.FromArgb(35, 117, 82);
        if (error) Log.Warn($"设置页：{message}");
    }

    private static void OpenHelp()
    {
        try
        {
            Process.Start(new ProcessStartInfo(
                "https://github.com/XiaolongZhang-dev/tern/blob/main/docs/WINDOWS.md")
            {
                UseShellExecute = true,
            });
        }
        catch
        {
            // Ignore browser launch failures.
        }
    }
}
