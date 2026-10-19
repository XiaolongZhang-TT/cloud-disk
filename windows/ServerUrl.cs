namespace Tern.Windows;

public static class ServerUrl
{
    public static bool TryNormalize(string? raw, out string normalized, out string error)
    {
        normalized = "";
        error = "";

        var text = (raw ?? "").Trim();
        if (text.Length == 0)
        {
            error = "请输入服务器地址。";
            return false;
        }

        if (!text.Contains("://", StringComparison.Ordinal))
        {
            text = "https://" + text;
        }

        if (!Uri.TryCreate(text, UriKind.Absolute, out var uri))
        {
            error = "服务器地址格式不正确。";
            return false;
        }

        if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)
        {
            error = "服务器地址必须以 http:// 或 https:// 开头。";
            return false;
        }

        if (string.IsNullOrWhiteSpace(uri.Host))
        {
            error = "服务器地址缺少主机名。";
            return false;
        }

        var builder = new UriBuilder(uri)
        {
            Query = "",
            Fragment = "",
        };

        var path = builder.Path.TrimEnd('/');
        if (path.Length == 0 || path == "/")
        {
            path = "/Tern";
        }
        builder.Path = path;

        normalized = builder.Uri.AbsoluteUri.TrimEnd('/');
        return true;
    }

    public static string NormalizeOrThrow(string raw)
    {
        if (!TryNormalize(raw, out var normalized, out var error))
        {
            throw new ArgumentException(error);
        }
        return normalized;
    }

    /// <summary>
    /// Windows WebDAV often reports mapped drives as UNC paths such as
    /// \\nas@SSL\DavWWWRoot\Tern instead of the original HTTPS URL.
    /// </summary>
    public static bool MatchesRemote(string? remote, string? serverUrl)
    {
        if (AreSame(remote, serverUrl)) return true;
        if (string.IsNullOrWhiteSpace(remote) || string.IsNullOrWhiteSpace(serverUrl)) return false;
        if (!Uri.TryCreate(serverUrl, UriKind.Absolute, out var uri)) return false;

        var text = remote.Trim();
        if (!text.StartsWith(@"\\", StringComparison.Ordinal)) return false;

        var rest = text[2..];
        var slash = rest.IndexOf('\\');
        var hostPart = slash >= 0 ? rest[..slash] : rest;
        var path = slash >= 0 ? rest[(slash + 1)..] : "";
        var at = hostPart.IndexOf('@');
        var host = at >= 0 ? hostPart[..at] : hostPart;

        if (!host.Equals(uri.Host, StringComparison.OrdinalIgnoreCase)) return false;

        var targetPath = uri.AbsolutePath.Trim('/');
        if (targetPath.Length == 0) return true;

        var normalized = path.Replace("DavWWWRoot", "", StringComparison.OrdinalIgnoreCase)
            .Trim('\\', '/');
        return normalized.Equals(targetPath, StringComparison.OrdinalIgnoreCase)
            || normalized.EndsWith("/" + targetPath, StringComparison.OrdinalIgnoreCase)
            || normalized.EndsWith("\\" + targetPath, StringComparison.OrdinalIgnoreCase);
    }

    public static bool AreSame(string? a, string? b)
    {
        if (string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b)) return false;
        if (!Uri.TryCreate(a, UriKind.Absolute, out var ua)) return false;
        if (!Uri.TryCreate(b, UriKind.Absolute, out var ub)) return false;

        return string.Equals(ua.Scheme, ub.Scheme, StringComparison.OrdinalIgnoreCase)
            && string.Equals(ua.Host, ub.Host, StringComparison.OrdinalIgnoreCase)
            && ua.Port == ub.Port
            && string.Equals(ua.AbsolutePath.TrimEnd('/'), ub.AbsolutePath.TrimEnd('/'), StringComparison.Ordinal);
    }
}
