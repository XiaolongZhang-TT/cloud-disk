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
}

public struct TernSyncPage: Codable, Sendable {
    public var reset: Bool
    public var cursor: Int
    public var changes: [TernChange]
    public var hasMore: Bool?
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
        let url = apiBase.appendingPathComponent("auth/login")
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
        var components = URLComponents(url: apiBase.appendingPathComponent("sync/changes"), resolvingAgainstBaseURL: false)!
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
