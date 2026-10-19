//
//  LaunchAgentManager.swift
//  Tern (Tern) macOS menu-bar client
//
//  “登录时启动” is implemented with a per-user LaunchAgent instead of
//  SMAppService/LoginItems.  Reasons:
//    * it works for ad-hoc signed, locally built apps (no Apple Developer
//      account, no notarisation, no helper bundle);
//    * it is transparent and easy to remove (a single plist);
//    * it can be repaired automatically if the .app is moved, because the
//      app rewrites the agent with its current path on every launch.
//

import Foundation

public enum LaunchAgentManager {

    public static let label = TernInfo.bundleIdentifier
    public static let queueLabel = "\(TernInfo.bundleIdentifier).launch"

    public static var plistURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents", isDirectory: true)
            .appendingPathComponent("\(label).plist")
    }

    public static var launchdLogURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs", isDirectory: true)
            .appendingPathComponent("Tern-launchd.log")
    }

    public static func isInstalled() -> Bool {
        FileManager.default.fileExists(atPath: plistURL.path)
    }

    /// Install (or repair) the LaunchAgent for the app at `appURL` and load it.
    /// Loading the agent also starts the app immediately; `open -g` makes that
    /// start invisible (no Dock icon / no focus stealing).
    public static func install(appURL: URL) throws {
        guard appURL.pathExtension == "app" else {
            throw LaunchAgentError.notAnAppBundle(appURL.path)
        }
        let launchAgentsDirectory = plistURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: launchAgentsDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: launchdLogURL.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)

        let plist: [String: Any] = [
            "Label": label,
            "ProgramArguments": ["/usr/bin/open", "-g", "-a", appURL.path],
            "RunAtLoad": true,
            "LimitLoadToSessionType": "Aqua",
            "ProcessType": "Interactive",
            "StandardOutPath": launchdLogURL.path,
            "StandardErrorPath": launchdLogURL.path,
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: plistURL, options: .atomic)

        // Reload from scratch so a changed app path takes effect.
        bootout()
        let bootstrap = run("/bin/launchctl", ["bootstrap", "gui/\(getuid())", plistURL.path])
        if bootstrap.status != 0 {
            // Older macOS releases / unusual setups: fall back to `load -w`.
            let load = run("/bin/launchctl", ["load", "-w", plistURL.path])
            guard load.status == 0 else {
                let detail = bootstrap.err.isEmpty ? load.err : bootstrap.err
                throw LaunchAgentError.bootstrapFailed(trimmed(detail))
            }
        }
        CDLog.info("launchagent: installed for \(appURL.path)")
    }

    /// Remove the LaunchAgent and unload it.  Safe to call when not installed.
    public static func uninstall() {
        bootout()
        try? FileManager.default.removeItem(at: plistURL)
        CDLog.info("launchagent: uninstalled")
    }

    /// Called on app launch: if the user enabled “登录时启动”, rewrite the
    /// plist so it points at the current location of Tern.app.  This makes
    /// the login item survive the app being moved to /Applications.
    public static func repairIfInstalled(appURL: URL) {
        guard isInstalled() else { return }
        if currentProgramPath() == appURL.path { return }
        CDLog.info("launchagent: app path changed, repairing (\(currentProgramPath() ?? "?") -> \(appURL.path))")
        try? install(appURL: appURL)
    }

    /// The app path currently referenced by the LaunchAgent, if any.
    public static func currentProgramPath() -> String? {
        guard let data = try? Data(contentsOf: plistURL),
              let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil),
              let dictionary = plist as? [String: Any],
              let arguments = dictionary["ProgramArguments"] as? [String],
              let appPath = arguments.last else { return nil }
        return appPath
    }

    public static func statusDescription() -> String {
        guard isInstalled() else { return "未启用" }
        let loaded = run("/bin/launchctl", ["print", "gui/\(getuid())/\(label)"]).status == 0
        let path = currentProgramPath() ?? "未知"
        return "已启用（\(loaded ? "已加载" : "未加载")）：\(path)"
    }

    // MARK: - Internals

    private static func bootout() {
        _ = run("/bin/launchctl", ["bootout", "gui/\(getuid())/\(label)"])
        _ = run("/bin/launchctl", ["remove", label]) // legacy fallback, harmless if absent
    }

    @discardableResult
    private static func run(_ executable: String, _ arguments: [String]) -> (status: Int32, out: String, err: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        let outPipe = Pipe()
        let errPipe = Pipe()
        process.standardOutput = outPipe
        process.standardError = errPipe
        do {
            try process.run()
        } catch {
            return (-1, "", error.localizedDescription)
        }
        let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
        let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus,
                String(decoding: outData, as: UTF8.self),
                String(decoding: errData, as: UTF8.self))
    }

    private static func trimmed(_ text: String) -> String {
        let single = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return single.isEmpty ? "launchctl 返回未知错误" : single
    }
}

public enum LaunchAgentError: LocalizedError {
    case notAnAppBundle(String)
    case bootstrapFailed(String)

    public var errorDescription: String? {
        switch self {
        case .notAnAppBundle(let path):
            return "“\(path)”不是 .app 应用包，无法设置为登录启动。"
        case .bootstrapFailed(let detail):
            return "设置登录启动失败：\(detail)。可尝试重新打开应用后再试，或以当前用户运行 launchctl。"
        }
    }
}
