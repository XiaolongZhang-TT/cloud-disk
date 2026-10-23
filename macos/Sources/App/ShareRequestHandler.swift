//
//  ShareRequestHandler.swift
//  The File Provider action cannot show UI, so it stores a share request in the
//  shared Keychain and posts a Darwin notification. The menu-bar app owns the
//  policy dialog, API call and pasteboard write.
//

import AppKit
import Foundation

private let shareRequestCallback: CFNotificationCallback = { _, _, _, _, _ in
    DispatchQueue.main.async {
        ShareRequestHandler.shared.processPending()
    }
}

@MainActor
final class ShareRequestHandler {
    static let shared = ShareRequestHandler()

    private var observing = false
    private var presenting = false
    private var pollTimer: Timer?

    private init() {}

    func start() {
        guard !observing else { return }
        observing = true
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            shareRequestCallback,
            FileProviderShared.shareRequestNotification as CFString,
            nil,
            .deliverImmediately
        )
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            Task { @MainActor in ShareRequestHandler.shared.processPending() }
        }
        processPending()
    }

    func stop() {
        guard observing else { return }
        CFNotificationCenterRemoveObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            CFNotificationName(FileProviderShared.shareRequestNotification as CFString),
            nil
        )
        observing = false
        pollTimer?.invalidate()
        pollTimer = nil
    }

    func processPending() {
        guard !presenting, let request = FileProviderShared.takeShareRequest() else { return }
        presenting = true
        defer { presenting = false }

        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "分享「\(request.name)」"
        alert.informativeText = "选择这条分享链接的有效期和密码。默认 24 小时、无密码。"
        alert.alertStyle = .informational
        alert.addButton(withTitle: "创建并复制链接")
        alert.addButton(withTitle: "取消")

        let accessory = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 92))
        let passwordLabel = NSTextField(labelWithString: "分享密码（可选）")
        passwordLabel.frame = NSRect(x: 0, y: 66, width: 150, height: 20)
        let passwordField = NSSecureTextField(frame: NSRect(x: 0, y: 38, width: 350, height: 25))
        passwordField.placeholderString = "留空则不需要密码"
        let expiryLabel = NSTextField(labelWithString: "有效期")
        expiryLabel.frame = NSRect(x: 0, y: 12, width: 70, height: 20)
        let expiryPopup = NSPopUpButton(frame: NSRect(x: 76, y: 6, width: 160, height: 26), pullsDown: false)
        let policies: [(String, Int?)] = [
            ("24 小时（默认）", 24),
            ("1 小时", 1),
            ("7 天", 24 * 7),
            ("30 天", 24 * 30),
            ("永久", nil),
        ]
        for (title, hours) in policies {
            expiryPopup.addItem(withTitle: title)
            expiryPopup.lastItem?.representedObject = hours
        }
        expiryPopup.selectItem(at: 0)
        accessory.addSubview(passwordLabel)
        accessory.addSubview(passwordField)
        accessory.addSubview(expiryLabel)
        accessory.addSubview(expiryPopup)
        alert.accessoryView = accessory

        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let password = passwordField.stringValue
        let hours = expiryPopup.selectedItem?.representedObject as? Int
        createShare(nodeId: request.nodeId, name: request.name,
                    password: password.isEmpty ? nil : password,
                    expiresInHours: hours)
    }

    private func createShare(nodeId: String, name: String, password: String?, expiresInHours: Int?) {
        Task {
            do {
                let client = try sharedClient()
                let share = try await client.createShare(nodeId: nodeId, password: password, expiresInHours: expiresInHours)
                let pasteboard = NSPasteboard.general
                pasteboard.clearContents()
                pasteboard.setString(share.url, forType: .string)
                await MainActor.run {
                    presentResult(title: "分享链接已复制",
                                  message: name,
                                  url: share.url,
                                  hasPassword: share.hasPassword)
                }
            } catch {
                await MainActor.run {
                    presentError("创建分享链接失败：\(error.localizedDescription)")
                }
            }
        }
    }

    private func sharedClient() throws -> TernSyncClient {
        guard let config = FileProviderShared.loadConfiguration(),
              let password = FileProviderShared.loadPassword(serverURL: config.serverURL,
                                                             username: config.username) else {
            throw SyncClientError.notConfigured
        }
        return try TernSyncClient(serverURL: config.serverURL,
                                  username: config.username,
                                  password: password)
    }

    private func presentResult(title: String, message: String, url: String, hasPassword: Bool) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = "\(message)\n\(url)\n\n\(hasPassword ? "已设置分享密码" : "无密码公开链接")"
        alert.addButton(withTitle: "好")
        alert.runModal()
    }

    private func presentError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Tern 分享失败"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "好")
        alert.runModal()
    }
}
