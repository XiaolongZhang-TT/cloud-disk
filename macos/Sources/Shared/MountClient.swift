//
//  MountClient.swift
//  Tern (Tern) macOS menu-bar client
//
//  The macOS client deliberately does not re-implement sync.  It asks macOS
//  itself to mount the Tern WebDAV endpoint through
//  `NetFSMountURLSync`, so Finder treats the result as a normal network
//  volume: it appears in /Volumes, in Finder's sidebar under "Locations"
//  (next to iCloud Drive) and can be dragged to Favorites.
//
//  This file is shared by the menu-bar app and the `mount-smoke` CLI tool.
//

import Foundation
import AppKit
import NetFS
import Darwin

// MARK: - Model

/// A volume that is currently mounted on the machine.
public struct MountedVolume: Equatable {
    public let path: String
    public let name: String
    public let isNetwork: Bool
    public let remountURL: URL?

    public var url: URL { URL(fileURLWithPath: path) }
}

public enum ServerReachability: Equatable {
    case online
    case unauthorized
    case unreachable(String)

    public var isOnline: Bool {
        if case .online = self { return true }
        return false
    }

    public var displayText: String {
        switch self {
        case .online: return "在线"
        case .unauthorized: return "需要认证（用户名或密码错误）"
        case .unreachable(let reason): return "离线：\(reason)"
        }
    }
}

// MARK: - Errors

public enum MountClientError: LocalizedError, Equatable {
    /// The configured server URL could not be turned into a usable WebDAV URL.
    case invalidServerURL(String)
    /// User name / password were not supplied.
    case missingCredentials
    /// NetFSMountURLSync returned a non-zero code.
    case mountFailed(code: Int32, detail: String?)
    /// The mount call reported success but the volume never showed up.
    case volumeNotFound(expectedName: String, expectedPath: String)
    /// Nothing is mounted at the given path.
    case notMounted(path: String)
    /// Unmount failed (usually because the volume is busy).
    case unmountFailed(path: String, reason: String, dissentingPID: pid_t?)

    public var errorDescription: String? {
        switch self {
        case .invalidServerURL(let text):
            return "服务器地址无效：“\(text)”。请输入类似 http://192.168.1.10:8080/Tern 的地址。"
        case .missingCredentials:
            return "缺少用户名或密码。请先在“设置”中填写服务器账号和密码。"
        case .mountFailed(let code, let detail):
            return "挂载失败（错误码 \(code)）：\(MountClient.friendlyMountError(code: code))"
                + (detail.map { "（\($0)）" } ?? "")
        case .volumeNotFound(let name, let path):
            return "系统报告挂载成功，但未找到卷“\(name)”（预期位置 \(path)）。请检查是否有同名卷或残留挂载点。"
        case .notMounted(let path):
            return "\(path) 当前没有挂载。"
        case .unmountFailed(let path, let reason, let pid):
            var text = "无法断开 \(path)：\(reason)"
            if let pid = pid {
                text += "（占用进程 PID \(pid)）。请关闭正在使用该卷的窗口或程序后重试，或使用“强制断开”。"
            }
            return text
        }
    }
}

// MARK: - Client

public enum MountClient {

    public static let defaultMountRoot = "/Volumes"

    // MARK: Volume naming

    /// Volume name macOS will use for this WebDAV URL.
    ///
    /// NetFS derives the name of a WebDAV volume from the last component of the
    /// URL path.  Using `/Tern` therefore gives a volume called
    /// “Tern”; using `/dav` would give “dav”, which is why the app
    /// defaults to `/Tern`.
    public static func volumeName(for serverURL: URL) -> String {
        let components = serverURL.pathComponents.filter { $0 != "/" && !$0.isEmpty }
        var name = components.last ?? ""
        if let decoded = name.removingPercentEncoding { name = decoded }
        // macOS will sanitise these characters itself, do it early so the
        // predicted mount point matches what NetFS actually creates.
        name = name.replacingOccurrences(of: "/", with: "-")
                   .replacingOccurrences(of: ":", with: "-")
                   .trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty {
            name = serverURL.host ?? "Tern"
        }
        return name
    }

    public static func expectedMountPath(for serverURL: URL) -> String {
        (defaultMountRoot as NSString).appendingPathComponent(volumeName(for: serverURL))
    }

    // MARK: Mounted volume discovery

    /// All mounted volumes, with the resource values we need for matching.
    public static func mountedVolumes() -> [MountedVolume] {
        let keys: [URLResourceKey] = [.volumeNameKey, .volumeURLForRemountingKey, .volumeIsLocalKey]
        let urls = FileManager.default.mountedVolumeURLs(
            includingResourceValuesForKeys: keys,
            options: [.skipHiddenVolumes]
        ) ?? []

        return urls.compactMap { url -> MountedVolume? in
            let values = try? url.resourceValues(forKeys: Set(keys))
            let name = values?.volumeName ?? url.lastPathComponent
            let isLocal = values?.volumeIsLocal ?? true
            let remount = values?.volumeURLForRemounting
            // Hidden system volumes are boring; keep everything under /Volumes
            // plus any non-local volume.
            if isLocal && !url.path.hasPrefix(defaultMountRoot + "/") { return nil }
            return MountedVolume(path: url.standardizedFileURL.path,
                                 name: name,
                                 isNetwork: !isLocal,
                                 remountURL: remount)
        }
    }

    public static func isVolumeMounted(atPath path: String) -> Bool {
        let target = URL(fileURLWithPath: path).standardizedFileURL.path
        return mountedVolumes().contains { $0.path == target }
    }

    /// Locate the Tern volume for `serverURL`, if it is mounted.
    ///
    /// Matching is intentionally forgiving because NetFS is allowed to pick a
    /// different name (`Tern-1`) when the mount point is taken, and the
    /// remount URL is not always populated for WebDAV volumes.
    public static func findMountedVolume(for serverURL: URL) -> MountedVolume? {
        let expectedPath = expectedMountPath(for: serverURL)
        let expectedName = volumeName(for: serverURL)
        let volumes = mountedVolumes()

        // 1. Exact expected mount path.
        if let volume = volumes.first(where: { $0.path == expectedPath && $0.isNetwork }) {
            return volume
        }

        // 2. The URL macOS would use to remount this volume.
        let wantedScheme = (serverURL.scheme ?? "http").lowercased()
        let wantedPort = serverURL.port ?? (wantedScheme == "https" ? 443 : 80)
        let wantedHost = serverURL.host?.lowercased()
        let wantedPath = normalizedPath(serverURL)
        if let host = wantedHost {
            if let volume = volumes.first(where: { volume in
                guard volume.isNetwork, let remount = volume.remountURL else { return false }
                let scheme = (remount.scheme ?? "http").lowercased()
                let port = remount.port ?? (scheme == "https" ? 443 : 80)
                return scheme == wantedScheme
                    && remount.host?.lowercased() == host
                    && port == wantedPort
                    && normalizedPath(remount) == wantedPath
            }) {
                return volume
            }
        }

        // 3. Name match under /Volumes (covers Tern-1 style collisions and
        //    mounts whose remount URL is unavailable).
        if let volume = volumes.first(where: { volume in
            guard volume.isNetwork, volume.path.hasPrefix(defaultMountRoot + "/") else { return false }
            return volume.name == expectedName || volume.name.hasPrefix(expectedName + "-")
        }) {
            return volume
        }

        return nil
    }

    /// Returns the WebDAV volume that is mounted at exactly `path`.
    public static func mountedVolume(atPath path: String) -> MountedVolume? {
        let target = URL(fileURLWithPath: path).standardizedFileURL.path
        return mountedVolumes().first { $0.path == target }
    }

    /// Whether the directory at `path` is a leftover empty mount point rather
    /// than a real mounted volume.
    public static func isStaleMountPoint(atPath path: String) -> Bool {
        guard FileManager.default.fileExists(atPath: path) else { return false }
        guard !isVolumeMounted(atPath: path) else { return false }
        return fileSystemType(atPath: path) != "webdav"
    }

    // MARK: Mount

    /// Mount `serverURL` as a real macOS network volume.
    ///
    /// - Returns: The mounted volume.
    /// - Throws: `MountClientError` with a friendly, localised description.
    @discardableResult
    public static func mount(serverURL: URL,
                             username: String,
                             password: String,
                             allowLoopback: Bool = true) throws -> MountedVolume {
        guard serverURL.scheme == "http" || serverURL.scheme == "https" else {
            throw MountClientError.invalidServerURL(serverURL.absoluteString)
        }
        guard !username.isEmpty, !password.isEmpty else {
            throw MountClientError.missingCredentials
        }

        // Already mounted? Adopt the existing volume instead of mounting twice.
        if let existing = findMountedVolume(for: serverURL) {
            CDLog.info("mount: already mounted at \(existing.path), reusing")
            return existing
        }

        // Clean up a stale empty mount point left behind by a crashed/unmounted
        // volume so that NetFS can create /Volumes/<name> again.  This is best
        // effort: /Volumes is usually not writable for the login user, but the
        // directory is often owned by the user when NetFS created it.
        let expectedPath = expectedMountPath(for: serverURL)
        if isStaleMountPoint(atPath: expectedPath) {
            try? FileManager.default.removeItem(atPath: expectedPath)
            CDLog.warn("mount: removed stale mount point \(expectedPath)")
        }

        let openOptions = NSMutableDictionary()
        openOptions[kNAUIOptionKey] = kNAUIOptionNoUI
        if allowLoopback {
            // Without this, macOS refuses to mount a WebDAV endpoint on
            // 127.0.0.1 / localhost (common for the bundled/dev server).
            openOptions[kNetFSAllowLoopbackKey] = kCFBooleanTrue
        }

        var rawMountPoints: Unmanaged<CFArray>?
        let started = Date()
        CDLog.info("mount: NetFSMountURLSync \(serverURL.absoluteString) user=\(username)")
        let status = NetFSMountURLSync(
            serverURL as CFURL,
            nil,                                   // let macOS pick /Volumes/<name>
            username as CFString,
            password as CFString,
            openOptions as CFMutableDictionary,
            nil,
            &rawMountPoints
        )
        let elapsed = Date().timeIntervalSince(started)
        CDLog.info("mount: NetFSMountURLSync returned \(status) after \(String(format: "%.2f", elapsed))s")

        var reportedPaths: [String] = []
        if let array = rawMountPoints?.takeUnretainedValue() {
            if let paths = array as? [String] {
                reportedPaths = paths
            } else if let objects = array as? [Any] {
                reportedPaths = objects.compactMap { item in
                    if let url = item as? URL { return url.path }
                    if let string = item as? String { return string }
                    if let nsurl = item as? NSURL { return nsurl.path }
                    return nil
                }
            }
        }

        // The mount can succeed even when NetFS returns a non-zero code (for
        // example EEXIST when it raced with Finder) and
        // FileManager.mountedVolumeURLs can lag a moment behind the mount
        // syscall, so poll briefly before declaring failure.
        if let volume = waitForMountedVolume(serverURL: serverURL, timeout: 3.0) {
            if status != 0 {
                CDLog.warn("mount: NetFS returned \(status) but volume is present at \(volume.path)")
            }
            return volume
        }

        if !reportedPaths.isEmpty {
            let path = reportedPaths[0]
            if isVolumeMounted(atPath: path) {
                return MountedVolume(path: path,
                                     name: URL(fileURLWithPath: path).lastPathComponent,
                                     isNetwork: true,
                                     remountURL: serverURL)
            }
        }

        throw MountClientError.mountFailed(code: status, detail: reportedPaths.first)
    }

    // MARK: Unmount

    /// Cleanly unmount the volume at `volumePath`.
    ///
    /// Order matters and is deliberately conservative:
    ///
    ///  1. `unmount(2)` – fast, works for user-mounted network volumes and is
    ///     safe to call from the main thread.
    ///  2. `FileManager.unmountVolume` (DiskArbitration) – needed when the
    ///     kernel returns EBUSY or when the volume was mounted by another user.
    ///     It runs on a background queue and the main thread *pumps its
    ///     runloop* while waiting, so a completion handler delivered on the
    ///     main queue can never deadlock the app.
    ///  3. Force paths (only with `force: true`): `unmount(2)` with MNT_FORCE,
    ///     then `diskutil unmount force`.
    ///
    /// `NSWorkspace.unmountAndEjectDevice` is intentionally not used: on a
    /// dead/stale WebDAV volume it can block for a long time in
    /// DiskArbitration, and it has no timeout.
    public static func unmount(volumePath: String,
                               force: Bool = false,
                               timeout: TimeInterval = 20) throws {
        guard isVolumeMounted(atPath: volumePath) else {
            throw MountClientError.notMounted(path: volumePath)
        }

        let deadline = Date().addingTimeInterval(timeout)
        var lastErrno: Int32 = 0

        func trySyscall(_ flags: Int32) -> Bool {
            lastErrno = volumePath.withCString { Darwin.unmount($0, flags) }
            if lastErrno == 0 {
                if waitUntilUnmounted(volumePath: volumePath, timeout: 5) { return true }
            } else {
                CDLog.warn("unmount: unmount(2) flags=\(flags) failed errno=\(lastErrno): \(String(cString: strerror(lastErrno)))")
            }
            return false
        }

        // 1. Fast path.
        if trySyscall(0) {
            CDLog.info("unmount: \(volumePath) unmounted via unmount(2)")
            return
        }

        // 2. DiskArbitration via FileManager.
        if unmountWithFileManager(volumePath: volumePath,
                                  timeout: max(2, min(10, deadline.timeIntervalSinceNow))) {
            CDLog.info("unmount: \(volumePath) unmounted via FileManager")
            return
        }

        // 3. Force (only when explicitly requested).
        if force {
            if trySyscall(Int32(MNT_FORCE)) {
                CDLog.info("unmount: \(volumePath) force-unmounted via unmount(2)")
                return
            }
            if unmountWithDiskutil(volumePath: volumePath) {
                CDLog.info("unmount: \(volumePath) force-unmounted via diskutil")
                return
            }
        }

        var dissentingPID: pid_t?
        if let error = lastFileManagerUnmountError,
           let pid = error.userInfo[NSFileManagerUnmountDissentingProcessIdentifierErrorKey] as? NSNumber {
            dissentingPID = pid.int32Value
        }
        let reason: String
        if force {
            reason = "强制卸载也失败，卷可能已失效或仍被占用"
        } else if lastErrno != 0 {
            reason = String(cString: strerror(lastErrno))
        } else {
            reason = "卷忙，仍有程序在使用它"
        }
        CDLog.error("unmount: failed for \(volumePath): \(reason)")
        throw MountClientError.unmountFailed(path: volumePath, reason: reason, dissentingPID: dissentingPID)
    }

    private static var lastFileManagerUnmountError: NSError?

    /// Run `FileManager.unmountVolume` on a background queue.
    ///
    /// When called from the main thread the runloop is pumped while waiting,
    /// because the completion handler may be delivered on the main queue.
    /// Blocking the main thread with `DispatchSemaphore.wait` in that situation
    /// deadlocks – a mistake that is easy to make in menu-bar apps.
    private static func unmountWithFileManager(volumePath: String, timeout: TimeInterval) -> Bool {
        let semaphore = DispatchSemaphore(value: 0)
        let box = Box<Bool>(false)
        DispatchQueue.global(qos: .userInitiated).async {
            let url = URL(fileURLWithPath: volumePath)
            let inner = DispatchSemaphore(value: 0)
            FileManager.default.unmountVolume(at: url, options: [.withoutUI]) { error in
                lastFileManagerUnmountError = error as NSError?
                inner.signal()
            }
            _ = inner.wait(timeout: .now() + timeout)
            box.value = !isVolumeMounted(atPath: volumePath)
            semaphore.signal()
        }

        let deadline = Date().addingTimeInterval(timeout + 1)
        if Thread.isMainThread {
            while Date() < deadline {
                if semaphore.wait(timeout: .now()) == .success { break }
                RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
            }
        } else {
            _ = semaphore.wait(timeout: .now() + timeout + 1)
        }
        return box.value
    }

    private static func unmountWithDiskutil(volumePath: String) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/diskutil")
        process.arguments = ["unmount", "force", volumePath]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            return false
        }
        process.waitUntilExit()
        return !isVolumeMounted(atPath: volumePath)
    }

    public static func waitUntilUnmounted(volumePath: String, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if !isVolumeMounted(atPath: volumePath) { return true }
            Thread.sleep(forTimeInterval: 0.25)
        }
        return !isVolumeMounted(atPath: volumePath)
    }

    // MARK: Helpers

    /// Poll for a mounted volume for up to `timeout` seconds.  NetFS can return
    /// from the mount call a fraction of a second before the volume shows up in
    /// `mountedVolumeURLs`, so never trust a single immediate check.
    public static func waitForMountedVolume(serverURL: URL, timeout: TimeInterval) -> MountedVolume? {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if let volume = findMountedVolume(for: serverURL) { return volume }
            // Fall back to the expected mount point even if the volume
            // enumeration is still catching up.
            let expected = expectedMountPath(for: serverURL)
            if isVolumeMounted(atPath: expected) {
                return MountedVolume(path: expected,
                                     name: volumeName(for: serverURL),
                                     isNetwork: true,
                                     remountURL: serverURL)
            }
            Thread.sleep(forTimeInterval: 0.15)
        } while Date() < deadline
        return findMountedVolume(for: serverURL)
    }

    public static func fileSystemType(atPath path: String) -> String? {
        var info = statfs()
        guard statfs(path, &info) == 0 else { return nil }
        return withUnsafePointer(to: &info.f_fstypename) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: Int(MFSTYPENAMELEN)) {
                String(cString: $0)
            }
        }
    }

    public static func normalizedPath(_ url: URL) -> String {
        var path = url.path
        if path.isEmpty { path = "/" }
        while path.count > 1 && path.hasSuffix("/") { path.removeLast() }
        return path
    }

    /// Human readable explanation for the codes NetFSMountURLSync can return.
    public static func friendlyMountError(code: Int32) -> String {
        switch code {
        case 0:
            return "成功"
        case EPERM:
            return "没有挂载权限（EPERM）。请确认已在图形桌面会话中运行，且未被沙箱、SSH 会话或 MDM 策略限制。"
        case EACCES:
            return "认证失败或没有访问权限（EACCES）。请检查用户名和密码，并确认服务器已开启 WebDAV。"
        case ENOENT:
            return "找不到挂载点或服务器路径（ENOENT）。请确认服务器地址中的路径（应为 /Tern）存在。"
        case EEXIST:
            return "挂载点已存在（EEXIST）。可能已经挂载，请先断开或清理残留挂载点。"
        case EBUSY:
            return "卷正忙（EBUSY）。请稍后重试。"
        case ETIMEDOUT:
            return "连接服务器超时（ETIMEDOUT）。请检查服务器地址、网络和防火墙。"
        case ECONNREFUSED:
            return "服务器拒绝连接（ECONNREFUSED）。请确认 Tern 服务已启动、端口正确。"
        case EHOSTUNREACH, ENETUNREACH:
            return "网络不可达（EHOSTUNREACH）。请检查网络连接或 VPN。"
        case ECONNRESET, EPIPE, ENOTCONN:
            return "连接被服务器中断（ECONNRESET）。请确认服务端 WebDAV 工作正常。"
        case ENODEV:
            return "WebDAV 文件系统不可用（ENODEV）。请确认当前 macOS 支持 WebDAV 卷（系统自带 webdav.fs）。"
        case EINVAL:
            return "地址或参数无效（EINVAL）。请确认地址形如 http://host:port/Tern。"
        case 80: // EAUTH
            return "用户名或密码错误，或服务器拒绝认证（EAUTH）。请重新输入密码。"
        case -128:
            return "用户取消了挂载。"
        case -5045:
            return "服务器要求修改密码后才能挂载。"
        case -5046:
            return "密码不符合服务器策略。"
        case -5999:
            return "账号被服务器限制，无法挂载。"
        case -5998:
            return "服务器没有可用的共享（找不到 WebDAV 根目录）。"
        case -5997:
            return "服务器不支持所需的认证方式。"
        case -5996:
            return "服务器 WebDAV 协议版本不受支持。"
        case -6600:
            return "macOS 网络认证内部错误。请重试或重新登录后再试。"
        case -6602:
            return "挂载失败。请确认服务器地址指向 WebDAV 端点（/Tern），且服务端 WebDAV 实现完整（PROPFIND/LOCK）。"
        case -6003:
            return "服务器没有可用的共享。"
        case -6004:
            return "服务器不支持访客访问。"
        case -6005:
            return "连接已关闭，请重试。"
        default:
            return "未知错误（\(code)）。可在 ~/Library/Logs/Tern.log 查看详细日志。"
        }
    }
}

// MARK: - HTTP probe

/// A tiny, ATS-independent WebDAV reachability probe.
///
/// Uses a plain `URLSession` request to the WebDAV endpoint with the configured
/// credentials.  It is only used to paint the “在线/离线” indicator and to give
/// the user a fast, friendly error *before* NetFS blocks for tens of seconds on
/// an unreachable host.
public enum HTTPProbe {
    public static func check(serverURL: URL,
                             username: String,
                             password: String,
                             timeout: TimeInterval = 5) -> ServerReachability {
        guard serverURL.scheme == "http" || serverURL.scheme == "https" else {
            return .unreachable("地址必须以 http:// 或 https:// 开头")
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpMaximumConnectionsPerHost = 1
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        var request = URLRequest(url: serverURL, timeoutInterval: timeout)
        request.httpMethod = "OPTIONS"
        request.setValue("0", forHTTPHeaderField: "Content-Length")
        request.setValue("Tern-macOS", forHTTPHeaderField: "User-Agent")
        if !username.isEmpty {
            let token = Data("\(username):\(password)".utf8).base64EncodedString()
            request.setValue("Basic \(token)", forHTTPHeaderField: "Authorization")
        }

        let box = Box<ServerReachability>(.unreachable("探测超时"))
        let semaphore = DispatchSemaphore(value: 0)
        let task = session.dataTask(with: request) { _, response, error in
            if let error = error {
                let nsError = error as NSError
                switch nsError.code {
                case NSURLErrorTimedOut:
                    box.value = .unreachable("连接超时")
                case NSURLErrorCannotConnectToHost:
                    box.value = .unreachable("连接被拒绝，服务可能未启动")
                case NSURLErrorCannotFindHost:
                    box.value = .unreachable("找不到主机，请检查地址")
                case NSURLErrorNetworkConnectionLost:
                    box.value = .unreachable("网络连接中断")
                case NSURLErrorServerCertificateUntrusted,
                     NSURLErrorSecureConnectionFailed:
                    box.value = .unreachable("HTTPS 证书不受信任，请先在“钥匙串访问”中信任服务器证书")
                default:
                    box.value = .unreachable(nsError.localizedDescription)
                }
            } else if let http = response as? HTTPURLResponse {
                switch http.statusCode {
                case 200..<300, 207:
                    box.value = .online
                case 401, 403:
                    box.value = .unauthorized
                case 404:
                    box.value = .unreachable("服务器返回 404，地址可能不正确（应使用 /Tern）")
                case 405:
                    box.value = .online // 服务器可达，只是不允许 OPTIONS
                default:
                    box.value = .unreachable("服务器返回 HTTP \(http.statusCode)")
                }
            } else {
                box.value = .unreachable("未收到服务器响应")
            }
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + timeout + 1)
        if box.value == .unreachable("探测超时") {
            task.cancel()
        }
        return box.value
    }
}

/// Small thread-safe reference box, used to cross the URLSession callback
/// boundary without resorted to `@unchecked Sendable` globals.
final class Box<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: T
    init(_ value: T) { storage = value }
    var value: T {
        get { lock.lock(); defer { lock.unlock() }; return storage }
        set { lock.lock(); storage = newValue; lock.unlock() }
    }
}
