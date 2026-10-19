//
//  KeychainStore.swift
//  CloudDisk (云屿) macOS menu-bar client
//
//  Passwords are stored in the login Keychain as generic password items, keyed
//  by service + "username@host:port".  They are never written to UserDefaults,
//  never included in logs and never placed on a command line by the app.
//

import Foundation
import Security

public enum KeychainStore {

    public static let service = "com.clouddisk.menubar"

    /// Stable account key for one server + user pair.  The URL path is
    /// intentionally ignored so switching between /CloudDisk and /dav (or
    /// adding a reverse-proxy prefix) keeps the saved password.
    public static func account(serverURL: URL, username: String) -> String {
        let host = serverURL.host?.lowercased() ?? "unknown-host"
        let scheme = (serverURL.scheme ?? "http").lowercased()
        let port = serverURL.port ?? (scheme == "https" ? 443 : 80)
        return "\(username)@\(host):\(port)"
    }

    // MARK: - Public API

    @discardableResult
    public static func savePassword(_ password: String, serverURL: URL, username: String) throws -> Bool {
        guard !password.isEmpty else { throw KeychainError.emptyPassword }
        let account = account(serverURL: serverURL, username: username)
        let data = Data(password.utf8)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrLabel as String: "CloudDisk 密码（\(account)）",
            kSecAttrDescription as String: "CloudDisk WebDAV 登录密码",
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            CDLog.info("keychain: updated password for \(account)")
            return true
        }
        if updateStatus != errSecItemNotFound {
            throw KeychainError.status(updateStatus, operation: "更新")
        }

        var addQuery = query
        addQuery.merge(attributes) { _, new in new }
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainError.status(addStatus, operation: "写入")
        }
        CDLog.info("keychain: stored password for \(account)")
        return true
    }

    public static func loadPassword(serverURL: URL, username: String) -> String? {
        let account = account(serverURL: serverURL, username: username)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else {
            if status != errSecItemNotFound && status != errSecUserCanceled {
                CDLog.warn("keychain: read failed for \(account): OSStatus \(status)")
            }
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    public static func hasPassword(serverURL: URL, username: String) -> Bool {
        loadPassword(serverURL: serverURL, username: username) != nil
    }

    @discardableResult
    public static func deletePassword(serverURL: URL, username: String) -> Bool {
        let account = account(serverURL: serverURL, username: username)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess {
            CDLog.info("keychain: deleted password for \(account)")
            return true
        }
        if status != errSecItemNotFound {
            CDLog.warn("keychain: delete failed for \(account): OSStatus \(status)")
        }
        return status == errSecSuccess
    }

    public static func deleteAllPasswords() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        SecItemDelete(query as CFDictionary)
        CDLog.info("keychain: deleted all CloudDisk passwords")
    }
}

public enum KeychainError: LocalizedError, Equatable {
    case emptyPassword
    case status(OSStatus, operation: String)

    public var errorDescription: String? {
        switch self {
        case .emptyPassword:
            return "密码不能为空。"
        case .status(let status, let operation):
            return "\(operation)钥匙串失败（OSStatus \(status)）：\(KeychainError.describe(status))"
        }
    }

    public static func describe(_ status: OSStatus) -> String {
        switch status {
        case errSecAuthFailed: return "认证失败，请允许 CloudDisk 访问钥匙串。"
        case errSecUserCanceled: return "操作已取消。"
        case errSecInteractionNotAllowed: return "钥匙串已锁定，请解锁登录钥匙串后重试。"
        case errSecDuplicateItem: return "钥匙串中已存在相同条目。"
        case errSecItemNotFound: return "钥匙串中没有该条目。"
        case errSecMissingEntitlement: return "缺少钥匙串访问权限（ad-hoc 签名应用可能遇到）。"
        default:
            if let message = SecCopyErrorMessageString(status, nil) as String? {
                return message
            }
            return "未知错误。"
        }
    }
}
