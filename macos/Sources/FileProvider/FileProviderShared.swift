//
//  FileProviderShared.swift
//  Shared between the menu-bar app and the File Provider extension.
//
//  The app group holds non-secret connection metadata; the password lives in
//  the shared Keychain access group.  Files are sandboxed per target.
//

import Foundation
import Security

public enum FileProviderShared {

    public static let appGroup = "group.com.tern.menubar"
    public static let domainIdentifier = "com.tern.menubar.fileprovider"
    public static let keychainService = "com.tern.menubar.fileprovider"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }

    // MARK: - Connection metadata

    public static func saveConfiguration(serverURL: URL, username: String) {
        guard let defaults else { return }
        defaults.set(serverURL.absoluteString, forKey: "serverURL")
        defaults.set(username, forKey: "username")
    }

    public static func loadConfiguration() -> (serverURL: URL, username: String)? {
        guard let defaults,
              let text = defaults.string(forKey: "serverURL"),
              let url = URL(string: text),
              let username = defaults.string(forKey: "username"),
              !username.isEmpty else { return nil }
        return (url, username)
    }

    public static func clearConfiguration() {
        guard let defaults else { return }
        defaults.removeObject(forKey: "serverURL")
        defaults.removeObject(forKey: "username")
    }

    // MARK: - Keychain

    /// The access group is declared in both entitlements files.  At runtime the
    /// team identifier prefix is resolved from the code signature; ad-hoc
    /// builds have no such entitlement and stay isolated.
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
        let account = account(serverURL: serverURL, username: username)
        let data = Data(password.utf8)
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
        ]
        if let group = sharedAccessGroup() {
            query[kSecAttrAccessGroup as String] = group
        }

        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrLabel as String: "Tern File Provider (\(account))",
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        let update = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if update == errSecSuccess { return true }
        if update != errSecItemNotFound { return false }

        var addQuery = query
        addQuery.merge(attributes) { _, new in new }
        return SecItemAdd(addQuery as CFDictionary, nil) == errSecSuccess
    }

    public static func loadPassword(serverURL: URL, username: String) -> String? {
        let account = account(serverURL: serverURL, username: username)
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        if let group = sharedAccessGroup() {
            query[kSecAttrAccessGroup as String] = group
        }
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    public static func deletePassword(serverURL: URL, username: String) -> Bool {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account(serverURL: serverURL, username: username),
        ]
        if let group = sharedAccessGroup() {
            query[kSecAttrAccessGroup as String] = group
        }
        return SecItemDelete(query as CFDictionary) == errSecSuccess
    }
}
