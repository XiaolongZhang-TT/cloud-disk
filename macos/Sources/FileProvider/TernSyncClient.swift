//
//  TernSyncClient.swift
//  Minimal REST client used by the File Provider extension.
//
//  The extension does not use WebDAV: the sync endpoint gives it a cursor and
//  tombstones, which is what File Provider needs for incremental updates.
//

import Foundation

public struct TernChange: Codable, Sendable {
    public var seq: Int?
    public var id: String
    public var parentId: String?
    public var name: String?
    public var type: String?
    public var size: Int64?
    public var mime: String?
    public var starred: Bool?
    public var createdAt: String?
    public var updatedAt: String?
    public var etag: String?
    public var deleted: Bool

    public var isFolder: Bool { type == "folder" }
    public var isDeleted: Bool { deleted }

    private enum CodingKeys: String, CodingKey {
        case seq, id, parentId, name, type, size, mime, starred, createdAt, updatedAt, etag, deleted
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        seq = try c.decodeIfPresent(Int.self, forKey: .seq)
        id = try c.decode(String.self, forKey: .id)
        parentId = try c.decodeIfPresent(String.self, forKey: .parentId)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        type = try c.decodeIfPresent(String.self, forKey: .type)
        size = try c.decodeIfPresent(Int64.self, forKey: .size)
        mime = try c.decodeIfPresent(String.self, forKey: .mime)
        starred = try c.decodeIfPresent(Bool.self, forKey: .starred)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
        etag = try c.decodeIfPresent(String.self, forKey: .etag)
        deleted = try c.decodeIfPresent(Bool.self, forKey: .deleted) ?? false
    }
}

public struct TernSyncPage: Codable, Sendable {
    public var reset: Bool
    public var cursor: Int
    public var changes: [TernChange]
    public var hasMore: Bool?
}

public struct TernWatchPage: Codable, Sendable {
    public var cursor: Int
    public var changed: Bool
}

public struct TernShare: Codable, Sendable {
    public var id: String
    public var url: String
    public var hasPassword: Bool
    public var expiresAt: String?
}

public struct TernUploadSession: Codable, Sendable {
    public var id: String
    public var chunkSize: Int
    public var chunksTotal: Int
    public var received: Int
}

public struct TernClipboard: Codable, Sendable {
    public var text: String
    public var version: Int
    public var device: String?
    public var updatedAt: String
}

public enum SyncClientError: LocalizedError {
    case notConfigured
    case invalidServerURL
    case http(Int, String)
    case malformedResponse
    case invalidItem

    public var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Tern 尚未配置。请先打开菜单栏 Tern 并保存服务器和密码。"
        case .invalidServerURL:
            return "服务器地址无效。"
        case .http(let code, let message):
            return "服务器返回 HTTP \(code)：\(message)"
        case .malformedResponse:
            return "服务器返回了无法解析的数据。"
        case .invalidItem:
            return "服务器返回了无效的文件条目。"
        }
    }
}

public final class TernSyncClient: @unchecked Sendable {

    private let serverURL: URL
    private let username: String
    private let password: String
    private let apiBase: URL
    private let session: URLSession
    private let lock = NSLock()
    private var loggedIn = false

    public init(serverURL: URL, username: String, password: String) throws {
        guard let apiBase = TernSyncClient.apiBase(for: serverURL) else {
            throw SyncClientError.invalidServerURL
        }
        self.serverURL = serverURL
        self.username = username
        self.password = password
        self.apiBase = apiBase

        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = HTTPCookieStorage.shared
        configuration.httpShouldSetCookies = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 120
        self.session = URLSession(configuration: configuration)
    }

    /// Derive `/api` from the user-facing WebDAV URL.  A reverse proxy prefix
    /// such as `https://host/cloud/Tern` becomes `https://host/cloud/api`.
    private static func apiBase(for serverURL: URL) -> URL? {
        guard var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        var path = components.path
        for suffix in ["/Tern", "/dav"] where path.hasSuffix(suffix) {
            path.removeLast(suffix.count)
            break
        }
        while path.count > 1 && path.hasSuffix("/") { path.removeLast() }
        components.path = (path.isEmpty ? "" : path) + "/api"
        components.query = nil
        components.fragment = nil
        return components.url
    }

    // MARK: - Auth

    private func login() async throws {
        let url = apiBase.appendingPathComponent("auth").appendingPathComponent("login")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "username": username,
            "password": password,
            "remember": true,
        ])

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SyncClientError.malformedResponse
        }
        guard http.statusCode == 200 else {
            throw SyncClientError.http(http.statusCode, Self.errorMessage(data))
        }
        lock.lock()
        loggedIn = true
        lock.unlock()
    }

    private func ensureLoggedIn() async throws {
        lock.lock()
        let ready = loggedIn
        lock.unlock()
        if !ready { try await login() }
    }

    private func withAuth(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        try await ensureLoggedIn()
        var (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SyncClientError.malformedResponse
        }
        if http.statusCode == 401 {
            lock.lock()
            loggedIn = false
            lock.unlock()
            try await login()
            (data, response) = try await session.data(for: request)
            guard let retried = response as? HTTPURLResponse else {
                throw SyncClientError.malformedResponse
            }
            return (data, retried)
        }
        return (data, http)
    }

    // MARK: - Sync

    public func sync(cursor: Int) async throws -> TernSyncPage {
        var components = URLComponents(url: apiBase.appendingPathComponent("sync").appendingPathComponent("changes"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "cursor", value: String(cursor)),
            URLQueryItem(name: "limit", value: "1000"),
        ]
        var request = URLRequest(url: components.url!)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, http) = try await withAuth(request)
        guard http.statusCode == 200 else {
            throw SyncClientError.http(http.statusCode, Self.errorMessage(data))
        }
        do {
            return try JSONDecoder().decode(TernSyncPage.self, from: data)
        } catch {
            throw SyncClientError.malformedResponse
        }
    }

    // MARK: - Long poll

    /// Long-poll the server for a change after `cursor`.
    ///
    /// Without a cursor the server returns its current head immediately. The
    /// caller can then repeatedly call this with that cursor and will only be
    /// woken when another client changes the tree (or after the server-side
    /// timeout). This is deliberately a plain HTTP request: no WebSocket or
    /// WebDAV dependency, and it works through a normal reverse proxy.
    public func watch(cursor: Int?, timeout: Int = 25) async throws -> TernWatchPage {
        var components = URLComponents(url: apiBase.appendingPathComponent("sync").appendingPathComponent("watch"), resolvingAgainstBaseURL: false)!
        var query: [URLQueryItem] = []
        if let cursor { query.append(URLQueryItem(name: "cursor", value: String(cursor))) }
        query.append(URLQueryItem(name: "timeout", value: String(max(1, min(timeout, 25)))))
        components.queryItems = query
        var request = URLRequest(url: components.url!)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, http) = try await withAuth(request)
        guard http.statusCode == 200 else {
            throw SyncClientError.http(http.statusCode, Self.errorMessage(data))
        }
        do {
            return try JSONDecoder().decode(TernWatchPage.self, from: data)
        } catch {
            throw SyncClientError.malformedResponse
        }
    }

    // MARK: - Sharing

    public func createShare(nodeId: String, password: String?, expiresInHours: Int?) async throws -> TernShare {
        var body: [String: Any] = ["nodeId": nodeId]
        if let password, !password.isEmpty { body["password"] = password }
        if let expiresInHours { body["expiresInHours"] = expiresInHours }
        var request = URLRequest(url: apiBase.appendingPathComponent("shares"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, http) = try await withAuth(request)
        guard http.statusCode == 201 || http.statusCode == 200 else {
            throw SyncClientError.http(http.statusCode, Self.errorMessage(data))
        }
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rawShare = root["share"],
              let shareData = try? JSONSerialization.data(withJSONObject: rawShare) else {
            throw SyncClientError.malformedResponse
        }
        var share = try JSONDecoder().decode(TernShare.self, from: shareData)
        share.url = absoluteShareURL(share.url).absoluteString
        return share
    }

    private func absoluteShareURL(_ raw: String) -> URL {
        if let url = URL(string: raw), url.scheme != nil { return url }
        var components = URLComponents()
        components.scheme = serverURL.scheme
        components.host = serverURL.host
        components.port = serverURL.port
        components.path = raw.hasPrefix("/") ? raw : "/" + raw
        return components.url ?? serverURL
    }

    // MARK: - Clipboard

    public func getClipboard() async throws -> TernClipboard? {
        var request = URLRequest(url: apiBase.appendingPathComponent("clipboard"))
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, http) = try await withAuth(request)
        guard http.statusCode == 200 else {
            throw SyncClientError.http(http.statusCode, Self.errorMessage(data))
        }
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw SyncClientError.malformedResponse
        }
        guard let raw = root["clipboard"] as? [String: Any] else { return nil }
        let rawData = try JSONSerialization.data(withJSONObject: raw)
        return try JSONDecoder().decode(TernClipboard.self, from: rawData)
    }

    @discardableResult
    public func putClipboard(text: String, device: String?) async throws -> TernClipboard {
        var body: [String: Any] = ["text": text]
        if let device, !device.isEmpty { body["device"] = device }
        var request = URLRequest(url: apiBase.appendingPathComponent("clipboard"))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, http) = try await withAuth(request)
        guard http.statusCode == 200 else {
            throw SyncClientError.http(http.statusCode, Self.errorMessage(data))
        }
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let raw = root["clipboard"] as? [String: Any] else {
            throw SyncClientError.malformedResponse
        }
        let rawData = try JSONSerialization.data(withJSONObject: raw)
        return try JSONDecoder().decode(TernClipboard.self, from: rawData)
    }

    // MARK: - Contents

    public func fetchFile(id: String) async throws -> (data: Data, contentType: String?) {
        let url = apiBase.appendingPathComponent("nodes").appendingPathComponent(id).appendingPathComponent("content")
        var request = URLRequest(url: url)
        request.setValue("application/octet-stream", forHTTPHeaderField: "Accept")
        let (data, http) = try await withAuth(request)
        guard http.statusCode == 200 else {
            throw SyncClientError.http(http.statusCode, Self.errorMessage(data))
        }
        return (data, http.value(forHTTPHeaderField: "Content-Type"))
    }

    // MARK: - Writes

    public func createFolder(parentId: String?, name: String, clientId: String) async throws -> TernChange {
        var body: [String: Any] = ["name": name, "clientId": clientId]
        if let parentId { body["parentId"] = parentId }
        let request = try jsonRequest(path: "nodes/folder", method: "POST", object: body)
        let (data, http) = try await withAuth(request)
        guard http.statusCode == 201 else {
            throw SyncClientError.http(http.statusCode, Self.errorMessage(data))
        }
        return try decodeNode(data)
    }

    /// Large new files use the resumable upload API; updates still use the
    /// If-Match content endpoint so conflict detection remains atomic.
    public func uploadFileResumable(parentId: String?, name: String, data: Data, mime: String) async throws -> TernChange {
        var body: [String: Any] = ["name": name, "size": data.count]
        if let parentId { body["parentId"] = parentId }
        var request = URLRequest(url: apiBase.appendingPathComponent("uploads"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (createdData, createdHTTP) = try await withAuth(request)
        guard createdHTTP.statusCode == 201 || createdHTTP.statusCode == 200 else {
            throw SyncClientError.http(createdHTTP.statusCode, Self.errorMessage(createdData))
        }
        guard let createdRoot = try? JSONSerialization.jsonObject(with: createdData) as? [String: Any],
              let rawSession = createdRoot["upload"],
              let sessionData = try? JSONSerialization.data(withJSONObject: rawSession) else {
            throw SyncClientError.malformedResponse
        }
        let session = try JSONDecoder().decode(TernUploadSession.self, from: sessionData)

        for index in 0..<session.chunksTotal {
            let start = index * session.chunkSize
            let end = min(data.count, start + session.chunkSize)
            let chunk = data.subdata(in: start..<end)
            var lastError: Error?
            for attempt in 0..<3 {
                do {
                    var chunkRequest = URLRequest(url: apiBase
                        .appendingPathComponent("uploads")
                        .appendingPathComponent(session.id)
                        .appendingPathComponent("chunks")
                        .appendingPathComponent(String(index)))
                    chunkRequest.httpMethod = "PUT"
                    chunkRequest.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
                    chunkRequest.httpBody = chunk
                    let (_, chunkHTTP) = try await withAuth(chunkRequest)
                    guard (200..<300).contains(chunkHTTP.statusCode) else {
                        throw SyncClientError.http(chunkHTTP.statusCode, "上传分片失败")
                    }
                    lastError = nil
                    break
                } catch {
                    lastError = error
                    if attempt < 2 { try? await Task.sleep(nanoseconds: UInt64(500_000_000 * (attempt + 1))) }
                }
            }
            if let lastError { throw lastError }
        }

        var complete = URLRequest(url: apiBase
            .appendingPathComponent("uploads")
            .appendingPathComponent(session.id)
            .appendingPathComponent("complete"))
        complete.httpMethod = "POST"
        complete.setValue("application/json", forHTTPHeaderField: "Accept")
        let (dataOut, completeHTTP) = try await withAuth(complete)
        guard completeHTTP.statusCode == 201 || completeHTTP.statusCode == 200 else {
            throw SyncClientError.http(completeHTTP.statusCode, Self.errorMessage(dataOut))
        }
        return try decodeNode(dataOut)
    }

    public func uploadFile(parentId: String?, name: String, clientId: String, data: Data, mime: String) async throws -> TernChange {
        var components = URLComponents(url: apiBase.appendingPathComponent("nodes").appendingPathComponent("upload"), resolvingAgainstBaseURL: false)!
        var query = [URLQueryItem(name: "clientId", value: clientId)]
        if let parentId { query.append(URLQueryItem(name: "parentId", value: parentId)) }
        components.queryItems = query

        let boundary = "TernBoundary-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"files\"; filename=\"\(name.replacingOccurrences(of: "\"", with: "_"))\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = body

        let (responseData, http) = try await withAuth(request)
        guard http.statusCode == 201 else {
            throw SyncClientError.http(http.statusCode, Self.errorMessage(responseData))
        }
        guard let object = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any],
              let items = object["items"] as? [[String: Any]],
              let first = items.first,
              let itemData = try? JSONSerialization.data(withJSONObject: first) else {
            throw SyncClientError.malformedResponse
        }
        return try JSONDecoder().decode(TernChange.self, from: itemData)
    }

    public func updateContent(id: String, data: Data, ifMatch: String?) async throws -> TernChange {
        let url = apiBase.appendingPathComponent("nodes").appendingPathComponent(id).appendingPathComponent("content")
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let ifMatch, !ifMatch.isEmpty { request.setValue(ifMatch, forHTTPHeaderField: "If-Match") }
        request.httpBody = data
        let (responseData, http) = try await withAuth(request)
        guard http.statusCode == 200 else {
            throw SyncClientError.http(http.statusCode, Self.errorMessage(responseData))
        }
        return try decodeNode(responseData)
    }

    public func renameMove(id: String, name: String?, parentId: String?, moveToRoot: Bool = false, ifMatch: String?) async throws -> TernChange {
        var body: [String: Any] = [:]
        if let name { body["name"] = name }
        if moveToRoot {
            body["parentId"] = NSNull()
        } else if let parentId {
            body["parentId"] = parentId
        }
        let url = apiBase.appendingPathComponent("nodes").appendingPathComponent(id)
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let ifMatch, !ifMatch.isEmpty { request.setValue(ifMatch, forHTTPHeaderField: "If-Match") }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (responseData, http) = try await withAuth(request)
        guard http.statusCode == 200 else {
            throw SyncClientError.http(http.statusCode, Self.errorMessage(responseData))
        }
        guard let object = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any],
              let node = object["node"],
              let data = try? JSONSerialization.data(withJSONObject: node) else {
            throw SyncClientError.malformedResponse
        }
        return try JSONDecoder().decode(TernChange.self, from: data)
    }

    public func delete(id: String) async throws {
        let url = apiBase.appendingPathComponent("nodes").appendingPathComponent(id)
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, http) = try await withAuth(request)
        guard http.statusCode == 200 else {
            throw SyncClientError.http(http.statusCode, Self.errorMessage(data))
        }
    }

    private func jsonRequest(path: String, method: String, object: [String: Any]) throws -> URLRequest {
        var url = apiBase
        for component in path.split(separator: "/") { url = url.appendingPathComponent(String(component)) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: object)
        return request
    }

    private func decodeNode(_ data: Data) throws -> TernChange {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let node = object["node"],
              let nodeData = try? JSONSerialization.data(withJSONObject: node) else {
            throw SyncClientError.malformedResponse
        }
        return try JSONDecoder().decode(TernChange.self, from: nodeData)
    }

    // MARK: - Helpers

    private static func errorMessage(_ data: Data) -> String {
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let error = object["error"] as? [String: Any],
           let message = error["message"] as? String {
            return message
        }
        if let text = String(data: data, encoding: .utf8), !text.isEmpty {
            return String(text.prefix(300))
        }
        return "未知错误"
    }
}
