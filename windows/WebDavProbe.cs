using System.Net;
using System.Net.Http;
using System.Text;

namespace Tern.Windows;

public sealed record ProbeResult(bool Ok, string Message);

public static class WebDavProbe
{
    public static async Task<ProbeResult> ProbeAsync(Uri server, string username, string password, CancellationToken cancellationToken = default)
    {
        try
        {
            using var handler = new HttpClientHandler
            {
                PreAuthenticate = true,
                Credentials = new NetworkCredential(username, password),
                AllowAutoRedirect = true,
            };

            using var client = new HttpClient(handler)
            {
                Timeout = TimeSpan.FromSeconds(20),
            };

            using var request = new HttpRequestMessage(new HttpMethod("PROPFIND"), server);
            request.Headers.TryAddWithoutValidation("Depth", "0");
            request.Content = new StringContent(
                "<?xml version=\"1.0\"?><D:propfind xmlns:D=\"DAV:\"><D:prop><D:resourcetype/></D:prop></D:propfind>",
                Encoding.UTF8,
                "application/xml");

            using var response = await client.SendAsync(request, cancellationToken);
            var code = (int)response.StatusCode;

            return code switch
            {
                200 or 207 => new ProbeResult(true, "服务器连接成功，账号密码正确。"),
                401 => new ProbeResult(false, "用户名或密码错误。"),
                403 => new ProbeResult(false, "账号被拒绝访问。"),
                404 => new ProbeResult(false, "地址不存在，请确认路径是 /Tern。"),
                405 => new ProbeResult(false, "服务器没有正确响应 WebDAV PROPFIND。"),
                _ => new ProbeResult(false, $"服务器返回 HTTP {code}。"),
            };
        }
        catch (TaskCanceledException)
        {
            return new ProbeResult(false, "连接超时。请检查服务器地址、端口和网络。");
        }
        catch (HttpRequestException ex)
        {
            var message = ex.Message;
            if (ex.InnerException is System.Security.Authentication.AuthenticationException)
            {
                message = "HTTPS 证书不受信任，请先在 Windows 中信任服务器证书。";
            }
            return new ProbeResult(false, $"无法连接服务器：{message}");
        }
        catch (Exception ex)
        {
            return new ProbeResult(false, $"连接失败：{ex.Message}");
        }
    }
}
