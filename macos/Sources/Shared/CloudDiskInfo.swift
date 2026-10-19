//
//  CloudDiskInfo.swift
//  CloudDisk (云屿) macOS menu-bar client
//

import Foundation

public enum CloudDiskInfo {
    public static let appName = "云屿 CloudDisk"
    public static let volumeBrand = "CloudDisk"
    public static let bundleIdentifier = "com.clouddisk.menubar"
    public static let fallbackVersion = "1.0.0"

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
