//
//  SmokeRunner.swift
//  CloudDisk (云屿) macOS menu-bar client
//
//  End-to-end self test used by `macos/tools/mount-smoke` and by the app's
//  hidden `--smoke` mode:
//
//      mount the WebDAV endpoint -> list the root -> write a file ->
//      read it back -> delete it -> unmount -> verify clean state
//
//  Exit codes are stable so CI / the Lead can assert on them.
//

import Foundation

public enum SmokeExitCode: Int32 {
    case ok = 0
    case usage = 1
    case mountFailed = 2
    case volumeNotFound = 3
    case listFailed = 4
    case writeFailed = 5
    case readFailed = 6
    case unmountFailed = 7
    case probeFailed = 9
    case internalError = 10
}

public struct SmokeParseError: Error, Equatable {
    public let message: String
    public init(_ message: String) { self.message = message }
}

public struct SmokeOptions {
    public var serverURL: URL = URL(string: "http://127.0.0.1:18080/CloudDisk")!
    public var username: String = "admin"
    public var password: String = ""
    public var keepMounted: Bool = false
    public var forceUnmount: Bool = false
    public var json: Bool = false
    public var checkOnly: Bool = false
    public var skipProbe: Bool = false
    public var unmountPath: String?
    public var resultFile: URL?
    public var expectedItemName: String?
}

private final class SmokeOutput {
    private let json: Bool
    private let fileHandle: FileHandle?
    private(set) var lines: [String] = []
    private let lock = NSLock()

    init(json: Bool, resultFile: URL?) {
        self.json = json
        if let resultFile = resultFile {
            FileManager.default.createFile(atPath: resultFile.path, contents: nil)
            fileHandle = try? FileHandle(forWritingTo: resultFile)
        } else {
            fileHandle = nil
        }
    }

    func log(_ message: String) {
        lock.lock()
        lines.append(message)
        if !json {
            print(message)
            fflush(stdout)
        } else {
            FileHandle.standardError.write(Data((message + "\n").utf8))
        }
        if let data = (message + "\n").data(using: .utf8) {
            fileHandle?.seekToEndOfFile()
            fileHandle?.write(data)
            try? fileHandle?.synchronize()
        }
        lock.unlock()
    }

    func finish() {
        try? fileHandle?.close()
    }
}

public enum SmokeRunner {

    public static let toolName = "CloudDisk mount-smoke"

    // MARK: - Argument parsing

    public static func parse(arguments: [String]) -> Result<SmokeOptions, SmokeParseError> {
        var options = SmokeOptions()
        var passwordFromStdin = false
        var useKeychain = false
        var index = 0

        func nextValue(_ flag: String) -> Result<String, SmokeParseError> {
            index += 1
            guard index < arguments.count else { return .failure(SmokeParseError("参数 \(flag) 缺少取值")) }
            return .success(arguments[index])
        }

        while index < arguments.count {
            let argument = arguments[index]
            switch argument {
            case "--url", "-u":
                switch nextValue(argument) {
                case .success(let value):
                    guard let url = URL(string: value), url.scheme != nil, url.host != nil else {
                        return .failure(SmokeParseError("无效的服务器地址：\(value)"))
                    }
                    options.serverURL = url
                case .failure(let error): return .failure(error)
                }
            case "--user", "-n":
                switch nextValue(argument) {
                case .success(let value): options.username = value
                case .failure(let error): return .failure(error)
                }
            case "--password", "-p":
                switch nextValue(argument) {
                case .success(let value): options.password = value
                case .failure(let error): return .failure(error)
                }
            case "--password-stdin":
                passwordFromStdin = true
            case "--keychain":
                useKeychain = true
            case "--keep-mounted":
                options.keepMounted = true
            case "--force":
                options.forceUnmount = true
            case "--json":
                options.json = true
            case "--check":
                options.checkOnly = true
            case "--no-probe":
                options.skipProbe = true
            case "--unmount":
                switch nextValue(argument) {
                case .success(let value): options.unmountPath = value
                case .failure(let error): return .failure(error)
                }
            case "--result":
                switch nextValue(argument) {
                case .success(let value): options.resultFile = URL(fileURLWithPath: value)
                case .failure(let error): return .failure(error)
                }
            case "--expect-item":
                switch nextValue(argument) {
                case .success(let value): options.expectedItemName = value
                case .failure(let error): return .failure(error)
                }
            case "--help", "-h":
                return .failure(SmokeParseError("__HELP__"))
            case "--version":
                return .failure(SmokeParseError("__VERSION__"))
            default:
                return .failure(SmokeParseError("未知参数：\(argument)"))
            }
            index += 1
        }

        if passwordFromStdin {
            let line = readLine() ?? ""
            options.password = line.trimmingCharacters(in: .newlines)
        }
        if options.password.isEmpty {
            if let environment = ProcessInfo.processInfo.environment["CLOUDDISK_PASSWORD"],
               !environment.isEmpty {
                options.password = environment
            }
        }
        if useKeychain && options.password.isEmpty {
            options.password = KeychainStore.loadPassword(serverURL: options.serverURL,
                                                          username: options.username) ?? ""
        }
        return .success(options)
    }

    public static func usageText() -> String {
        """
        \(toolName) \(CloudDiskInfo.version)
        验证 CloudDisk WebDAV 端点在 macOS 上的真实挂载能力。

        用法:
          mount-smoke --url http://127.0.0.1:18080/CloudDisk --user admin --password '密码'
          mount-smoke --url URL --user NAME --keychain
          mount-smoke --check --url URL --user NAME --password '密码'
          mount-smoke --unmount /Volumes/CloudDisk [--force]

        参数:
          --url URL          WebDAV 地址（默认 http://127.0.0.1:18080/CloudDisk）
          --user NAME        用户名（默认 admin）
          --password PASS    密码（也可用环境变量 CLOUDDISK_PASSWORD 或 --password-stdin）
          --password-stdin   从标准输入读取密码
          --keychain         从 macOS 钥匙串读取密码（需先由 CloudDisk.app 保存）
          --keep-mounted     测试完成后保留挂载（会打印卸载提示）
          --force            卸载失败时强制卸载
          --check            仅探测服务器可达性，不挂载
          --no-probe         跳过挂载前的 HTTP 探测
          --unmount PATH     只卸载指定卷，不做其他测试
          --expect-item NAME 断言根目录存在指定的文件/文件夹
          --result FILE      把测试日志同时写入文件（供无终端环境使用）
          --json             以 JSON 输出最终结果（日志走 stderr）
          -h, --help         显示帮助
          --version          显示版本

        退出码:
          0 成功   1 参数错误   2 挂载失败   3 挂载成功但找不到卷
          4 列目录失败  5 写入失败  6 读取校验失败  7 卸载失败
          9 探测失败（--check）  10 其他错误

        说明:
          macOS 的 NetFS 挂载需要运行在图形登录会话（Aqua）中。若在 SSH /
          沙箱化的终端里运行出现 EPERM，可使用应用内建模式：
          open -n CloudDisk.app --args --smoke --url ... --user ... --password ... --result /tmp/smoke.log
        """
    }

    // MARK: - Run

    public static func run(options: SmokeOptions) -> Int32 {
        let output = SmokeOutput(json: options.json, resultFile: options.resultFile)
        defer { output.finish() }

        output.log("== \(toolName) \(CloudDiskInfo.version) ==")
        output.log("date: \(isoNow())")
        output.log("url: \(options.serverURL.absoluteString)")
        output.log("user: \(options.username)")
        output.log("volume: \(MountClient.volumeName(for: options.serverURL))")
        output.log("expected mount path: \(MountClient.expectedMountPath(for: options.serverURL))")

        // 1. --unmount only mode.
        if let path = options.unmountPath {
            return runUnmountOnly(path: path, options: options, output: output)
        }

        // 2. Reachability probe (fast, friendly failure).
        if !options.skipProbe {
            let reachability = HTTPProbe.check(serverURL: options.serverURL,
                                               username: options.username,
                                               password: options.password)
            output.log("probe: \(reachability.displayText)")
            if options.checkOnly {
                let code: SmokeExitCode = reachability.isOnline ? .ok : .probeFailed
                output.log("RESULT: \(code == .ok ? "PASS" : "FAIL") (exit \(code.rawValue))")
                return code.rawValue
            }
            if case .unauthorized = reachability {
                output.log("probe: 用户名或密码可能不正确，仍尝试挂载以确认…")
            }
        }

        // 3. Already mounted?
        var volume: MountedVolume?
        var mountedByUs = false
        var result = SmokeResult()
        result.url = options.serverURL.absoluteString
        result.user = options.username
        result.volumeName = MountClient.volumeName(for: options.serverURL)

        if let existing = MountClient.findMountedVolume(for: options.serverURL) {
            output.log("mount: 已检测到挂载卷 \(existing.path)，直接复用（不会卸载已存在的卷）")
            volume = existing
            result.alreadyMounted = true
        } else {
            let started = Date()
            do {
                let mounted = try MountClient.mount(serverURL: options.serverURL,
                                                    username: options.username,
                                                    password: options.password)
                let elapsed = Date().timeIntervalSince(started)
                volume = mounted
                mountedByUs = true
                result.mountSeconds = elapsed
                output.log(String(format: "mount: OK -> %@ (%.2fs)", mounted.path, elapsed))
            } catch let error as MountClientError {
                if case .volumeNotFound(let name, let path) = error {
                    output.log("mount: FAILED - 报告成功但找不到卷 \(name) @ \(path)")
                    output.log("RESULT: FAIL (exit \(SmokeExitCode.volumeNotFound.rawValue))")
                    return SmokeExitCode.volumeNotFound.rawValue
                }
                output.log("mount: FAILED - \(error.localizedDescription)")
                if case .mountFailed(let code, let detail) = error {
                    output.log("mount: raw code=\(code) detail=\(detail ?? "-")")
                }
                output.log("RESULT: FAIL (exit \(SmokeExitCode.mountFailed.rawValue))")
                return SmokeExitCode.mountFailed.rawValue
            } catch {
                output.log("mount: FAILED - \(error.localizedDescription)")
                output.log("RESULT: FAIL (exit \(SmokeExitCode.mountFailed.rawValue))")
                return SmokeExitCode.mountFailed.rawValue
            }
        }

        guard let mountedVolume = volume else {
            output.log("mount: FAILED - 内部错误：没有卷对象")
            return SmokeExitCode.internalError.rawValue
        }
        result.mountPath = mountedVolume.path
        output.log("mount: fs type = \(MountClient.fileSystemType(atPath: mountedVolume.path) ?? "unknown")")

        var exitCode: SmokeExitCode = .ok
        var testFileURL: URL?
        var expectedPayload: String?

        defer {
            if let testFileURL = testFileURL {
                try? FileManager.default.removeItem(at: testFileURL)
            }
        }

        // 4. List root.
        do {
            let entries = try FileManager.default.contentsOfDirectory(
                at: mountedVolume.url,
                includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey],
                options: []
            ).sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
            let visible = entries.filter { !$0.lastPathComponent.hasPrefix(".") }
            result.entryCount = visible.count
            result.entries = visible.prefix(20).map { $0.lastPathComponent }
            output.log("list: OK, \(visible.count) 个条目")
            if !visible.isEmpty {
                output.log("list: " + visible.prefix(10).map { item -> String in
                    let isDirectory = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                    return isDirectory ? "\(item.lastPathComponent)/" : item.lastPathComponent
                }.joined(separator: ", "))
            }
            if let expected = options.expectedItemName,
               !entries.contains(where: { $0.lastPathComponent == expected }) {
                output.log("list: FAILED - 根目录缺少预期条目“\(expected)”")
                exitCode = .listFailed
            }
        } catch {
            output.log("list: FAILED - \(error.localizedDescription)")
            exitCode = .listFailed
        }

        // 5. Write / read / verify / delete.
        if exitCode == .ok {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "yyyyMMdd-HHmmss"
            let name = "clouddisk-smoke-\(formatter.string(from: Date()))-\(String(UUID().uuidString.prefix(6))).txt"
            let url = mountedVolume.url.appendingPathComponent(name)
            let payload = "CloudDisk macOS smoke test\nurl=\(options.serverURL.absoluteString)\ndate=\(isoNow())\nuuid=\(UUID().uuidString)\n"
            do {
                try payload.write(to: url, atomically: true, encoding: .utf8)
                testFileURL = url
                expectedPayload = payload
                let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
                let size = (attributes[.size] as? NSNumber)?.intValue ?? -1
                output.log("write: OK \(name) (\(size) bytes)")
                result.testFile = name
            } catch {
                output.log("write: FAILED - \(error.localizedDescription)")
                exitCode = .writeFailed
            }
        }

        if exitCode == .ok, let url = testFileURL {
            do {
                let readBack = try String(contentsOf: url, encoding: .utf8)
                if let expected = expectedPayload, readBack == expected {
                    output.log("read: OK (\(readBack.count) chars, 内容校验通过)")
                } else {
                    output.log("read: FAILED - 内容不一致")
                    exitCode = .readFailed
                }
            } catch {
                output.log("read: FAILED - \(error.localizedDescription)")
                exitCode = .readFailed
            }
        }

        if let url = testFileURL {
            do {
                try FileManager.default.removeItem(at: url)
                if FileManager.default.fileExists(atPath: url.path) {
                    output.log("cleanup: FAILED - 测试文件仍存在")
                    exitCode = exitCode == .ok ? .writeFailed : exitCode
                } else {
                    output.log("cleanup: OK 测试文件已删除")
                }
                testFileURL = nil
            } catch {
                output.log("cleanup: WARN - 无法删除测试文件：\(error.localizedDescription)")
            }
        }

        // 6. Unmount (unless explicitly kept).
        if !options.keepMounted {
            if mountedByUs {
                let started = Date()
                let unmounted = unmountWithRetries(path: mountedVolume.path,
                                                   force: options.forceUnmount,
                                                   output: output)
                if unmounted {
                    result.unmounted = true
                    result.unmountSeconds = Date().timeIntervalSince(started)
                    output.log(String(format: "unmount: OK (%.2fs)", result.unmountSeconds ?? 0))
                } else {
                    output.log("unmount: FAILED - 卷仍在使用中。可执行：diskutil unmount force '\(mountedVolume.path)'")
                    exitCode = .unmountFailed
                }
            } else {
                output.log("unmount: 跳过（该卷在测试前已存在，保持原状）")
                result.unmounted = false
            }
        } else {
            output.log("unmount: 已跳过（--keep-mounted）；请手动断开：diskutil unmount '\(mountedVolume.path)'")
        }

        result.exitCode = exitCode.rawValue
        result.result = exitCode == .ok ? "PASS" : "FAIL"

        if options.json {
            output.log("SMOKE_JSON: \(jsonString(result))")
        }
        output.log("RESULT: \(result.result) (exit \(exitCode.rawValue))")
        if exitCode == .ok {
            output.log("挂载路径: \(mountedVolume.path)")
        }
        return exitCode.rawValue
    }

    // MARK: - Modes

    private static func runUnmountOnly(path: String, options: SmokeOptions, output: SmokeOutput) -> Int32 {
        guard MountClient.isVolumeMounted(atPath: path) else {
            output.log("unmount: \(path) 当前没有挂载")
            return SmokeExitCode.ok.rawValue
        }
        let started = Date()
        let ok = unmountWithRetries(path: path, force: options.forceUnmount, output: output)
        if ok {
            output.log(String(format: "unmount: OK (%.2fs)", Date().timeIntervalSince(started)))
            output.log("RESULT: PASS (exit 0)")
            return 0
        }
        output.log("RESULT: FAIL (exit \(SmokeExitCode.unmountFailed.rawValue))")
        return SmokeExitCode.unmountFailed.rawValue
    }

    private static func unmountWithRetries(path: String, force: Bool, output: SmokeOutput) -> Bool {
        for attempt in 1...3 {
            do {
                try MountClient.unmount(volumePath: path, force: false, timeout: 20)
                if MountClient.waitUntilUnmounted(volumePath: path, timeout: 5) { return true }
            } catch {
                output.log("unmount: 第 \(attempt) 次尝试失败 - \(error.localizedDescription)")
            }
            if attempt < 3 {
                output.log("unmount: 等待 1 秒后重试…")
                Thread.sleep(forTimeInterval: 1)
            }
        }
        if force {
            output.log("unmount: 尝试强制卸载…")
            do {
                try MountClient.unmount(volumePath: path, force: true, timeout: 10)
                if MountClient.waitUntilUnmounted(volumePath: path, timeout: 5) { return true }
            } catch {
                output.log("unmount: 强制卸载失败 - \(error.localizedDescription)")
            }
            // Last resort: ask DiskArbitration for a forced unmount.
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/sbin/diskutil")
            process.arguments = ["unmount", "force", path]
            try? process.run()
            process.waitUntilExit()
            return MountClient.waitUntilUnmounted(volumePath: path, timeout: 10)
        }
        return false
    }

    // MARK: - Helpers

    private struct SmokeResult {
        var url: String = ""
        var user: String = ""
        var volumeName: String = ""
        var mountPath: String?
        var alreadyMounted: Bool = false
        var mountSeconds: Double?
        var entryCount: Int = 0
        var entries: [String] = []
        var testFile: String?
        var unmounted: Bool = false
        var unmountSeconds: Double?
        var result: String = "FAIL"
        var exitCode: Int32 = 1
    }

    private static func jsonString(_ result: SmokeResult) -> String {
        var dictionary: [String: Any] = [
            "url": result.url,
            "user": result.user,
            "volumeName": result.volumeName,
            "alreadyMounted": result.alreadyMounted,
            "entryCount": result.entryCount,
            "entries": result.entries,
            "result": result.result,
            "exitCode": result.exitCode,
            "tool": toolName,
            "version": CloudDiskInfo.version,
        ]
        if let path = result.mountPath { dictionary["mountPath"] = path }
        if let seconds = result.mountSeconds { dictionary["mountSeconds"] = (seconds * 1000).rounded() / 1000 }
        if let file = result.testFile { dictionary["testFile"] = file }
        if let seconds = result.unmountSeconds { dictionary["unmountSeconds"] = (seconds * 1000).rounded() / 1000 }
        dictionary["unmounted"] = result.unmounted
        if let data = try? JSONSerialization.data(withJSONObject: dictionary, options: [.sortedKeys]),
           let json = String(data: data, encoding: .utf8) {
            return json
        }
        return "{}"
    }

    private static func isoNow() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: Date())
    }
}
