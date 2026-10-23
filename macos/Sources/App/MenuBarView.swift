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
            // Header
            Text("Tern")
            Text(model.statusHeadline)
                .font(.headline)
            if let detail = model.statusDetail {
                Text(detail)
                    .font(.caption)
            }

            if model.status.isConnected {
                Text("服务器：\(model.serverURLText)")
                    .font(.caption)
                Text("在线状态：\(model.onlineIndicator)")
                    .font(.caption)
            } else {
                Divider()
                Text("服务器：\(model.serverURLText)")
                    .font(.caption)
                if !model.credentialsReady {
                    Text("⚠️ 尚未保存密码，请在设置中填写")
                        .font(.caption)
                }
            }

            if let error = model.lastError, !model.status.isConnected {
                Divider()
                Text("错误：\(error)")
                    .font(.caption)
            }

            if model.isBusy {
                Divider()
                Text(model.status == .disconnecting ? "正在断开，请稍候…" : "正在连接，请稍候…")
                    .font(.caption)
            }
        }

        let sync = FileProviderShared.syncStatus()
        if sync.pending > 0 || sync.error != nil {
            Divider()
            Text("Finder 离线位置")
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

        if model.canConnect {
            Button(model.didFail ? "重试连接" : "连接") {
                model.connect()
            }
        }
        if model.canDisconnect {
            Button("断开连接") {
                model.disconnect()
            }
        }
        if model.status.isConnected {
            Button("重新连接") {
                model.reconnect()
            }
        }
        if model.volumePath != nil || model.status.isConnected {
            Button("在 Finder 中打开") {
                model.openInFinder()
            }
        }
        if model.status.isConnected {
            Button("强制断开（卡住时使用）") {
                model.disconnect(force: true)
            }
        }
        if let stale = model.staleMountPath {
            Button("清理残留挂载点 \(stale)") {
                model.cleanStaleMountPoint()
            }
        }
        Button("复制服务器地址") {
            model.copyServerAddress()
        }

        Divider()

        Button("设置…") {
            model.openSettings()
        }
        .keyboardShortcut(",", modifiers: .command)

        Button("打开日志") {
            model.openLog()
        }

        Divider()

        Button("退出Tern") {
            model.quit()
        }
        .keyboardShortcut("q", modifiers: .command)
    }
}
