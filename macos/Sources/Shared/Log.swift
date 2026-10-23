//
//  Log.swift
//  Tern (Tern) macOS menu-bar client
//
//  Lightweight logger shared by the app, the bundled CLI helpers and the
//  menu-bar app.  Logs go to os_log and to
//  ~/Library/Logs/Tern.log (rotated at ~1 MB) so that users can attach a
//  file to a bug report.  The password is never logged.
//

import Foundation
import os

public enum CDLog {
    public static let subsystem = "com.tern.menubar"
    private static let osLogger = Logger(subsystem: subsystem, category: "Tern")
    private static let ioQueue = DispatchQueue(label: "com.tern.menubar.log")

    public static var directoryURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs", isDirectory: true)
    }

    public static var fileURL: URL {
        directoryURL.appendingPathComponent("Tern.log")
    }

    public static func info(_ message: String) {
        write("INFO", message)
    }

    public static func warn(_ message: String) {
        write("WARN", message)
    }

    public static func error(_ message: String) {
        write("ERROR", message)
    }

    /// Recent log content, newest last.  Used by the "打开日志" action.
    public static func tail(maxBytes: Int = 200_000) -> String {
        guard let data = try? Data(contentsOf: fileURL), !data.isEmpty else {
            return "(暂无日志)"
        }
        if data.count <= maxBytes { return String(decoding: data, as: UTF8.self) }
        return String(decoding: data.suffix(maxBytes), as: UTF8.self)
    }

    // MARK: - Internals

    private static func write(_ level: String, _ message: String) {
        let line = "\(timestamp()) [\(level)] \(message)\n"
        osLogger.log(level: level == "ERROR" ? .error : (level == "WARN" ? .default : .info), "\(message, privacy: .public)")
        ioQueue.async {
            append(line)
        }
    }

    private static func append(_ line: String) {
        let fm = FileManager.default
        do {
            try fm.createDirectory(at: directoryURL, withIntermediateDirectories: true)
            rotateIfNeeded()
            guard let data = line.data(using: .utf8) else { return }
            if fm.fileExists(atPath: fileURL.path) {
                let handle = try FileHandle(forWritingTo: fileURL)
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
                try handle.close()
            } else {
                try data.write(to: fileURL, options: .atomic)
            }
        } catch {
            // Logging must never take the app down.
        }
    }

    private static func rotateIfNeeded() {
        let fm = FileManager.default
        guard let attrs = try? fm.attributesOfItem(atPath: fileURL.path),
              let size = attrs[.size] as? NSNumber,
              size.intValue > 1_000_000 else { return }
        let backup = fileURL.deletingLastPathComponent().appendingPathComponent("Tern.previous.log")
        try? fm.removeItem(at: backup)
        try? fm.moveItem(at: fileURL, to: backup)
    }

    private static func timestamp() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        return formatter.string(from: Date())
    }
}
