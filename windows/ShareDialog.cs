using System.Drawing;
using System.Windows.Forms;

namespace Tern.Windows;

/// <summary>Per-share policy dialog. Defaults to 24 hours and no password.</summary>
public sealed class ShareDialog : Form
{
    private readonly TextBox _password;
    private readonly ComboBox _expiry;

    public string? SharePassword =>
        string.IsNullOrWhiteSpace(_password.Text) ? null : _password.Text;

    public int? ExpiresInHours =>
        _expiry.SelectedItem is ExpiryChoice choice ? choice.Hours : 24;

    public ShareDialog(string itemName)
    {
        Text = "创建 Tern 分享链接";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MinimizeBox = false;
        MaximizeBox = false;
        ShowInTaskbar = true;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Padding = new Padding(18);

        var layout = new TableLayoutPanel
        {
            ColumnCount = 2,
            AutoSize = true,
            Dock = DockStyle.Fill,
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 320));

        var title = new Label
        {
            Text = $"分享「{itemName}」",
            Font = new Font(Font.FontFamily, 11f, FontStyle.Bold),
            AutoSize = true,
            Margin = new Padding(0, 0, 0, 10),
        };
        layout.Controls.Add(title, 0, 0);
        layout.SetColumnSpan(title, 2);

        var hint = new Label
        {
            Text = "选择分享策略。默认：24 小时有效、无密码。",
            ForeColor = Color.FromArgb(90, 90, 90),
            AutoSize = true,
            Margin = new Padding(0, 0, 0, 12),
        };
        layout.Controls.Add(hint, 0, 1);
        layout.SetColumnSpan(hint, 2);

        layout.Controls.Add(new Label { Text = "分享密码（可选）", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 2);
        _password = new TextBox
        {
            UseSystemPasswordChar = true,
            PlaceholderText = "留空则无密码",
            Width = 320,
            Margin = new Padding(0, 4, 0, 8),
        };
        layout.Controls.Add(_password, 1, 2);

        layout.Controls.Add(new Label { Text = "有效期", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 3);
        _expiry = new ComboBox
        {
            DropDownStyle = ComboBoxStyle.DropDownList,
            Width = 320,
            Margin = new Padding(0, 4, 0, 16),
        };
        _expiry.Items.AddRange(new object[]
        {
            new ExpiryChoice("24 小时（默认）", 24),
            new ExpiryChoice("1 小时", 1),
            new ExpiryChoice("7 天", 24 * 7),
            new ExpiryChoice("30 天", 24 * 30),
            new ExpiryChoice("永久", null),
        });
        _expiry.SelectedIndex = 0;
        layout.Controls.Add(_expiry, 1, 3);

        var buttons = new FlowLayoutPanel
        {
            FlowDirection = FlowDirection.RightToLeft,
            Dock = DockStyle.Fill,
            AutoSize = true,
            Margin = new Padding(0, 8, 0, 0),
        };
        var create = new Button { Text = "创建并复制链接", AutoSize = true, DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "取消", AutoSize = true, DialogResult = DialogResult.Cancel };
        buttons.Controls.Add(create);
        buttons.Controls.Add(cancel);
        layout.Controls.Add(buttons, 0, 4);
        layout.SetColumnSpan(buttons, 2);

        Controls.Add(layout);
        AcceptButton = create;
        CancelButton = cancel;
    }

    private sealed record ExpiryChoice(string Label, int? Hours)
    {
        public override string ToString() => Label;
    }
}
