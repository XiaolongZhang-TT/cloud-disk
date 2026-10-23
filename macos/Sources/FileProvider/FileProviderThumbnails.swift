//
//  FileProviderThumbnails.swift
//  Local thumbnail generation for image files.  The full image is downloaded
//  through the same on-demand path and then downsampled before it reaches Finder.
//

import Foundation
import FileProvider
import ImageIO
import UniformTypeIdentifiers

extension FileProviderExtension: NSFileProviderThumbnailing {

    func fetchThumbnails(
        for itemIdentifiers: [NSFileProviderItemIdentifier],
        requestedSize size: CGSize,
        perThumbnailCompletionHandler: @escaping (NSFileProviderItemIdentifier, Data?, Error?) -> Void,
        completionHandler: @escaping (Error?) -> Void
    ) -> Progress {
        let progress = Progress.discreteProgress(totalUnitCount: Int64(itemIdentifiers.count))
        let group = DispatchGroup()

        for identifier in itemIdentifiers {
            group.enter()
            Task {
                defer {
                    progress.completedUnitCount += 1
                    group.leave()
                }
                do {
                    guard let stored = store.item(id: identifier.rawValue), !stored.isFolder else {
                        perThumbnailCompletionHandler(identifier, nil, nil)
                        return
                    }
                    guard Self.looksLikeImage(stored) else {
                        perThumbnailCompletionHandler(identifier, nil, nil)
                        return
                    }
                    let data: Data
                    if let pending = store.pendingContentURL(nodeId: stored.id) {
                        data = try Data(contentsOf: pending)
                    } else {
                        let client = try store.makeClient()
                        data = try await client.fetchFile(id: stored.id).data
                    }
                    let thumbnail = Self.thumbnail(data: data, maxPixelSize: max(size.width, size.height))
                    perThumbnailCompletionHandler(identifier, thumbnail, nil)
                } catch {
                    perThumbnailCompletionHandler(identifier, nil, error)
                }
            }
        }

        group.notify(queue: .global()) {
            completionHandler(nil)
        }
        return progress
    }

    private static func looksLikeImage(_ item: StoredItem) -> Bool {
        if let mime = item.mime, mime.hasPrefix("image/") { return true }
        let ext = (item.name as NSString).pathExtension.lowercased()
        return ["jpg", "jpeg", "png", "heic", "heif", "gif", "webp", "tiff", "bmp"].contains(ext)
    }

    private static func thumbnail(data: Data, maxPixelSize: CGFloat) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(64, Int(maxPixelSize)),
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output as CFMutableData,
            UTType.png.identifier as CFString,
            1,
            nil
        ) else { return nil }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return output as Data
    }
}
