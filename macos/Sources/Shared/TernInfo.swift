//
//  TernInfo.swift
//  Tern (Tern) macOS menu-bar client
//

import Foundation

public enum TernInfo {
    public static let appName = "Tern"
    public static let volumeBrand = "Tern"
    public static let bundleIdentifier = "com.tern.menubar"
    public static let fallbackVersion = "1.1.1"

    public static var version: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? fallbackVersion
    }

    public static var build: String {
        (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "1"
    }

    public static var versionDescription: String {
        "\(appName) \(version) (\(build))"
    }
}
