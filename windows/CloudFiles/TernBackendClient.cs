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

public sealed record TernChange(TernNode? Node, string Id, bool Deleted);

public sealed record TernChanges(IReadOnlyList<TernChange> Changes, int Cursor, bool Reset, bool HasMore);

public sealed record TernShareInfo(string Url, bool HasPassword, string? ExpiresAt);

public sealed record TernClipboardInfo(string Text, int Version, string? Device, string? UpdatedAt);

public sealed record UploadSessionInfo(string Id, long ChunkSize, int ChunksTotal, int Received);

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

    public async Task<TernChanges> GetChangesAsync(
        int cursor,
        int limit = 1000,
        CancellationToken cancellationToken = default)
    {
        using var response = await SendAuthorizedAsync(
            HttpMethod.Get,
            new Uri(apiBase, $"sync/changes?cursor={cursor}&limit={limit}"),
            null,
            cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new TernBackendException("changes_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        var page = await JsonSerializer.DeserializeAsync<ChangesPage>(stream, Json, cancellationToken).ConfigureAwait(false)
            ?? throw new TernBackendException("invalid_response", "服务器返回了无法解析的同步数据。");
        var changes = new List<TernChange>(page.Changes.Count);
        foreach (var change in page.Changes)
        {
            if (change.Deleted)
            {
                changes.Add(new TernChange(null, change.Id, true));
                continue;
            }
            if (string.IsNullOrWhiteSpace(change.Id) || string.IsNullOrWhiteSpace(change.Name))
                continue;
            changes.Add(new TernChange(new TernNode(
                change.Id,
                change.ParentId,
                change.Name,
                change.Type ?? "file",
                change.Size ?? 0,
                change.Mime,
                change.UpdatedAt,
                change.Etag), change.Id, false));
        }
        return new TernChanges(changes, page.Cursor, page.Reset, page.HasMore ?? false);
    }

    public async Task<TernNode> RenameAsync(
        string nodeId,
        string? name,
        string? parentId,
        bool moveToRoot = false,
        CancellationToken cancellationToken = default)
    {
        object body = moveToRoot
            ? new { name, parentId = (string?)null }
            : new { name, parentId };
        using var content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        using var response = await SendAuthorizedAsync(
            HttpMethod.Patch,
            new Uri(apiBase, "nodes/" + Uri.EscapeDataString(nodeId)),
            content,
            cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new TernBackendException("rename_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
        var json = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        using var doc = JsonDocument.Parse(json);
        return ParseNode(doc.RootElement.GetProperty("node"));
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

    public async Task<TernShareInfo> CreateShareAsync(
        string nodeId,
        string? password,
        int? expiresInHours,
        CancellationToken cancellationToken = default)
    {
        var body = new Dictionary<string, object?> { ["nodeId"] = nodeId };
        if (!string.IsNullOrWhiteSpace(password)) body["password"] = password;
        if (expiresInHours is > 0) body["expiresInHours"] = expiresInHours;
        using var content = new StringContent(
            JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        using var response = await SendAuthorizedAsync(
            HttpMethod.Post,
            new Uri(apiBase, "shares"),
            content,
            cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new TernBackendException("share_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
        var json = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        using var doc = JsonDocument.Parse(json);
        var share = doc.RootElement.GetProperty("share");
        var rawUrl = share.GetProperty("url").GetString() ?? "";
        var url = Uri.TryCreate(rawUrl, UriKind.Absolute, out var absolute)
            ? absolute.ToString()
            : new UriBuilder(ServerUri) { Path = rawUrl, Query = "", Fragment = "" }.Uri.ToString();
        var hasPassword = share.TryGetProperty("hasPassword", out var hp) && hp.GetBoolean();
        var expiresAt = share.TryGetProperty("expiresAt", out var exp) && exp.ValueKind != JsonValueKind.Null
            ? exp.GetString()
            : null;
        return new TernShareInfo(url, hasPassword, expiresAt);
    }

    public async Task<TernClipboardInfo?> GetClipboardAsync(CancellationToken cancellationToken = default)
    {
        using var response = await SendAuthorizedAsync(
            HttpMethod.Get,
            new Uri(apiBase, "clipboard"),
            null,
            cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new TernBackendException("clipboard_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
        var json = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("clipboard", out var clipboard) || clipboard.ValueKind == JsonValueKind.Null)
            return null;
        return ParseClipboard(clipboard);
    }

    public async Task<TernClipboardInfo> PutClipboardAsync(
        string text,
        string? device,
        CancellationToken cancellationToken = default)
    {
        var body = new Dictionary<string, object?> { ["text"] = text };
        if (!string.IsNullOrWhiteSpace(device)) body["device"] = device;
        using var content = new StringContent(
            JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        using var response = await SendAuthorizedAsync(
            HttpMethod.Put,
            new Uri(apiBase, "clipboard"),
            content,
            cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new TernBackendException("clipboard_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
        var json = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        using var doc = JsonDocument.Parse(json);
        return ParseClipboard(doc.RootElement.GetProperty("clipboard"));
    }

    private static TernClipboardInfo ParseClipboard(JsonElement clipboard)
    {
        return new TernClipboardInfo(
            clipboard.GetProperty("text").GetString() ?? "",
            clipboard.TryGetProperty("version", out var version) && version.TryGetInt32(out var v) ? v : 0,
            clipboard.TryGetProperty("device", out var device) && device.ValueKind != JsonValueKind.Null
                ? device.GetString()
                : null,
            clipboard.TryGetProperty("updatedAt", out var updated) && updated.ValueKind != JsonValueKind.Null
                ? updated.GetString()
                : null);
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

    /// Resumable upload of a new file. Existing-file updates stay on the
    /// If-Match content endpoint so conflict detection remains atomic.
    public async Task<TernNode> UploadFileAsync(
        string? parentId,
        string name,
        string localPath,
        string mime,
        CancellationToken cancellationToken = default)
    {
        var info = new FileInfo(localPath);
        if (info.Length < 32L * 1024 * 1024)
        {
            var small = await File.ReadAllBytesAsync(localPath, cancellationToken).ConfigureAwait(false);
            return await UploadAsync(parentId, name, small, mime, cancellationToken).ConfigureAwait(false);
        }

        var session = await CreateUploadSessionAsync(parentId, name, info.Length, cancellationToken).ConfigureAwait(false);
        await using var stream = new FileStream(localPath, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, useAsync: true);
        var buffer = new byte[session.ChunkSize];
        for (var index = 0; index < session.ChunksTotal; index++)
        {
            var offset = (long)index * session.ChunkSize;
            var expected = (int)Math.Min(session.ChunkSize, info.Length - offset);
            stream.Seek(offset, SeekOrigin.Begin);
            var read = 0;
            while (read < expected)
            {
                var chunk = await stream.ReadAsync(buffer.AsMemory(read, expected - read), cancellationToken).ConfigureAwait(false);
                if (chunk == 0) throw new TernBackendException("upload_failed", "读取本地文件时意外结束。");
                read += chunk;
            }
            Exception? last = null;
            for (var attempt = 0; attempt < 3; attempt++)
            {
                try
                {
                    await UploadChunkAsync(session.Id, index, buffer.AsMemory(0, expected), cancellationToken).ConfigureAwait(false);
                    last = null;
                    break;
                }
                catch (Exception exception) when (exception is not OperationCanceledException)
                {
                    last = exception;
                    await Task.Delay(500 * (attempt + 1), cancellationToken).ConfigureAwait(false);
                }
            }
            if (last is not null) throw last;
        }
        return await CompleteUploadSessionAsync(session.Id, cancellationToken).ConfigureAwait(false);
    }

    public async Task<UploadSessionInfo> CreateUploadSessionAsync(
        string? parentId,
        string name,
        long size,
        CancellationToken cancellationToken = default)
    {
        var body = JsonSerializer.Serialize(new { name, size, parentId });
        using var content = new StringContent(body, Encoding.UTF8, "application/json");
        using var response = await SendAuthorizedAsync(
            HttpMethod.Post,
            new Uri(apiBase, "uploads"),
            content,
            cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new TernBackendException("upload_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
        var json = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        using var doc = JsonDocument.Parse(json);
        var upload = doc.RootElement.GetProperty("upload");
        return new UploadSessionInfo(
            upload.GetProperty("id").GetString() ?? "",
            upload.GetProperty("chunkSize").GetInt64(),
            upload.GetProperty("chunksTotal").GetInt32(),
            upload.TryGetProperty("received", out var received) ? received.GetInt32() : 0);
    }

    public async Task UploadChunkAsync(
        string sessionId,
        int index,
        ReadOnlyMemory<byte> data,
        CancellationToken cancellationToken = default)
    {
        using var content = new ByteArrayContent(data.ToArray());
        content.Headers.ContentType = MediaTypeHeaderValue.Parse("application/octet-stream");
        using var response = await SendAuthorizedAsync(
            HttpMethod.Put,
            new Uri(apiBase, "uploads/" + Uri.EscapeDataString(sessionId) + "/chunks/" + index),
            content,
            cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new TernBackendException("upload_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
    }

    public async Task<TernNode> CompleteUploadSessionAsync(
        string sessionId,
        CancellationToken cancellationToken = default)
    {
        using var response = await SendAuthorizedAsync(
            HttpMethod.Post,
            new Uri(apiBase, "uploads/" + Uri.EscapeDataString(sessionId) + "/complete"),
            null,
            cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new TernBackendException("upload_failed", $"服务器返回 HTTP {(int)response.StatusCode}。");
        var json = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        using var doc = JsonDocument.Parse(json);
        return ParseNode(doc.RootElement.GetProperty("node"));
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

    private sealed record ChangesPage(
        [property: JsonPropertyName("cursor")] int Cursor,
        [property: JsonPropertyName("changes")] IReadOnlyList<SyncChange> Changes,
        [property: JsonPropertyName("reset")] bool Reset,
        [property: JsonPropertyName("hasMore")] bool? HasMore);

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
