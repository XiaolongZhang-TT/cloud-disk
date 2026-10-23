//
//  FileProviderExtension.swift
//  Phase 1: read-only File Provider.
//
//  Writes intentionally return NSFeatureUnsupportedError until the sync
//  engine's upload/conflict handling is implemented.
//

import Foundation
import FileProvider
import UniformTypeIdentifiers

final class FileProviderExtension: NSObject, NSFileProviderReplicatedExtension {

    private let domain: NSFileProviderDomain
    private let store = FileProviderStore()

    required init(domain: NSFileProviderDomain) {
        self.domain = domain
        super.init()
    }

    func invalidate() {}

    // MARK: - Metadata

    func item(for identifier: NSFileProviderItemIdentifier,
              request: NSFileProviderRequest,
              completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void) -> Progress {
        let progress = Progress.discreteProgress(totalUnitCount: 1)
        if identifier == .rootContainer {
            progress.completedUnitCount = 1
            completionHandler(TernRootItem(), nil)
            return progress
        }

        if let stored = store.item(id: identifier.rawValue) {
            progress.completedUnitCount = 1
            completionHandler(TernItem(stored: stored), nil)
            return progress
        }

        Task {
            do {
                if store.cursor == 0 { _ = try await store.sync(forceBootstrap: true) }
                if let stored = store.item(id: identifier.rawValue) {
                    progress.completedUnitCount = 1
                    completionHandler(TernItem(stored: stored), nil)
                } else {
                    completionHandler(nil, Self.noSuchItem())
                }
            } catch {
                completionHandler(nil, Self.providerError(error))
            }
        }
        return progress
    }

    // MARK: - Contents

    func fetchContents(for itemIdentifier: NSFileProviderItemIdentifier,
                       version requestedVersion: NSFileProviderItemVersion?,
                       request: NSFileProviderRequest,
                       completionHandler: @escaping (URL?, NSFileProviderItem?, Error?) -> Void) -> Progress {
        let progress = Progress.discreteProgress(totalUnitCount: 100)
        Task {
            do {
                guard let stored = store.item(id: itemIdentifier.rawValue), !stored.isFolder else {
                    completionHandler(nil, nil, Self.noSuchItem())
                    return
                }
                let client = try store.makeClient()
                let result = try await client.fetchFile(id: stored.id)
                let directory = FileManager.default.temporaryDirectory
                    .appendingPathComponent("TernFileProvider", isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let fileURL = directory.appendingPathComponent(UUID().uuidString)
                    .appendingPathExtension((stored.name as NSString).pathExtension.isEmpty ? "data" : (stored.name as NSString).pathExtension)
                try result.data.write(to: fileURL, options: .atomic)
                progress.completedUnitCount = 100
                completionHandler(fileURL, TernItem(stored: stored), nil)
            } catch {
                completionHandler(nil, nil, Self.providerError(error))
            }
        }
        return progress
    }

    // MARK: - Read-only write stubs

    func createItem(basedOn itemTemplate: NSFileProviderItem,
                    fields: NSFileProviderItemFields,
                    contents url: URL?,
                    options: NSFileProviderCreateItemOptions = [],
                    request: NSFileProviderRequest,
                    completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void) -> Progress {
        let progress = Progress.discreteProgress(totalUnitCount: 1)
        completionHandler(nil, [], false, Self.unsupported())
        return progress
    }

    func modifyItem(_ item: NSFileProviderItem,
                    baseVersion version: NSFileProviderItemVersion,
                    changedFields: NSFileProviderItemFields,
                    contents newContents: URL?,
                    options: NSFileProviderModifyItemOptions = [],
                    request: NSFileProviderRequest,
                    completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void) -> Progress {
        let progress = Progress.discreteProgress(totalUnitCount: 1)
        completionHandler(nil, [], false, Self.unsupported())
        return progress
    }

    func deleteItem(identifier: NSFileProviderItemIdentifier,
                    baseVersion version: NSFileProviderItemVersion,
                    options: NSFileProviderDeleteItemOptions = [],
                    request: NSFileProviderRequest,
                    completionHandler: @escaping (Error?) -> Void) -> Progress {
        let progress = Progress.discreteProgress(totalUnitCount: 1)
        completionHandler(Self.unsupported())
        return progress
    }

    // MARK: - Enumeration

    func enumerator(for containerItemIdentifier: NSFileProviderItemIdentifier,
                    request: NSFileProviderRequest) throws -> NSFileProviderEnumerator {
        if containerItemIdentifier == .trashContainer {
            throw Self.unsupported()
        }
        if containerItemIdentifier == .rootContainer || containerItemIdentifier == .workingSet {
            return TernEnumerator(container: containerItemIdentifier, store: store)
        }
        guard store.item(id: containerItemIdentifier.rawValue) != nil else {
            throw Self.noSuchItem()
        }
        return TernEnumerator(container: containerItemIdentifier, store: store)
    }

    // MARK: - Errors

    private static func providerError(_ error: Error) -> NSError {
        let description = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        return NSError(domain: NSFileProviderErrorDomain, code: -1004, userInfo: [
            NSLocalizedDescriptionKey: description,
        ])
    }

    private static func noSuchItem() -> NSError {
        NSError(domain: NSFileProviderErrorDomain, code: -1005, userInfo: [
            NSLocalizedDescriptionKey: "Tern 中不存在该文件。",
        ])
    }

    private static func unsupported() -> NSError {
        NSError(domain: NSCocoaErrorDomain, code: NSFeatureUnsupportedError, userInfo: [
            NSLocalizedDescriptionKey: "Tern File Provider 目前是只读版本，写入功能将在下一阶段开放。",
        ])
    }
}
