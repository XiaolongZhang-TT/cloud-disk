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
                          prompt: Text("https://example.com/Tern"))
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
                Toggle("登录时自动启动 Tern", isOn: $settings.connectAtLogin)
                Text("登录启动通过 ~/Library/LaunchAgents/\(LaunchAgentManager.label).plist 实现。实时同步 watcher 需要 Tern 菜单栏 App 保持运行，建议开启。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } header: {
                Text("启动")
            }

            Section {
                LabeledContent("File Provider", value: model.fileProviderStatus)
                LabeledContent("同步状态", value: model.syncStatusText)
                HStack {
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
                    Button("在 Finder 中打开") {
                        model.openInFinder()
                    }
                }
                Text("Finder 会按需下载文件，并支持在线/离线写入、冲突副本和保持下载。首次启用可能需要在 系统设置 → 通用 → 登录项与扩展 中允许 File Provider。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let fileProviderMessage {
                    Text(fileProviderMessage)
                        .font(.callout)
                        .foregroundStyle(fileProviderMessage.hasPrefix("✅") ? .green : .red)
                        .textSelection(.enabled)
                }
            } header: {
                Text("Finder 位置")
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
        .frame(minWidth: 560, idealWidth: 600, minHeight: 560, idealHeight: 620)
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
                                        connectAtLogin: settings.connectAtLogin)
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
