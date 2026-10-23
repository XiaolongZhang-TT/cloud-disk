//
//  MenuBarView.swift
//  Tern (Tern) macOS menu-bar client
//
//  The dropdown attached to the menu-bar icon.
//

import SwiftUI

struct MenuBarView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        Group {
            Text("Tern")
            Text(model.statusHeadline)
                .font(.headline)
            if let detail = model.statusDetail {
                Text(detail)
                    .font(.caption)
            }
            Text("服务器：\(model.serverURLText)")
                .font(.caption)
            if !model.credentialsReady {
                Text("⚠️ 尚未保存密码，请在设置中填写")
                    .font(.caption)
            }
            if let error = model.lastError, FileProviderShared.loadConfiguration() != nil {
                Text("错误：\(error)")
                    .font(.caption)
            }
        }

        let sync = FileProviderShared.syncStatus()
        if sync.pending > 0 || sync.error != nil {
            Divider()
            Text("File Provider")
                .font(.caption)
            if sync.pending > 0 {
                Text("待上传：\(sync.pending) 项")
                    .font(.caption)
            }
            if let error = sync.error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }

        Divider()

        if FileProviderShared.loadConfiguration() != nil {
            Button("在 Finder 中打开") {
                model.openInFinder()
            }
        } else {
            Button("配置 Tern…") {
                model.openSettings()
            }
        }
        Button("设置…") {
            model.openSettings()
        }
        .keyboardShortcut(",", modifiers: .command)

        Divider()
        Button("发送剪贴板到 Tern") {
            model.sendClipboardToTern()
        }
        Button("从 Tern 获取剪贴板") {
            model.fetchClipboardFromTern()
        }

        Divider()
        Button("复制服务器地址") {
            model.copyServerAddress()
        }
        Button("打开日志") {
            model.openLog()
        }

        Divider()

        Button("退出 Tern") {
            model.quit()
        }
        .keyboardShortcut("q", modifiers: .command)
    }
}
