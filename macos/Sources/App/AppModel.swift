//
//  AppModel.swift
//  Tern (Tern) macOS menu-bar client
//
//  Owns the connection state machine.  Every NetFS / Keychain / launchctl
//  call is blocking, so it is always executed off the main thread and the
//  result is applied back on the main actor.
//

import Foundation
import AppKit
import Combine
import Network

@MainActor
public final class AppModel: ObservableObject {

    public static let shared = AppModel()

    public enum Status: Equatable {
        case disconnected
        case connecting
        case connected
        case disconnecting
        case failed(String)

        public var isConnected: Bool { self == .connected }
    }

    // MARK: - Published state

    @Published public private(set) var status: Status = .disconnected
    @Published public private(set) var volumePath: String?
    @Published public private(set) var mountDate: Date?
    @Published public private(set) var reachability: ServerReachability?
    @Published public private(set) var lastError: String?
    @Published public private(set) var staleMountPath: String?
    @Published public private(set) var isBusy = false
    @Published public private(set) var credentialsReady = false

    public let settings: SettingsStore

    // MARK: - Private state

    private var pollTask: Task<Void, Never>?
    private var tickCount = 0
    private var healthInFlight = false
    private var cachedPassword: String?
    private var cachedCredentialKey: String?
    private var started = false
    private let pathMonitor = NWPathMonitor()
    private let pathQueue = DispatchQueue(label: "com.tern.menubar.network")
    private var networkMonitorStarted = false
    private var lastNetworkOnline: Bool?
    private let fileProviderWatcher = FileProviderWatcher()

    private init(settings: SettingsStore = SettingsStore.shared) {
        self.settings = settings
    }

    // MARK: - Derived UI strings

    public var menuBarSymbol: String {
        switch status {
        case .connected: return "cloud.fill"
        case .connecting, .disconnecting: return "arrow.triangle.2.circlepath"
        case .failed: return "cloud"
        case .disconnected: return "cloud"
        }
    }

    public var statusHeadline: String {
        switch status {
        case .connected:
            return "已连接 · \(MountClient.volumeName(for: currentServerURL ?? fallbackURL))"
        case .connecting:
            return "正在连接服务器…"
        case .disconnecting:
            return "正在断开连接…"
        case .failed:
            return "连接失败"
        case .disconnected:
            return "未连接"
        }
    }

    public var statusDetail: String? {
        switch status {
        case .connected:
            if let volumePath = volumePath { return "挂载点：\(volumePath)" }
            return "挂载点：\(expectedMountPath)"
        case .connecting, .disconnecting:
            return currentServerURL?.absoluteString
        case .failed(let message):
            return message
        case .disconnected:
            return currentServerURL?.absoluteString
        }
    }

    public var serverURLText: String {
        currentServerURL?.absoluteString ?? settings.serverURLText
    }

    public var volumeName: String {
        MountClient.volumeName(for: currentServerURL ?? fallbackURL)
    }

    public var expectedMountPath: String {
        MountClient.expectedMountPath(for: currentServerURL ?? fallbackURL)
    }

    public var canConnect: Bool {
        switch status {
        case .connected, .connecting, .disconnecting: return false
        case .disconnected, .failed: return true
        }
    }

    public var canDisconnect: Bool { status == .connected }

    public var didFail: Bool {
        if case .failed = status { return true }
        return false
    }

    public var onlineText: String {
        if let reachability = reachability { return reachability.displayText }
        return "状态未知"
    }

    public var onlineIndicator: String {
        if let reachability = reachability, reachability.isOnline { return "● 在线" }
        return "○ 离线/未知"
    }

    private var fallbackURL: URL {
        (try? SettingsStore.normalize(serverText: TernDefaults.serverURL))
            ?? URL(string: TernDefaults.serverURL)!
    }

    private var currentServerURL: URL? {
        try? settings.validatedServerURL()
    }

    // MARK: - Lifecycle

    public func start() {
        guard !started else { return }
        started = true
        CDLog.info("app: start \(TernInfo.versionDescription) bundle=\(Bundle.main.bundleURL.path)")

        // Repair a login item whose plist points at an old location after the
        // app was moved (for example into /Applications).
        LaunchAgentManager.repairIfInstalled(appURL: Bundle.main.bundleURL)
        settings.connectAtLogin = LaunchAgentManager.isInstalled()

        recoverMountState()
        refreshCredentialState()
        startNetworkMonitor()
        startPolling()
        fileProviderWatcher.start()

        // A previously configured File Provider domain is re-registered from
        // the real GUI app process (not a CLI helper) so macOS treats it as a
        // replicated NSFileProviderReplicatedExtension domain.
        if FileProviderShared.loadConfiguration() != nil {
            Task { [weak self] in
                guard self != nil else { return }
                do {
                    try await FileProviderBridge.addDomain()
                    CDLog.info("fileprovider: domain registered on launch")
                } catch {
                    CDLog.warn("fileprovider: launch registration failed: \(error.localizedDescription)")
                }
            }
        }

        if settings.autoConnect {
            let hasUser = !settings.username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            if hasUser && status != .connected {
                Task { [weak self] in
                    try? await Task.sleep(nanoseconds: 900_000_000)
                    guard let self = self, self.status != .connected else { return }
                    self.connect(userInitiated: false)
                }
            }
        }
    }

    public func shutdown() {
        fileProviderWatcher.stop()
        pollTask?.cancel()
        pollTask = nil
        if networkMonitorStarted {
            pathMonitor.cancel()
            networkMonitorStarted = false
        }
        CDLog.info("app: shutdown")
    }

    private func startNetworkMonitor() {
        guard !networkMonitorStarted else { return }
        networkMonitorStarted = true
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor [weak self] in
                self?.handleNetworkChange(online: online)
            }
        }
        pathMonitor.start(queue: pathQueue)
    }

    private func handleNetworkChange(online: Bool) {
        guard lastNetworkOnline != online else { return }
        lastNetworkOnline = online
        CDLog.info("network: online=\(online)")

        if online {
            FileProviderBridge.signalChanges()
            // Reconnect the optional WebDAV volume after the Mac comes back
            // online. File Provider gets its own signal above and flushes its
            // offline queue from the extension.
            if settings.autoConnect, canConnect, !isBusy,
               !settings.username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                CDLog.info("network: restored, reconnecting")
                connect(userInitiated: false)
            }
        } else if status.isConnected {
            CDLog.warn("network: offline while mounted; keeping volume for recovery")
        }
    }

    // MARK: - Polling

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard let self = self else { return }
                self.tick()
            }
        }
    }

    private func tick() {
        tickCount += 1
        guard !isBusy else { return }
        refreshMountState()
        if tickCount % 7 == 0 {
            checkReachability()
        }
    }

    /// Reconcile the model with what is actually mounted.  Handles:
    ///   * a volume mounted before the app started (or by Finder);
    ///   * the user ejecting the volume in Finder while we are "connected";
    ///   * a leftover empty mount point from a crashed mount.
    public func refreshMountState() {
        guard let url = currentServerURL else { return }

        if let volume = MountClient.findMountedVolume(for: url) {
            let wasConnected = status.isConnected
            if !wasConnected {
                volumePath = volume.path
                if mountDate == nil { mountDate = Date() }
                updateStatus(.connected, error: nil)
                CDLog.info("poll: adopted mounted volume \(volume.path)")
            } else if volumePath != volume.path {
                volumePath = volume.path
            }
        } else if status.isConnected {
            volumePath = nil
            mountDate = nil
            reachability = nil
            lastError = "卷已在 Finder 中卸载，或服务器连接已断开。"
            updateStatus(.disconnected, error: nil)
            CDLog.warn("poll: volume disappeared, marking disconnected")
        }

        let expected = MountClient.expectedMountPath(for: url)
        staleMountPath = (status.isConnected == false && MountClient.isStaleMountPoint(atPath: expected))
            ? expected : nil
    }

    private func recoverMountState() {
        guard let url = currentServerURL else { return }
        if let volume = MountClient.findMountedVolume(for: url) {
            volumePath = volume.path
            mountDate = Date()
            updateStatus(.connected, error: nil)
            CDLog.info("recover: found existing mount at \(volume.path)")
        }
    }

    // MARK: - Connect / disconnect

    public func connect(userInitiated: Bool = true) {
        guard !isBusy else { return }
        if status.isConnected { return }

        let url: URL
        let username: String
        do {
            url = try settings.validate()
            username = settings.username.trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            fail(with: error.localizedDescription, userInitiated: userInitiated)
            return
        }

        guard let password = storedPassword(for: url, username: username), !password.isEmpty else {
            fail(with: "钥匙串中没有找到密码（\(username)@\(url.host ?? "")）。请打开“设置”重新输入密码并保存。",
                 userInitiated: userInitiated)
            return
        }

        isBusy = true
        lastError = nil
        updateStatus(.connecting, error: nil)
        CDLog.info("connect: mounting \(url.absoluteString) user=\(username)")

        Task { [weak self] in
            let result = await Task.detached(priority: .userInitiated) { () -> Result<MountedVolume, Error> in
                do {
                    return .success(try MountClient.mount(serverURL: url, username: username, password: password))
                } catch {
                    return .failure(error)
                }
            }.value

            guard let self = self else { return }
            self.isBusy = false
            switch result {
            case .success(let volume):
                self.volumePath = volume.path
                self.mountDate = Date()
                self.lastError = nil
                self.updateStatus(.connected, error: nil)
                CDLog.info("connect: success at \(volume.path)")
                self.checkReachability()
                if userInitiated {
                    self.openInFinder()
                }
            case .failure(let error):
                let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                self.lastError = message
                self.updateStatus(.failed(message), error: message)
                CDLog.error("connect: failed - \(message)")
                if userInitiated {
                    // Interactive attempts get a dialog; login-time
                    // auto-connect stays quiet.
                    self.showErrorAlert(message)
                }
            }
        }
    }

    public func disconnect(force: Bool = false) {
        guard !isBusy else { return }
        guard let path = volumePath ?? MountClient.findMountedVolume(for: currentServerURL ?? fallbackURL)?.path else {
            volumePath = nil
            mountDate = nil
            updateStatus(.disconnected, error: nil)
            return
        }

        isBusy = true
        lastError = nil
        updateStatus(.disconnecting, error: nil)
        CDLog.info("disconnect: unmounting \(path) force=\(force)")

        Task { [weak self] in
            let result = await Task.detached(priority: .userInitiated) { () -> Result<Void, Error> in
                do {
                    try MountClient.unmount(volumePath: path, force: force)
                    return .success(())
                } catch {
                    return .failure(error)
                }
            }.value

            guard let self = self else { return }
            self.isBusy = false
            switch result {
            case .success:
                self.volumePath = nil
                self.mountDate = nil
                self.reachability = nil
                self.lastError = nil
                self.updateStatus(.disconnected, error: nil)
                CDLog.info("disconnect: success")
            case .failure(let error):
                let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                self.lastError = message
                if MountClient.isVolumeMounted(atPath: path) {
                    self.volumePath = path
                    self.updateStatus(.connected, error: message)
                } else {
                    self.volumePath = nil
                    self.updateStatus(.disconnected, error: message)
                }
                CDLog.error("disconnect: failed - \(message)")
            }
        }
    }

    public func reconnect() {
        guard !isBusy else { return }
        if status.isConnected {
            guard let path = volumePath else {
                connect()
                return
            }
            isBusy = true
            updateStatus(.disconnecting, error: nil)
            Task { [weak self] in
                let result = await Task.detached(priority: .userInitiated) { () -> Result<Void, Error> in
                    do {
                        try MountClient.unmount(volumePath: path)
                        return .success(())
                    } catch {
                        return .failure(error)
                    }
                }.value
                guard let self = self else { return }
                self.isBusy = false
                switch result {
                case .success:
                    self.volumePath = nil
                    self.mountDate = nil
                    self.updateStatus(.disconnected, error: nil)
                    self.connect()
                case .failure(let error):
                    self.lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    self.updateStatus(.connected, error: self.lastError)
                }
            }
        } else {
            connect()
        }
    }

    /// Remove a stale, empty mount point left behind by a previous mount.
    public func cleanStaleMountPoint() {
        guard let path = staleMountPath else { return }
        do {
            try FileManager.default.removeItem(atPath: path)
            staleMountPath = nil
            lastError = nil
            CDLog.info("cleanup: removed stale mount point \(path)")
        } catch {
            lastError = "无法删除残留挂载点 \(path)：\(error.localizedDescription)。可在终端执行 sudo rmdir '\(path)'。"
            CDLog.error("cleanup: failed - \(error.localizedDescription)")
        }
    }

    // MARK: - Settings

    /// Persist settings, keychain password and the login item.
    /// - Parameter password: `nil` keeps the currently stored password.
    /// - Returns: A human readable error, or `nil` on success.
    @discardableResult
    public func applySettings(serverURLText: String,
                              username: String,
                              password: String?,
                              connectAtLogin: Bool,
                              autoConnect: Bool) -> String? {
        do {
            let url = try SettingsStore.normalize(serverText: serverURLText)
            let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedUsername.isEmpty else {
                return "请填写用户名（与 Tern 网页登录账号相同）。"
            }
            if let password = password, !password.isEmpty {
                try KeychainStore.savePassword(password, serverURL: url, username: trimmedUsername)
                cachedPassword = password
                cachedCredentialKey = KeychainStore.account(serverURL: url, username: trimmedUsername)
                credentialsReady = true
            } else if storedPassword(for: url, username: trimmedUsername) == nil {
                // Keep going: the user may simply not have typed a password
                // again but one is already in the keychain.  If not, say so.
                return "设置未保存：钥匙串中没有密码，请填写密码后重试。"
            }

            settings.serverURLText = url.absoluteString
            settings.username = trimmedUsername
            settings.autoConnect = autoConnect

            // The File Provider extension runs in its own process and reads
            // connection metadata + password from the app group / shared
            // Keychain. Keep those in sync whenever settings are saved.
            FileProviderShared.saveConfiguration(serverURL: url, username: trimmedUsername)
            if let password, !password.isEmpty {
                _ = FileProviderShared.savePassword(password, serverURL: url, username: trimmedUsername)
            }

            if connectAtLogin != LaunchAgentManager.isInstalled() {
                if connectAtLogin {
                    try LaunchAgentManager.install(appURL: Bundle.main.bundleURL)
                } else {
                    LaunchAgentManager.uninstall()
                }
            }
            settings.connectAtLogin = LaunchAgentManager.isInstalled()

            // If the server changed while connected we keep the old mount but
            // warn the user; the menu still shows the real mount path.
            refreshMountState()
            checkReachability()
            CDLog.info("settings: saved url=\(url.absoluteString) user=\(trimmedUsername) loginItem=\(settings.connectAtLogin)")
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    /// Stop the old NetFS/WebDAV mount and disable auto-connect, but keep the
    /// menu-bar app's login item: the File Provider watcher needs the app to be
    /// running after login even when WebDAV is no longer used.
    @discardableResult
    public func disableWebDAVMount() -> String {
        if status.isConnected {
            disconnect(force: true)
        }
        settings.autoConnect = false
        CDLog.info("migration: disabled WebDAV mount; keeping login startup for File Provider watcher")
        return "已断开 WebDAV 网络盘并关闭自动挂载。Tern 登录启动保留，用于 File Provider 实时同步。"
    }

    /// Register the replicated File Provider domain, sharing connection
    /// metadata and credentials through the shared Keychain.
    public func enableFileProvider() async -> String {
        guard let url = currentServerURL else {
            return "❌ 请先填写有效的服务器地址。"
        }
        let username = settings.username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !username.isEmpty else {
            return "❌ 请先填写用户名。"
        }
        guard let password = storedPassword(for: url, username: username), !password.isEmpty else {
            return "❌ 请先保存密码。"
        }
        FileProviderShared.saveConfiguration(serverURL: url, username: username)
        guard FileProviderShared.loadConfiguration() != nil else {
            return "❌ 无法写入共享 Keychain。请确认应用已使用 Keychain Sharing 签名。"
        }
        guard FileProviderShared.savePassword(password, serverURL: url, username: username) else {
            return "❌ 无法把密码写入共享钥匙串。请确认应用已使用 Keychain Sharing 签名。"
        }
        do {
            try await FileProviderBridge.addDomain()
            fileProviderWatcher.start()
            return "✅ 已添加 Tern 到 Finder 位置。若系统提示未启用，请在 系统设置 → 通用 → 登录项与扩展 中打开 Tern。"
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            return "❌ 添加 File Provider 失败：\(message)"
        }
    }

    /// Probe the server without mounting.  Used by the “测试服务器” button.
    public func testConnection(serverURLText: String, username: String, password: String) async -> String {
        let url: URL
        do {
            url = try SettingsStore.normalize(serverText: serverURLText)
        } catch {
            return "❌ \(error.localizedDescription)"
        }
        let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedUsername.isEmpty else { return "❌ 请填写用户名。" }
        var secret = password
        if secret.isEmpty {
            secret = self.storedPassword(for: url, username: trimmedUsername) ?? ""
        }
        guard !secret.isEmpty else { return "❌ 请填写密码。" }

        let reachability = await Task.detached(priority: .userInitiated) {
            HTTPProbe.check(serverURL: url, username: trimmedUsername, password: secret, timeout: 6)
        }.value
        switch reachability {
        case .online:
            return "✅ 服务器可达，WebDAV 认证正常。"
        case .unauthorized:
            return "❌ 认证失败（HTTP 401）：用户名或密码不正确，或服务器未开启 WebDAV。"
        case .unreachable(let reason):
            return "❌ 无法连接：\(reason)"
        }
    }

    public func refreshCredentialState() {
        guard let url = currentServerURL, !settings.username.isEmpty else {
            credentialsReady = false
            cachedPassword = nil
            cachedCredentialKey = nil
            return
        }
        _ = storedPassword(for: url, username: settings.username)
    }

    public func clearCredentialCache() {
        cachedPassword = nil
        cachedCredentialKey = nil
        credentialsReady = false
    }

    // MARK: - Actions

    public func openInFinder() {
        guard let path = volumePath ?? MountClient.findMountedVolume(for: currentServerURL ?? fallbackURL)?.path else {
            return
        }
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    public func copyServerAddress() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(serverURLText, forType: .string)
    }

    public func openLog() {
        let url = CDLog.fileURL
        if !FileManager.default.fileExists(atPath: url.path) {
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                     withIntermediateDirectories: true)
            FileManager.default.createFile(atPath: url.path, contents: Data())
        }
        NSWorkspace.shared.open(url)
    }

    public func openSettings() {
        SettingsWindowHelper.openSettings()
    }

    public func quit() {
        NSApp.terminate(nil)
    }

    // MARK: - Reachability

    private func checkReachability() {
        guard !healthInFlight else { return }
        guard let url = currentServerURL else {
            reachability = nil
            return
        }
        let username = settings.username
        guard let password = storedPassword(for: url, username: username), !password.isEmpty else {
            reachability = nil
            return
        }
        healthInFlight = true
        Task { [weak self] in
            let result = await Task.detached(priority: .utility) {
                HTTPProbe.check(serverURL: url, username: username, password: password, timeout: 4)
            }.value
            guard let self = self else { return }
            self.reachability = result
            self.healthInFlight = false
        }
    }

    // MARK: - Keychain cache

    private func storedPassword(for url: URL, username: String) -> String? {
        let key = KeychainStore.account(serverURL: url, username: username)
        if key == cachedCredentialKey {
            return cachedPassword
        }
        let value = KeychainStore.loadPassword(serverURL: url, username: username)
        cachedCredentialKey = key
        cachedPassword = value
        credentialsReady = value != nil
        return value
    }

    // MARK: - Helpers

    private func fail(with message: String, userInitiated: Bool) {
        lastError = message
        updateStatus(.failed(message), error: message)
        CDLog.error("connect: \(message)")
        if userInitiated {
            NSSound.beep()
            showErrorAlert(message)
        }
    }

    private func updateStatus(_ newStatus: Status, error: String?) {
        _ = error
        status = newStatus
    }

    private func showErrorAlert(_ message: String) {
        NSApp.activate(ignoringOtherApps: true)
        NSSound.beep()
        let alert = NSAlert()
        alert.messageText = "无法连接 Tern"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "打开设置")
        alert.addButton(withTitle: "好")
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            openSettings()
        }
    }
}
