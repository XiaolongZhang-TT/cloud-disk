//
//  SettingsView.swift
//  Tern (Tern) macOS menu-bar client
//

import SwiftUI
import AppKit

struct SettingsView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var settings: SettingsStore

    @State private var password = ""
    @State private var showPassword = false
    @State private var message: String?
    @State private var messageIsError = false
    @State private var testResult: String?
    @State private var testing = false
    @State private var enablingFileProvider = false
    @State private var fileProviderMessage: String?

    var body: some View {
        Form {
            Section {
                TextField("服务器地址", text: $settings.serverURLText,
                          prompt: Text("http://192.168.1.10:8080/Tern"))
                TextField("用户名", text: $settings.username,
                          prompt: Text("与 Tern 网页登录账号相同"))
                HStack {
                    if showPassword {
                        TextField("密码", text: $password, prompt: Text("输入密码后保存到钥匙串"))
                    } else {
                        SecureField("密码", text: $password, prompt: Text("输入密码后保存到钥匙串"))
                    }
                    Button(showPassword ? "隐藏" : "显示") { showPassword.toggle() }
                        .buttonStyle(.link)
                }
                LabeledContent("密码状态") {
                    if !password.isEmpty {
                        Text("保存后写入 macOS 钥匙串")
                    } else if model.credentialsReady {
                        Text("已保存在 macOS 钥匙串")
                    } else {
                        Text("尚未保存").foregroundStyle(.secondary)
                    }
                }
                Text("密码只保存在 macOS 钥匙串中，绝不会写入偏好设置或日志。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } header: {
                Text("服务器")
            }

            Section {
                Toggle("登录时自动启动 Tern（LaunchAgent）", isOn: $settings.connectAtLogin)
                Toggle("启动后自动连接", isOn: $settings.autoConnect)
                Text("登录启动通过 ~/Library/LaunchAgents/\(LaunchAgentManager.label).plist 实现，适合本地构建、无开发者账号的应用。移动 App 后重新打开会自动修正路径。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } header: {
                Text("启动")
            }

            Section {
                LabeledContent("卷名称", value: model.volumeName)
                LabeledContent("默认挂载点", value: model.expectedMountPath)
                LabeledContent("当前状态", value: model.statusHeadline)
                if let volumePath = model.volumePath {
                    LabeledContent("实际挂载点", value: volumePath)
                }
                LabeledContent("服务器在线", value: model.onlineText)
                Text("卷名取自服务器地址的最后一段路径；使用 /Tern 时卷名为 Tern，并会出现在 Finder 侧边栏的“位置”中。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } header: {
                Text("挂载")
            }

            Section {
                HStack {
                    Button(testing ? "正在测试…" : "测试服务器") {
                        test()
                    }
                    .disabled(testing)
                    Button("保存") {
                        save()
                    }
                    Spacer()
                    Button("关闭") {
                        NSApp.keyWindow?.close()
                    }
                }
                if let testResult = testResult {
                    Text(testResult)
                        .font(.callout)
                        .foregroundStyle(testResult.hasPrefix("✅") ? .green : .red)
                        .textSelection(.enabled)
                }
                if let message = message {
                    Text(message)
                        .font(.callout)
                        .foregroundStyle(messageIsError ? .red : .secondary)
                        .textSelection(.enabled)
                }
            }

            Section {
                Button(enablingFileProvider ? "正在添加…" : "在 Finder 中启用 Tern") {
                    enablingFileProvider = true
                    fileProviderMessage = nil
                    Task {
                        let result = await model.enableFileProvider()
                        await MainActor.run {
                            fileProviderMessage = result
                            enablingFileProvider = false
                        }
                    }
                }
                .disabled(enablingFileProvider)
                Text("Finder 会按需下载文件，并支持在线/离线写入、冲突副本和保持下载。首次启用可能需要在系统设置中允许 File Provider。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let fileProviderMessage {
                    Text(fileProviderMessage)
                        .font(.callout)
                        .foregroundStyle(fileProviderMessage.hasPrefix("✅") ? .green : .red)
                        .textSelection(.enabled)
                }
            } header: {
                Text("Finder 离线位置")
            }

            Section {
                Text("启用 File Provider 后，可以断开旧的 /Volumes/Tern 网络盘，避免 Finder 里出现两个 Tern。会关闭自动挂载，但保留 Tern 登录启动，供 File Provider 实时同步。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("断开 WebDAV 网络盘（保留登录启动）") {
                    fileProviderMessage = model.disableWebDAVMount()
                }
            } header: {
                Text("从 WebDAV 迁移")
            }

            Section {
                LabeledContent("版本", value: TernInfo.versionDescription)
                LabeledContent("应用路径", value: Bundle.main.bundleURL.path)
                LabeledContent("登录启动", value: LaunchAgentManager.statusDescription())
                HStack {
                    Button("打开日志") { model.openLog() }
                    Button("打开应用所在文件夹") {
                        NSWorkspace.shared.activateFileViewerSelecting([Bundle.main.bundleURL])
                    }
                }
            } header: {
                Text("关于与诊断")
            }
        }
        .formStyle(.grouped)
        .frame(minWidth: 560, idealWidth: 600, minHeight: 620, idealHeight: 680)
        .onAppear {
            password = ""
            model.refreshCredentialState()
        }
    }

    // MARK: - Actions

    private func save() {
        let error = model.applySettings(serverURLText: settings.serverURLText,
                                        username: settings.username,
                                        password: password.isEmpty ? nil : password,
                                        connectAtLogin: settings.connectAtLogin,
                                        autoConnect: settings.autoConnect)
        if let error = error {
            message = "❌ \(error)"
            messageIsError = true
        } else {
            password = ""
            message = "✅ 设置已保存"
            messageIsError = false
            model.refreshCredentialState()
        }
    }

    private func test() {
        testing = true
        testResult = nil
        let urlText = settings.serverURLText
        let username = settings.username
        let currentPassword = password
        Task {
            let result = await model.testConnection(serverURLText: urlText,
                                                    username: username,
                                                    password: currentPassword)
            testResult = result
            testing = false
        }
    }
}

// MARK: - Settings window

/// Opens a real AppKit settings window.
///
/// We deliberately do **not** rely on the private `showSettingsWindow:` action:
/// on recent macOS releases it can return `true` without actually showing the
/// SwiftUI Settings scene (especially for LSUIElement/menu-bar-only apps), which
/// made the menu item appear to do nothing. A dedicated NSWindow is predictable
/// across macOS 13–27 and can always be brought to the front.
@MainActor
enum SettingsWindowHelper {

    static func openSettings() {
        CDLog.info("settings: opening settings window")
        SettingsWindowController.shared.show()
    }
}

final class SettingsWindowController: NSWindowController, NSWindowDelegate {

    static let shared = SettingsWindowController()

    private init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 680),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered,
                              defer: false)
        window.title = "Tern 设置"
        window.isReleasedWhenClosed = false
        window.center()
        super.init(window: window)
        window.delegate = self
        let root = SettingsView(model: AppModel.shared, settings: SettingsStore.shared)
            .frame(minWidth: 560, minHeight: 620)
        window.contentViewController = NSHostingController(rootView: root)
        window.setContentSize(NSSize(width: 600, height: 680))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func show() {
        NSApp.activate(ignoringOtherApps: true)
        showWindow(nil)
        window?.center()
        window?.makeKeyAndOrderFront(nil)
        window?.orderFrontRegardless()
        CDLog.info("settings: window visible=\(window?.isVisible ?? false)")
    }
}
