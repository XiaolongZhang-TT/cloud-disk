//
//  TernApp.swift
//  Tern (Tern) macOS menu-bar client
//
//  SwiftUI `MenuBarExtra` app (macOS 13+) with an AppKit delegate for
//  lifecycle, a single-instance lock, and a set of hidden command-line modes
//  that make the app testable without a human clicking the menu bar.
//

import SwiftUI
import AppKit
import Darwin

// MARK: - Entry point

@main
struct TernMain {
    static func main() {
        let arguments = Array(CommandLine.arguments.dropFirst())

        // Hidden non-GUI modes: --smoke, --set-password, --login-item, ...
        if let first = arguments.first, first.hasPrefix("--") {
            if let exitCode = CommandLineModes.run(arguments: arguments) {
                exit(exitCode)
            }
        }

        guard SingleInstance.acquire() else {
            FileHandle.standardError.write(Data("Tern 已经在运行，本次启动已跳过。\n".utf8))
            exit(0)
        }
        TernApp.main()
    }
}

// MARK: - SwiftUI app

struct TernApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        MenuBarExtra {
            MenuBarView(model: AppModel.shared)
        } label: {
            MenuBarLabel(model: AppModel.shared)
        }
        .menuBarExtraStyle(.menu)

        Settings {
            SettingsView(model: AppModel.shared, settings: SettingsStore.shared)
        }
    }
}

struct MenuBarLabel: View {
    @ObservedObject var model: AppModel

    var body: some View {
        Image(systemName: model.menuBarSymbol)
            .accessibilityLabel(Text("Tern"))
    }
}

// MARK: - App delegate

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
        // LSUIElement in Info.plist already makes this an accessory app; keep
        // it that way even if someone launches the binary directly.
        NSApp.setActivationPolicy(.accessory)
        AppModel.shared.start()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationWillTerminate(_ notification: Notification) {
        AppModel.shared.shutdown()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        AppModel.shared.openSettings()
        return true
    }
}

// MARK: - Single instance

enum SingleInstance {
    private static var lockFileDescriptor: Int32 = -1

    /// Ensure only one copy of the menu-bar app is running.  Returns `false`
    /// when another instance holds the lock.
    static func acquire() -> Bool {
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Tern", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let lockPath = directory.appendingPathComponent("app.lock").path
        let descriptor = open(lockPath, O_CREAT | O_RDWR, 0o644)
        guard descriptor >= 0 else {
            // Cannot create a lock file (unusual); better to run than not.
            return true
        }
        if flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
            close(descriptor)
            return false
        }
        lockFileDescriptor = descriptor
        return true
    }
}

// MARK: - Hidden command-line modes

/// The app binary doubles as a maintenance tool.  These modes run before
/// SwiftUI starts and never show any UI, which is what makes it possible to
/// test the menu-bar app from a terminal, CI job or automation script.
enum CommandLineModes {

    /// Returns an exit code when the arguments describe a headless mode, or
    /// `nil` when the app should start normally.
    static func run(arguments: [String]) -> Int32? {
        guard let command = arguments.first else { return nil }
        let rest = Array(arguments.dropFirst())

        switch command {
        case "--version":
            print(TernInfo.versionDescription)
            return 0
        case "--help":
            print(helpText())
            return 0

        case "--smoke":
            switch SmokeRunner.parse(arguments: rest) {
            case .success(let options):
                return SmokeRunner.run(options: options)
            case .failure(let error):
                switch error.message {
                case "__HELP__":
                    print(SmokeRunner.usageText())
                    return 0
                case "__VERSION__":
                    print(TernInfo.versionDescription)
                    return 0
                default:
                    FileHandle.standardError.write(Data(("错误：\(error.message)\n\n" + SmokeRunner.usageText() + "\n").utf8))
                    return 1
                }
            }

        case "--set-password":
            return runSetPassword(arguments: rest)
        case "--delete-password":
            return runDeletePassword(arguments: rest)
        case "--login-item":
            return runLoginItem(arguments: rest)
        case "--diagnose":
            return runDiagnose(arguments: rest)

        default:
            return nil
        }
    }

    private static func helpText() -> String {
        """
        \(TernInfo.versionDescription)

        菜单栏应用（直接打开即可）：
          open Tern.app

        隐藏的命令行模式（用于自动化与排障）：
          --smoke <mount-smoke 参数>   运行挂载冒烟测试（见 --help 中的 mount-smoke 说明）
          --set-password --url URL --user NAME --password PASS [--result FILE]
                                       把密码写入 macOS 钥匙串（以当前应用身份）
          --delete-password --url URL --user NAME
                                       删除钥匙串中的密码
          --login-item status|enable|disable [--result FILE]
                                       查看/启用/关闭登录启动（LaunchAgent）
          --diagnose [--result FILE]   输出诊断信息
          --version                    显示版本
          --help                       显示本帮助
        """
    }

    // MARK: Mode implementations

    private static func parseFlags(_ arguments: [String]) -> [String: String] {
        var flags: [String: String] = [:]
        var index = 0
        while index < arguments.count {
            let key = arguments[index]
            if index + 1 < arguments.count, !arguments[index + 1].hasPrefix("--") {
                flags[key] = arguments[index + 1]
                index += 2
            } else {
                flags[key] = ""
                index += 1
            }
        }
        return flags
    }

    private static func writeResult(_ text: String, to resultFile: String?) {
        print(text)
        fflush(stdout)
        if let resultFile = resultFile {
            try? text.write(toFile: resultFile, atomically: true, encoding: .utf8)
        }
    }

    private static func passwordFromFlags(_ flags: [String: String]) -> String {
        if let password = flags["--password"], !password.isEmpty { return password }
        if let environment = ProcessInfo.processInfo.environment["TERN_PASSWORD"] {
            return environment
        }
        return ""
    }

    private static func runSetPassword(arguments: [String]) -> Int32 {
        let flags = parseFlags(arguments)
        let resultFile = flags["--result"]
        guard let urlText = flags["--url"],
              let url = try? SettingsStore.normalize(serverText: urlText) else {
            writeResult("错误：请提供有效的 --url（例如 http://127.0.0.1:18080/Tern）", to: resultFile)
            return 1
        }
        guard let username = flags["--user"], !username.isEmpty else {
            writeResult("错误：请提供 --user", to: resultFile)
            return 1
        }
        let password = passwordFromFlags(flags)
        guard !password.isEmpty else {
            writeResult("错误：请提供 --password 或设置 TERN_PASSWORD 环境变量", to: resultFile)
            return 1
        }
        do {
            try KeychainStore.savePassword(password, serverURL: url, username: username)
            writeResult("OK: 密码已保存到钥匙串（\(KeychainStore.account(serverURL: url, username: username))）", to: resultFile)
            return 0
        } catch {
            writeResult("错误：\(error.localizedDescription)", to: resultFile)
            return 1
        }
    }

    private static func runDeletePassword(arguments: [String]) -> Int32 {
        let flags = parseFlags(arguments)
        let resultFile = flags["--result"]
        guard let urlText = flags["--url"],
              let url = try? SettingsStore.normalize(serverText: urlText),
              let username = flags["--user"], !username.isEmpty else {
            writeResult("错误：需要 --url 与 --user", to: resultFile)
            return 1
        }
        let deleted = KeychainStore.deletePassword(serverURL: url, username: username)
        writeResult(deleted ? "OK: 已删除钥匙串密码" : "钥匙串中没有对应密码", to: resultFile)
        return 0
    }

    private static func runLoginItem(arguments: [String]) -> Int32 {
        let flags = parseFlags(arguments)
        let resultFile = flags["--result"]
        let action = arguments.first(where: { !$0.hasPrefix("--") }) ?? "status"
        switch action {
        case "status":
            writeResult("登录启动：\(LaunchAgentManager.statusDescription())\nplist: \(LaunchAgentManager.plistURL.path)", to: resultFile)
            return LaunchAgentManager.isInstalled() ? 0 : 3
        case "enable":
            do {
                try LaunchAgentManager.install(appURL: Bundle.main.bundleURL)
                writeResult("OK: 已启用登录启动\nplist: \(LaunchAgentManager.plistURL.path)\n\(LaunchAgentManager.statusDescription())", to: resultFile)
                return 0
            } catch {
                writeResult("错误：\(error.localizedDescription)", to: resultFile)
                return 1
            }
        case "disable":
            LaunchAgentManager.uninstall()
            writeResult("OK: 已关闭登录启动，plist 已删除", to: resultFile)
            return 0
        default:
            writeResult("错误：--login-item 只支持 status|enable|disable", to: resultFile)
            return 1
        }
    }

    private static func runDiagnose(arguments: [String]) -> Int32 {
        let flags = parseFlags(arguments)
        let resultFile = flags["--result"]
        let settings = SettingsStore.shared
        var lines: [String] = []
        lines.append(TernInfo.versionDescription)
        lines.append("bundle: \(Bundle.main.bundleURL.path)")
        lines.append("executable: \(Bundle.main.executableURL?.path ?? "?")")
        lines.append("macOS: \(ProcessInfo.processInfo.operatingSystemVersionString)")
        lines.append("arch: arm64 (compiled)")
        let serverURL = (try? settings.validatedServerURL())?.absoluteString ?? settings.serverURLText
        lines.append("server: \(serverURL)")
        lines.append("user: \(settings.username.isEmpty ? "(未设置)" : settings.username)")
        lines.append("connectAtLogin(defaults): \(settings.connectAtLogin)")
        lines.append("autoConnect: \(settings.autoConnect)")
        lines.append("launchAgent: \(LaunchAgentManager.statusDescription())")
        if let url = try? settings.validatedServerURL(), !settings.username.isEmpty {
            let password = KeychainStore.loadPassword(serverURL: url, username: settings.username)
            lines.append("keychainPassword: \(password == nil ? "未保存" : "已保存")")
        }
        if let url = try? settings.validatedServerURL() {
            lines.append("expectedMountPath: \(MountClient.expectedMountPath(for: url))")
            if let volume = MountClient.findMountedVolume(for: url) {
                lines.append("mounted: yes \(volume.path) (\(MountClient.fileSystemType(atPath: volume.path) ?? "?"))")
            } else {
                lines.append("mounted: no")
                if MountClient.isStaleMountPoint(atPath: MountClient.expectedMountPath(for: url)) {
                    lines.append("staleMountPoint: yes \(MountClient.expectedMountPath(for: url))")
                }
            }
            let reachability = HTTPProbe.check(serverURL: url,
                                               username: settings.username,
                                               password: KeychainStore.loadPassword(serverURL: url, username: settings.username) ?? "",
                                               timeout: 4)
            lines.append("reachability: \(reachability.displayText)")
        }
        lines.append("log: \(CDLog.fileURL.path)")
        writeResult(lines.joined(separator: "\n"), to: resultFile)
        return 0
    }
}
