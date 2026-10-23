//
//  FileProviderBridge.swift
//  Main-app side of the File Provider integration.
//
//  Phase 1 registers a read-only domain.  The extension reads credentials from
//  the app group / shared Keychain; no password is passed through XPC.
//

import Foundation
import FileProvider
import AppKit

@available(macOS 13.0, *)
public enum FileProviderBridge {

    public static var domain: NSFileProviderDomain {
        NSFileProviderDomain(
            identifier: NSFileProviderDomainIdentifier(rawValue: FileProviderShared.domainIdentifier),
            displayName: "Tern"
        )
    }

    public static func addDomain() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            NSFileProviderManager.add(domain) { error in
                if let error {
                    // Re-adding the same domain is harmless; the system updates
                    // the display name and returns no error in normal cases.
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }

    public static func removeDomain() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            NSFileProviderManager.remove(domain) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }

    public static func openInFinder() {
        let url = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library/CloudStorage", isDirectory: true)
        NSWorkspace.shared.open(url)
    }
}
