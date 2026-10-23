using System.Drawing;
using System.Windows.Forms;

namespace Tern.Windows;

/// <summary>Handles `Tern.exe --share "C:\path\file"` from the Explorer menu.</summary>
public static class ShareCommand
{
    public static int Run(string localPath)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        try
        {
            var settings = new SettingsStore().Load();
            if (string.IsNullOrWhiteSpace(settings.ServerUrl) || string.IsNullOrWhiteSpace(settings.Username))
            {
                MessageBox.Show("Tern 尚未配置。请先打开 Tern 并填写服务器和账号。",
                    "Tern 分享", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 1;
            }
            var password = CredentialStore.Load(settings.ServerUrl, settings.Username);
            if (string.IsNullOrWhiteSpace(password))
            {
                MessageBox.Show("Tern 还没有保存密码。请先打开 Tern 设置并保存密码。",
                    "Tern 分享", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 1;
            }

            var root = Path.GetFullPath(settings.SyncFolder);
            var target = Path.GetFullPath(localPath);
            if (!IsUnder(root, target))
            {
                MessageBox.Show("只能分享 Tern 同步文件夹中的文件或文件夹。",
                    "Tern 分享", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }

            var relative = Path.GetRelativePath(root, target).Replace('\\', '/');
            if (relative == ".")
            {
                MessageBox.Show("不能分享 Tern 同步根目录，请选择其中的文件或文件夹。",
                    "Tern 分享", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }

            var itemName = Path.GetFileName(target.TrimEnd(Path.DirectorySeparatorChar));
            var backend = new TernBackendClient(settings.ServerUrl, settings.Username, password);
            var node = FindNodeAsync(backend, relative).GetAwaiter().GetResult();
            if (node is null)
            {
                MessageBox.Show("服务器上找不到这个项目。请等待同步完成后再试。",
                    "Tern 分享", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }

            using var dialog = new ShareDialog(itemName);
            if (dialog.ShowDialog() != DialogResult.OK) return 0;

            var share = backend.CreateShareAsync(node.Id, dialog.SharePassword, dialog.ExpiresInHours)
                .GetAwaiter().GetResult();
            Clipboard.SetText(share.Url);
            var expires = share.ExpiresAt is null ? "永久有效" : "有效期至 " + share.ExpiresAt;
            MessageBox.Show($"分享链接已复制到剪贴板：\n\n{share.Url}\n\n{expires}\n{(share.HasPassword ? "已设置密码" : "无密码")}",
                "Tern 分享", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        catch (Exception exception)
        {
            Log.Error("share failed: " + exception);
            MessageBox.Show($"创建分享链接失败：\n{exception.Message}\n\n详细信息已写入 Tern 日志。",
                "Tern 分享", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static bool IsUnder(string root, string target)
    {
        var comparison = StringComparison.OrdinalIgnoreCase;
        if (target.Equals(root, comparison)) return true;
        return target.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, comparison);
    }

    private static async Task<TernNode?> FindNodeAsync(TernBackendClient backend, string relativePath)
    {
        var byId = new Dictionary<string, TernNode>(StringComparer.Ordinal);
        var cursor = 0;
        while (true)
        {
            var page = await backend.GetChangesAsync(cursor).ConfigureAwait(false);
            if (page.Reset) byId.Clear();
            foreach (var change in page.Changes)
                if (change.Node is { } node) byId[node.Id] = node;
            cursor = page.Cursor;
            if (!page.HasMore) break;
        }

        var paths = new Dictionary<string, string>(StringComparer.Ordinal);
        string? PathOf(TernNode node, HashSet<string>? guard = null)
        {
            if (paths.TryGetValue(node.Id, out var cached)) return cached;
            guard ??= new HashSet<string>(StringComparer.Ordinal);
            if (!guard.Add(node.Id)) return null;
            var path = node.Name;
            if (node.ParentId is not null && byId.TryGetValue(node.ParentId, out var parent))
            {
                var parentPath = PathOf(parent, guard);
                if (parentPath is not null) path = parentPath + "/" + node.Name;
            }
            paths[node.Id] = path;
            return path;
        }

        foreach (var node in byId.Values)
        {
            var path = PathOf(node);
            if (string.Equals(path, relativePath, StringComparison.OrdinalIgnoreCase)) return node;
        }
        return null;
    }
}
