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
    private readonly TextBox _folderBox = new();
    private readonly ComboBox _driveBox = new();
    private readonly CheckBox _launchAtLogin = new();
    private readonly CheckBox _autoConnect = new();
    private readonly Label _statusLabel = new();
    private readonly Button _testButton = new();
    private readonly Button _saveButton = new();
    private readonly Button _cancelButton = new();
    private readonly Button _browseButton = new();

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
        ClientSize = new Size(640, 570);
        MinimumSize = new Size(620, 540);
        BackColor = Color.FromArgb(248, 247, 244);

        BuildUi(firstRun);
        LoadValues();
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
            RowCount = 12,
            Margin = new Padding(0),
            Padding = new Padding(0),
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 108));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        for (var i = 0; i < 12; i++) layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

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
                ? "连接你的私有网盘。Tern 会在资源管理器中创建离线同步位置，也可以映射为盘符。"
                : "修改连接信息、同步文件夹和启动行为。",
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

        var folderRow = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 1,
            AutoSize = true,
            Margin = new Padding(0),
        };
        folderRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        folderRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        _folderBox.Dock = DockStyle.Fill;
        _folderBox.Margin = new Padding(0, 3, 6, 3);
        _browseButton.Text = "选择…";
        _browseButton.AutoSize = true;
        _browseButton.AutoSizeMode = AutoSizeMode.GrowAndShrink;
        _browseButton.Margin = new Padding(0, 3, 0, 3);
        _browseButton.Click += (_, _) => BrowseFolder();
        folderRow.Controls.Add(_folderBox, 0, 0);
        folderRow.Controls.Add(_browseButton, 1, 0);
        AddRow(layout, 5, "同步文件夹", folderRow);

        AddRow(layout, 6, "盘符", _driveBox);
        _driveBox.DropDownStyle = ComboBoxStyle.DropDownList;
        _driveBox.Width = 180;

        _launchAtLogin.Text = "登录 Windows 时自动启动 Tern";
        _launchAtLogin.AutoSize = true;
        _launchAtLogin.Margin = new Padding(0, 8, 0, 2);
        layout.Controls.Add(_launchAtLogin, 1, 7);

        _autoConnect.Text = "启动后自动启用同步";
        _autoConnect.AutoSize = true;
        _autoConnect.Margin = new Padding(0, 2, 0, 8);
        layout.Controls.Add(_autoConnect, 1, 8);

        var note = new Label
        {
            Text = "Tern 使用 Windows Cloud Files 在资源管理器中显示文件：文件按需下载，离线修改会在网络恢复后上传。首次启用需要 Windows 10 1709+ 和 NTFS 本地磁盘。",
            ForeColor = Color.FromArgb(105, 101, 116),
            AutoSize = true,
            MaximumSize = new Size(540, 0),
            Margin = new Padding(0, 6, 0, 4),
        };
        layout.Controls.Add(note, 0, 9);
        layout.SetColumnSpan(note, 2);

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

        _saveButton.Text = "保存并启用";
        _saveButton.AutoSize = true;
        _saveButton.AutoSizeMode = AutoSizeMode.GrowAndShrink;
        _saveButton.MinimumSize = new Size(120, 36);
        _saveButton.Padding = new Padding(10, 3, 10, 3);
        _saveButton.Click += async (_, _) => await SaveAsync();

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
        _folderBox.Text = _initial.SyncFolder;

        _driveBox.Items.Clear();
        _driveBox.Items.Add("不映射盘符");
        foreach (var letter in DriveLetterSubst.AvailableLetters())
            _driveBox.Items.Add(letter + ":");
        var current = (_initial.DriveLetter ?? "").TrimEnd(':').ToUpperInvariant();
        if (current.Length == 1)
        {
            var item = current + ":";
            if (!_driveBox.Items.Contains(item)) _driveBox.Items.Add(item);
            _driveBox.SelectedItem = item;
        }
        if (_driveBox.SelectedIndex < 0) _driveBox.SelectedIndex = 0;

        _launchAtLogin.Checked = StartupManager.IsEnabled() || _initial.LaunchAtLogin;
        _autoConnect.Checked = _initial.AutoConnect;
    }

    private void BrowseFolder()
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "选择 Tern 同步文件夹",
            UseDescriptionForTitle = true,
            SelectedPath = _folderBox.Text,
            ShowNewFolderButton = true,
        };
        if (dialog.ShowDialog(this) == DialogResult.OK)
            _folderBox.Text = dialog.SelectedPath;
    }

    private bool TryReadInputs(
        out string serverUrl,
        out string username,
        out string password,
        out string folder,
        out string driveLetter,
        out string error)
    {
        serverUrl = username = password = folder = driveLetter = "";
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
        folder = _folderBox.Text.Trim();
        if (folder.Length == 0) folder = AppSettings.DefaultSyncFolder();
        try { folder = Path.GetFullPath(folder); }
        catch
        {
            error = "同步文件夹路径不正确。";
            return false;
        }
        var selected = _driveBox.SelectedItem?.ToString() ?? "不映射盘符";
        driveLetter = selected == "不映射盘符" ? "" : selected.TrimEnd(':');
        return true;
    }

    private async Task TestAsync()
    {
        if (!TryReadInputs(out var serverUrl, out var username, out var password, out _, out _, out var error))
        {
            SetStatus(error, true);
            return;
        }
        SetBusy(true);
        SetStatus("正在测试连接…", false);
        try
        {
            await using var client = new TernBackendClient(serverUrl, username, password);
            var result = await client.TestAsync();
            SetStatus("✅ " + result, false);
        }
        catch (Exception exception)
        {
            SetStatus("❌ " + exception.Message, true);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async Task SaveAsync()
    {
        if (!TryReadInputs(out var serverUrl, out var username, out var password, out var folder, out var driveLetter, out var error))
        {
            SetStatus(error, true);
            return;
        }

        SetBusy(true);
        SetStatus("正在验证服务器…", false);
        try
        {
            await using (var client = new TernBackendClient(serverUrl, username, password))
            {
                await client.LoginAsync();
            }

            Directory.CreateDirectory(folder);
            if (!CredentialStore.Save(serverUrl, username, password))
                Log.Warn("无法保存密码到 Windows 凭据管理器。");

            var updated = new AppSettings
            {
                ServerUrl = serverUrl,
                Username = username,
                SyncFolder = folder,
                DriveLetter = driveLetter,
                AutoConnect = _autoConnect.Checked,
                LaunchAtLogin = _launchAtLogin.Checked,
            };
            _store.Save(updated);
            StartupManager.SetEnabled(updated.LaunchAtLogin);

            SetStatus("✅ 设置已保存", false);
            Saved = true;
            DialogResult = DialogResult.OK;
            Close();
        }
        catch (Exception exception)
        {
            SetStatus("❌ " + exception.Message, true);
            Log.Error("保存设置失败：" + exception.Message);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void SetStatus(string message, bool error)
    {
        _statusLabel.Text = message;
        _statusLabel.ForeColor = error ? Color.FromArgb(186, 38, 38) : Color.FromArgb(35, 117, 82);
    }

    private void SetBusy(bool busy)
    {
        _saveButton.Enabled = !busy;
        _testButton.Enabled = !busy;
        _cancelButton.Enabled = !busy;
        Cursor = busy ? Cursors.WaitCursor : Cursors.Default;
    }
}
