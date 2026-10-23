using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Tern.Windows;

public sealed class TernBackendException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

public sealed record TernNode(
    string Id,
    string? ParentId,
    string Name,
    string Type,
    long Size,
    string? Mime,
    string? UpdatedAt,
    string? Etag)
{
    public bool IsFolder => Type == "folder";
}

public sealed record HydrationResult(string Path, long Size, string Sha256);

public sealed class TernBackendClient : IAsyncDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HttpClient http;
    private readonly CookieContainer cookies = new();
    private readonly Uri apiBase;
    private readonly string username;
    private readonly string password;
    private readonly SemaphoreSlim loginLock = new(1, 1);
    private bool loggedIn;

    public TernBackendClient(string serverUrl, string username, string password)
    {
        var normalized = new Uri(ServerUrl.NormalizeOrThrow(serverUrl));
        this.username = username;
        this.password = password;
        apiBase = BuildApiBase(normalized);
        var handler = new HttpClientHandler
        {
            CookieContainer = cookies,
            UseCookies = true,
            AutomaticDecompression = DecompressionMethods.All,
        };
        http = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(30),
        };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Tern-Windows/1.1");
    }

    public Uri ServerUri => BuildServerUri(apiBase);
    public string Username => username;

    private static Uri BuildApiBase(Uri server)
    {
        var builder = new UriBuilder(server);
        var path = builder.Path.TrimEnd('/');
        foreach (var suffix in new[] { "/Tern", "/dav" })
        {
            if (path.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
            {
                path = path[..^suffix.Length];
                break;
            }
        }
        builder.Path = (path.Length == 0 ? "" : path) + "/api/";
        builder.Query = "";
        builder.Fragment = "";
        return builder.Uri;
    }

    private static Uri BuildServerUri(Uri apiBase)
    {
        var builder = new UriBuilder(apiBase);
        builder.Path = builder.Path.TrimEnd('/');
        if (builder.Path.EndsWith("/api", StringComparison.OrdinalIgnoreCase))
            builder.Path = builder.Path[..^4] + "/Tern";
        return builder.Uri;
    }

    public async Task LoginAsync(CancellationToken cancellationToken = default)
    {
        if (loggedIn) return;
        await loginLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (loggedIn) return;
            var body = JsonSerializer.Serialize(new
            {
                username,
                password,
                remember = true,
            });
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(apiBase, "auth/login"))
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            using var response = await http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            if (response.StatusCode == HttpStatusCode.Unauthorized)
                throw new TernBackendException("unauthorized", "用户名或密码不正确。");
            if (!response.IsSuccessStatusCode)
                throw new TernBackendException("login_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
            loggedIn = true;
        }
        finally
        {
            loginLock.Release();
        }
    }

    private async Task<HttpResponseMessage> SendAuthorizedAsync(
        HttpMethod method,
        Uri uri,
        HttpContent? content,
        CancellationToken cancellationToken)
    {
        await LoginAsync(cancellationToken).ConfigureAwait(false);
        using var request = new HttpRequestMessage(method, uri) { Content = content };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            response.Dispose();
            loggedIn = false;
            await LoginAsync(cancellationToken).ConfigureAwait(false);
            using var retry = new HttpRequestMessage(method, uri) { Content = content };
            retry.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            response = await http.SendAsync(retry, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        }
        return response;
    }

    public async Task<(IReadOnlyList<TernNode> nodes, int cursor)> GetTreeAsync(CancellationToken cancellationToken = default)
    {
        using var response = await SendAuthorizedAsync(
            HttpMethod.Get,
            new Uri(apiBase, "sync/changes?cursor=0"),
            null,
            cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new TernBackendException("tree_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        var snapshot = await JsonSerializer.DeserializeAsync<SyncSnapshot>(stream, Json, cancellationToken).ConfigureAwait(false)
            ?? throw new TernBackendException("invalid_response", "服务器返回了无法解析的文件列表。");
        var nodes = new List<TernNode>();
        foreach (var change in snapshot.Changes)
        {
            if (change.Deleted || string.IsNullOrWhiteSpace(change.Id) || string.IsNullOrWhiteSpace(change.Name))
                continue;
            nodes.Add(new TernNode(
                change.Id,
                change.ParentId,
                change.Name,
                change.Type ?? "file",
                change.Size ?? 0,
                change.Mime,
                change.UpdatedAt,
                change.Etag));
        }
        return (nodes, snapshot.Cursor);
    }

    public async Task<byte[]> DownloadAsync(string nodeId, CancellationToken cancellationToken = default)
    {
        var uri = new Uri(apiBase, "nodes/" + Uri.EscapeDataString(nodeId) + "/content");
        using var response = await SendAuthorizedAsync(HttpMethod.Get, uri, null, cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new TernBackendException("download_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
        return await response.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<HydrationResult> HydrateAsync(
        PlaceholderIdentity identity,
        CancellationToken cancellationToken = default)
    {
        var uri = new Uri(apiBase, "nodes/" + Uri.EscapeDataString(identity.SourceId) + "/content");
        using var response = await SendAuthorizedAsync(HttpMethod.Get, uri, null, cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new TernBackendException("download_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
        var temporary = Path.Combine(Path.GetTempPath(), "tern-" + Guid.NewGuid().ToString("N") + ".bin");
        await using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 20, FileOptions.Asynchronous))
        {
            await response.Content.CopyToAsync(output, cancellationToken).ConfigureAwait(false);
        }
        var info = new FileInfo(temporary);
        return new HydrationResult(temporary, info.Length, string.Empty);
    }

    public async Task<int> WatchAsync(int cursor, CancellationToken cancellationToken = default)
    {
        using var response = await SendAuthorizedAsync(
            HttpMethod.Get,
            new Uri(apiBase, $"sync/watch?cursor={cursor}&timeout=25"),
            null,
            cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new TernBackendException("watch_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        var page = await JsonSerializer.DeserializeAsync<WatchPage>(stream, Json, cancellationToken).ConfigureAwait(false);
        return page?.Cursor ?? cursor;
    }

    public async Task<string> TestAsync(CancellationToken cancellationToken = default)
    {
        await LoginAsync(cancellationToken).ConfigureAwait(false);
        return "服务器可达，登录正常。";
    }

    public async Task<HttpResponseMessage> OpenContentAsync(string nodeId, CancellationToken cancellationToken)
    {
        var uri = new Uri(apiBase, "nodes/" + Uri.EscapeDataString(nodeId) + "/content");
        return await SendAuthorizedAsync(HttpMethod.Get, uri, null, cancellationToken).ConfigureAwait(false);
    }

    public async Task<TernNode> CreateFolderAsync(
        string? parentId,
        string name,
        CancellationToken cancellationToken = default)
    {
        var body = JsonSerializer.Serialize(new
        {
            name,
            parentId,
            clientId = Guid.NewGuid().ToString("N"),
        });
        using var content = new StringContent(body, Encoding.UTF8, "application/json");
        using var response = await SendAuthorizedAsync(
            HttpMethod.Post,
            new Uri(apiBase, "nodes/folder"),
            content,
            cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new TernBackendException("folder_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
        var json = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        using var doc = JsonDocument.Parse(json);
        return ParseNode(doc.RootElement.GetProperty("node"));
    }

    public async Task<TernNode> UploadAsync(
        string? parentId,
        string name,
        byte[] data,
        string mime,
        CancellationToken cancellationToken = default)
    {
        var boundary = "Tern-" + Guid.NewGuid().ToString("N");
        var body = new MemoryStream();
        void Write(string text) => body.Write(Encoding.UTF8.GetBytes(text));
        Write($"--{boundary}\r\n");
        Write($"Content-Disposition: form-data; name=\"files\"; filename=\"{name.Replace("\"", "_")}\"\r\n");
        Write($"Content-Type: {mime}\r\n\r\n");
        body.Write(data);
        Write($"\r\n--{boundary}--\r\n");
        body.Position = 0;
        var query = "clientId=" + Guid.NewGuid().ToString("N");
        if (!string.IsNullOrWhiteSpace(parentId)) query += "&parentId=" + Uri.EscapeDataString(parentId);
        var content = new StreamContent(body);
        content.Headers.ContentType = MediaTypeHeaderValue.Parse("multipart/form-data; boundary=" + boundary);
        using var response = await SendAuthorizedAsync(
            HttpMethod.Post,
            new Uri(apiBase, "nodes/upload?" + query),
            content,
            cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new TernBackendException("upload_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
        var json = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        using var doc = JsonDocument.Parse(json);
        var first = doc.RootElement.GetProperty("items")[0];
        return ParseNode(first);
    }

    public async Task<TernNode> UpdateContentAsync(
        string nodeId,
        byte[] data,
        string? etag,
        CancellationToken cancellationToken = default)
    {
        var content = new ByteArrayContent(data);
        content.Headers.ContentType = MediaTypeHeaderValue.Parse("application/octet-stream");
        using var request = new HttpRequestMessage(HttpMethod.Put, new Uri(apiBase, "nodes/" + Uri.EscapeDataString(nodeId) + "/content"))
        {
            Content = content,
        };
        if (!string.IsNullOrWhiteSpace(etag)) request.Headers.TryAddWithoutValidation("If-Match", etag);
        await LoginAsync(cancellationToken).ConfigureAwait(false);
        var response = await http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            response.Dispose();
            loggedIn = false;
            await LoginAsync(cancellationToken).ConfigureAwait(false);
            using var retry = new HttpRequestMessage(HttpMethod.Put, new Uri(apiBase, "nodes/" + Uri.EscapeDataString(nodeId) + "/content"))
            {
                Content = new ByteArrayContent(data),
            };
            if (!string.IsNullOrWhiteSpace(etag)) retry.Headers.TryAddWithoutValidation("If-Match", etag);
            response = await http.SendAsync(retry, cancellationToken).ConfigureAwait(false);
        }
        using (response)
        {
            if (response.StatusCode == HttpStatusCode.PreconditionFailed)
                throw new TernBackendException("conflict", "服务器上的文件已被修改。");
            if (!response.IsSuccessStatusCode)
                throw new TernBackendException("update_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
            var json = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            return ParseNode(doc.RootElement.GetProperty("node"));
        }
    }

    public async Task DeleteAsync(string nodeId, CancellationToken cancellationToken = default)
    {
        using var response = await SendAuthorizedAsync(
            HttpMethod.Delete,
            new Uri(apiBase, "nodes/" + Uri.EscapeDataString(nodeId)),
            null,
            cancellationToken).ConfigureAwait(false);
        if (response.StatusCode == HttpStatusCode.NotFound) return;
        if (!response.IsSuccessStatusCode)
            throw new TernBackendException("delete_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
    }

    private static TernNode ParseNode(JsonElement node)
    {
        return new TernNode(
            node.GetProperty("id").GetString() ?? "",
            node.TryGetProperty("parentId", out var parent) && parent.ValueKind != JsonValueKind.Null ? parent.GetString() : null,
            node.GetProperty("name").GetString() ?? "",
            node.TryGetProperty("type", out var type) ? type.GetString() ?? "file" : "file",
            node.TryGetProperty("size", out var size) && size.TryGetInt64(out var value) ? value : 0,
            node.TryGetProperty("mime", out var mime) && mime.ValueKind != JsonValueKind.Null ? mime.GetString() : null,
            node.TryGetProperty("updatedAt", out var updated) ? updated.GetString() : null,
            node.TryGetProperty("etag", out var etag) && etag.ValueKind != JsonValueKind.Null ? etag.GetString() : null);
    }

    public async ValueTask DisposeAsync()
    {
        http.Dispose();
        loginLock.Dispose();
        await Task.CompletedTask;
    }

    private sealed record SyncSnapshot(
        [property: JsonPropertyName("cursor")] int Cursor,
        [property: JsonPropertyName("changes")] IReadOnlyList<SyncChange> Changes,
        [property: JsonPropertyName("reset")] bool Reset);

    private sealed record SyncChange(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("parentId")] string? ParentId,
        [property: JsonPropertyName("name")] string? Name,
        [property: JsonPropertyName("type")] string? Type,
        [property: JsonPropertyName("size")] long? Size,
        [property: JsonPropertyName("mime")] string? Mime,
        [property: JsonPropertyName("updatedAt")] string? UpdatedAt,
        [property: JsonPropertyName("etag")] string? Etag,
        [property: JsonPropertyName("deleted")] bool Deleted);

    private sealed record WatchPage(
        [property: JsonPropertyName("cursor")] int Cursor,
        [property: JsonPropertyName("changed")] bool Changed);
}
