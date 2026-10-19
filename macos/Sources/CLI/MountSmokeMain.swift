//
//  MountSmokeMain.swift
//  Tern (Tern) macOS menu-bar client
//
//  Standalone `mount-smoke` CLI.  The heavy lifting lives in
//  Shared/SmokeRunner.swift so the same logic is also available as the app's
//  hidden `--smoke` mode.
//

import Foundation
import Darwin

@main
struct MountSmokeMain {
    static func main() {
        let arguments = Array(CommandLine.arguments.dropFirst())

        switch SmokeRunner.parse(arguments: arguments) {
        case .failure(let error):
            switch error.message {
            case "__HELP__":
                print(SmokeRunner.usageText())
                exit(0)
            case "__VERSION__":
                print("\(SmokeRunner.toolName) \(TernInfo.version)")
                exit(0)
            default:
                FileHandle.standardError.write(Data(("错误：\(error.message)\n\n" + SmokeRunner.usageText() + "\n").utf8))
                exit(SmokeExitCode.usage.rawValue)
            }
        case .success(let options):
            if options.password.isEmpty && !options.checkOnly && options.unmountPath == nil {
                FileHandle.standardError.write(Data("""
                错误：没有密码。请使用 --password '密码'、--password-stdin、--keychain，
                或设置环境变量 TERN_PASSWORD。

                """.utf8))
                FileHandle.standardError.write(Data((SmokeRunner.usageText() + "\n").utf8))
                exit(SmokeExitCode.usage.rawValue)
            }
            exit(SmokeRunner.run(options: options))
        }
    }
}
