//
//  FileProviderBridge.swift
//  Main-app side of the File Provider integration.
//
//  Registers the replicated File Provider domain.  Connection metadata and
//  credentials live in shared Keychain items; no password is passed through XPC.
//

import Foundation
import FileProvider
import AppKit

@available(macOS 13.0, *)
public enum FileProviderBridge {

    public static var domain: NSFileProviderDomain {
        let domain = NSFileProviderDomain(
            identifier: NSFileProviderDomainIdentifier(rawValue: FileProviderShared.domainIdentifier),
            displayName: "Tern"
        )
        return domain
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

    public static func removeDomain(identifier: String? = nil) async throws {
        let target = identifier.map {
            NSFileProviderDomain(
                identifier: NSFileProviderDomainIdentifier(rawValue: $0),
                displayName: "Tern"
            )
        } ?? domain
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            NSFileProviderManager.remove(target, mode: .removeAll) { _, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }

    /// Ask File Provider to re-enumerate after a network change or a local
    /// write.  Safe to call when the domain is not configured.
    public static func signalChanges() {
        let manager = NSFileProviderManager(for: domain)
        manager?.signalEnumerator(for: .workingSet) { _ in }
        manager?.signalEnumerator(for: .rootContainer) { _ in }
    }

    public static func openInFinder() {
        let url = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library/CloudStorage", isDirectory: true)
        NSWorkspace.shared.open(url)
    }
}
