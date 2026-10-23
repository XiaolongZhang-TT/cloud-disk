//
//  FileProviderItem.swift
//  Read-only File Provider items for Phase 1.
//

import Foundation
import FileProvider
import UniformTypeIdentifiers

enum TernItemFactory {
    static func contentType(for stored: StoredItem) -> UTType {
        if stored.isFolder { return .folder }
        if let mime = stored.mime, let type = UTType(mimeType: mime) { return type }
        if let ext = stored.name.split(separator: ".").last, !ext.isEmpty,
           let type = UTType(filenameExtension: String(ext)) { return type }
        return .data
    }

    static func date(_ text: String?) -> Date? {
        guard let text else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: text) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: text)
    }

    static func version(for stored: StoredItem) -> NSFileProviderItemVersion {
        let content = Data((stored.etag ?? "\(stored.id)-\(stored.updatedAt ?? "")").utf8)
        let metadata = Data((stored.updatedAt ?? stored.etag ?? stored.id).utf8)
        return NSFileProviderItemVersion(
            contentVersion: Data(content.prefix(128)),
            metadataVersion: Data(metadata.prefix(128))
        )
    }
}

public final class TernItem: NSObject, NSFileProviderItem {

    public let itemIdentifier: NSFileProviderItemIdentifier
    public let parentItemIdentifier: NSFileProviderItemIdentifier
    public let filename: String
    public let contentType: UTType
    public let documentSize: NSNumber?
    public let creationDate: Date?
    public let contentModificationDate: Date?
    public let itemVersion: NSFileProviderItemVersion
    public let capabilities: NSFileProviderItemCapabilities
    public let isDownloaded: Bool
    public let isUploaded: Bool
    public let isMostRecentVersionDownloaded: Bool

    public init(stored: StoredItem) {
        itemIdentifier = NSFileProviderItemIdentifier(rawValue: stored.id)
        parentItemIdentifier = stored.parentId.map { NSFileProviderItemIdentifier(rawValue: $0) }
            ?? NSFileProviderItemIdentifier.rootContainer
        filename = stored.name
        contentType = TernItemFactory.contentType(for: stored)
        documentSize = stored.isFolder ? nil : NSNumber(value: stored.size)
        creationDate = TernItemFactory.date(stored.createdAt)
        contentModificationDate = TernItemFactory.date(stored.updatedAt)
        itemVersion = TernItemFactory.version(for: stored)
        capabilities = stored.isFolder
            ? [.allowsContentEnumerating, .allowsReading]
            : [.allowsReading]
        isDownloaded = false
        isUploaded = true
        isMostRecentVersionDownloaded = false
        super.init()
    }
}

public final class TernRootItem: NSObject, NSFileProviderItem {
    public let itemIdentifier: NSFileProviderItemIdentifier = .rootContainer
    public let parentItemIdentifier: NSFileProviderItemIdentifier = .rootContainer
    public let filename: String = "Tern"
    public let contentType: UTType = .folder
    public let documentSize: NSNumber? = nil
    public let creationDate: Date? = nil
    public let contentModificationDate: Date? = nil
    public let itemVersion = NSFileProviderItemVersion(
        contentVersion: Data("tern-root".utf8),
        metadataVersion: Data("tern-root".utf8)
    )
    public let capabilities: NSFileProviderItemCapabilities = [.allowsContentEnumerating, .allowsReading]
    public let isDownloaded: Bool = true
    public let isUploaded: Bool = true
    public let isMostRecentVersionDownloaded: Bool = true
}
