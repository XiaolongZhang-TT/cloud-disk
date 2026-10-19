//
//  SettingsStore.swift
//  Tern (Tern) macOS menu-bar client
//
//  Non-secret preferences live in UserDefaults.  The password is NEVER stored
//  here – it lives in the macOS Keychain (see KeychainStore.swift).
//

import Foundation
import Combine

public enum TernDefaults {
    public static let serverURL = "http://127.0.0.1:8080/Tern"
    public static let serverURLKey = "serverURL"
    public static let usernameKey = "username"
    public static let connectAtLoginKey = "connectAtLogin"
    public static let autoConnectKey = "autoConnect"
    public static let lastVersionKey = "lastRunVersion"
}

public final class SettingsStore: ObservableObject {

    public static let shared = SettingsStore()

    @Published public var serverURLText: String
    @Published public var username: String
    @Published public var connectAtLogin: Bool
    @Published public var autoConnect: Bool

    private let defaults = UserDefaults.standard
    private var isLoading = false

    public init() {
        defaults.register(defaults: [
            TernDefaults.serverURLKey: TernDefaults.serverURL,
            TernDefaults.usernameKey: "",
            TernDefaults.connectAtLoginKey: false,
            TernDefaults.autoConnectKey: true,
        ])
        serverURLText = defaults.string(forKey: TernDefaults.serverURLKey) ?? TernDefaults.serverURL
        username = defaults.string(forKey: TernDefaults.usernameKey) ?? ""
        connectAtLogin = defaults.bool(forKey: TernDefaults.connectAtLoginKey)
        autoConnect = defaults.bool(forKey: TernDefaults.autoConnectKey)

        // Keep the SwiftUI bindings and the defaults in sync.
        $serverURLText.dropFirst().sink { [weak self] value in self?.persist(serverURL: value) }.store(in: &cancellables)
        $username.dropFirst().sink { [weak self] value in self?.persist(username: value) }.store(in: &cancellables)
        $connectAtLogin.dropFirst().sink { [weak self] value in self?.persist(connectAtLogin: value) }.store(in: &cancellables)
        $autoConnect.dropFirst().sink { [weak self] value in self?.persist(autoConnect: value) }.store(in: &cancellables)
    }

    private var cancellables = Set<AnyCancellable>()

    private func persist(serverURL: String) {
        guard !isLoading else { return }
        defaults.set(serverURL, forKey: TernDefaults.serverURLKey)
    }

    private func persist(username: String) {
        guard !isLoading else { return }
        defaults.set(username, forKey: TernDefaults.usernameKey)
    }

    private func persist(connectAtLogin: Bool) {
        guard !isLoading else { return }
        defaults.set(connectAtLogin, forKey: TernDefaults.connectAtLoginKey)
    }

    private func persist(autoConnect: Bool) {
        guard !isLoading else { return }
        defaults.set(autoConnect, forKey: TernDefaults.autoConnectKey)
    }

    // MARK: - Validation

    /// Turn whatever the user typed into a WebDAV URL.
    public static func normalize(serverText: String) throws -> URL {
        var text = serverText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            throw SettingsError.emptyServerURL
        }
        if !text.contains("://") {
            text = "http://" + text
        }
        guard var components = URLComponents(string: text) else {
            throw SettingsError.invalidServerURL(text)
        }
        guard let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            throw SettingsError.unsupportedScheme(components.scheme ?? "")
        }
        guard let host = components.host, !host.isEmpty else {
            throw SettingsError.invalidServerURL(text)
        }
        components.scheme = scheme
        // The WebDAV endpoint is /Tern.  If the user only typed a host we
        // append the endpoint so the mounted volume is called “Tern”.
        var path = components.path
        if path.isEmpty || path == "/" {
            path = "/Tern"
        }
        while path.count > 1 && path.hasSuffix("/") { path.removeLast() }
        components.path = path
        components.query = nil
        components.fragment = nil
        guard let url = components.url else {
            throw SettingsError.invalidServerURL(text)
        }
        return url
    }

    public func validatedServerURL() throws -> URL {
        try SettingsStore.normalize(serverText: serverURLText)
    }

    public func validate() throws -> URL {
        let url = try validatedServerURL()
        guard !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw SettingsError.emptyUsername
        }
        return url
    }

    public func reload() {
        isLoading = true
        serverURLText = defaults.string(forKey: TernDefaults.serverURLKey) ?? TernDefaults.serverURL
        username = defaults.string(forKey: TernDefaults.usernameKey) ?? ""
        connectAtLogin = defaults.bool(forKey: TernDefaults.connectAtLoginKey)
        autoConnect = defaults.bool(forKey: TernDefaults.autoConnectKey)
        isLoading = false
    }

    public func snapshot() -> TernSettings {
        TernSettings(serverURLText: serverURLText,
                          username: username,
                          connectAtLogin: connectAtLogin,
                          autoConnect: autoConnect)
    }
}

public struct TernSettings: Equatable {
    public var serverURLText: String
    public var username: String
    public var connectAtLogin: Bool
    public var autoConnect: Bool
}

public enum SettingsError: LocalizedError, Equatable {
    case emptyServerURL
    case invalidServerURL(String)
    case unsupportedScheme(String)
    case emptyUsername
    case keychain(String)

    public var errorDescription: String? {
        switch self {
        case .emptyServerURL:
            return "请填写服务器地址，例如 http://192.168.1.10:8080/Tern"
        case .invalidServerURL(let text):
            return "服务器地址格式不正确：“\(text)”"
        case .unsupportedScheme(let scheme):
            return "不支持的协议“\(scheme)”。请使用 http://（局域网）或 https://（公网/反代）。"
        case .emptyUsername:
            return "请填写用户名（与 Tern 网页登录账号相同）。"
        case .keychain(let message):
            return message
        }
    }
}
