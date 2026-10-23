//
//  FileProviderShared.swift
//  Shared between the menu-bar app and the File Provider extension.
//
//  A free Personal Team cannot provision App Groups, so connection metadata,
//  sync status and pinned items live in small shared Keychain items instead.
//  File contents and the metadata cache stay inside the extension container.
//

import Foundation
import Security

public enum FileProviderShared {

    public static let domainIdentifier = "com.tern.menubar.fileprovider.offline2"
    public static let keychainService = "com.tern.menubar.fileprovider"
    private static let configService = "com.tern.menubar.fileprovider.config"
    private static let statusService = "com.tern.menubar.fileprovider.status"
    private static let pinnedService = "com.tern.menubar.fileprovider.pinned"

    private struct Configuration: Codable {
        let serverURL: String
        let username: String
    }

    private struct Status: Codable {
        let pending: Int
        let error: String?
        let lastSync: Double?
    }

    // MARK: - Connection metadata

    public static func saveConfiguration(serverURL: URL, username: String) {
        let value = Configuration(serverURL: serverURL.absoluteString, username: username)
        guard let data = try? JSONEncoder().encode(value) else { return }
        _ = write(data, service: configService, account: "config")
    }

    public static func loadConfiguration() -> (serverURL: URL, username: String)? {
        guard let data = read(service: configService, account: "config"),
              let value = try? JSONDecoder().decode(Configuration.self, from: data),
              let url = URL(string: value.serverURL),
              !value.username.isEmpty else { return nil }
        return (url, value.username)
    }

    public static func clearConfiguration() {
        delete(service: configService, account: "config")
    }

    // MARK: - Sync status

    public static func updateSyncStatus(pending: Int, error: String?) {
        let status = Status(pending: pending, error: error, lastSync: Date().timeIntervalSince1970)
        guard let data = try? JSONEncoder().encode(status) else { return }
        _ = write(data, service: statusService, account: "status")
    }

    public static func syncStatus() -> (pending: Int, error: String?, lastSync: Date?) {
        guard let data = read(service: statusService, account: "status"),
              let status = try? JSONDecoder().decode(Status.self, from: data) else {
            return (0, nil, nil)
        }
        return (status.pending, status.error, status.lastSync.map(Date.init(timeIntervalSince1970:)))
    }

    // MARK: - Keep downloaded

    public static func isPinned(_ itemIdentifier: String) -> Bool {
        pinnedItems().contains(itemIdentifier)
    }

    public static func setPinned(_ pinned: Bool, itemIdentifier: String) {
        var items = Set(pinnedItems())
        if pinned { items.insert(itemIdentifier) } else { items.remove(itemIdentifier) }
        guard let data = try? JSONEncoder().encode(Array(items)) else { return }
        _ = write(data, service: pinnedService, account: "pinned")
    }

    private static func pinnedItems() -> [String] {
        guard let data = read(service: pinnedService, account: "pinned"),
              let items = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        return items
    }

    // MARK: - Password

    private static func sharedAccessGroup() -> String? {
        guard let task = SecTaskCreateFromSelf(nil) else { return nil }
        let value = SecTaskCopyValueForEntitlement(
            task,
            "keychain-access-groups" as CFString,
            nil
        ) as? [String]
        return value?.first(where: { $0.hasSuffix(".shared") })
    }

    private static func account(serverURL: URL, username: String) -> String {
        let host = serverURL.host?.lowercased() ?? "unknown-host"
        let port = serverURL.port ?? (serverURL.scheme == "https" ? 443 : 80)
        return "\(username)@\(host):\(port)"
    }

    @discardableResult
    public static func savePassword(_ password: String, serverURL: URL, username: String) -> Bool {
        write(Data(password.utf8), service: keychainService, account: account(serverURL: serverURL, username: username))
    }

    public static func loadPassword(serverURL: URL, username: String) -> String? {
        guard let data = read(service: keychainService, account: account(serverURL: serverURL, username: username)) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    public static func deletePassword(serverURL: URL, username: String) -> Bool {
        delete(service: keychainService, account: account(serverURL: serverURL, username: username))
    }

    // MARK: - Keychain helpers

    private static func query(service: String, account: String) -> [String: Any] {
        var value: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group = sharedAccessGroup() {
            value[kSecAttrAccessGroup as String] = group
        }
        return value
    }

    private static func read(service: String, account: String) -> Data? {
        var value = query(service: service, account: account)
        value[kSecReturnData as String] = true
        value[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(value as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }

    @discardableResult
    private static func write(_ data: Data, service: String, account: String) -> Bool {
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        let base = query(service: service, account: account)
        let update = SecItemUpdate(base as CFDictionary, attributes as CFDictionary)
        if update == errSecSuccess { return true }
        if update != errSecItemNotFound { return false }
        var add = base
        add.merge(attributes) { _, new in new }
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    @discardableResult
    private static func delete(service: String, account: String) -> Bool {
        SecItemDelete(query(service: service, account: account) as CFDictionary) == errSecSuccess
    }
}
