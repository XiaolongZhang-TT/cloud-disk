//
//  UpdateChecker.swift
//  Lightweight release check for the menu-bar app. macOS updates are shown as
//  a link because a distributable build requires Developer ID notarization.
//

import AppKit
import Foundation

enum UpdateChecker {
    private static let latestRelease = URL(string: "https://api.github.com/repos/XiaolongZhang-dev/tern/releases/latest")!

    static func checkAndNotify() async {
        do {
            var request = URLRequest(url: latestRelease)
            request.timeoutInterval = 12
            request.setValue("Tern-macOS/1.0", forHTTPHeaderField: "User-Agent")
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return }
            guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let tag = root["tag_name"] as? String else { return }
            let latest = tag.trimmingCharacters(in: CharacterSet(charactersIn: "vV"))
            guard isNewer(latest, than: TernInfo.version) else { return }
            let releaseURL = (root["html_url"] as? String).flatMap(URL.init(string:))
                ?? URL(string: "https://github.com/XiaolongZhang-dev/tern/releases")!
            await MainActor.run {
                let alert = NSAlert()
                alert.messageText = "Tern \(latest) 可用"
                alert.informativeText = "当前版本 \(TernInfo.version)。打开下载页获取新版本。"
                alert.addButton(withTitle: "打开下载页")
                alert.addButton(withTitle: "稍后")
                if alert.runModal() == .alertFirstButtonReturn {
                    NSWorkspace.shared.open(releaseURL)
                }
            }
        } catch {
            CDLog.warn("update check failed: \(error.localizedDescription)")
        }
    }

    private static func isNewer(_ candidate: String, than current: String) -> Bool {
        func parts(_ value: String) -> [Int] {
            value.split(separator: ".").map { Int($0) ?? 0 }
        }
        let lhs = parts(candidate)
        let rhs = parts(current)
        for index in 0..<max(lhs.count, rhs.count) {
            let left = index < lhs.count ? lhs[index] : 0
            let right = index < rhs.count ? rhs[index] : 0
            if left != right { return left > right }
        }
        return false
    }
}
