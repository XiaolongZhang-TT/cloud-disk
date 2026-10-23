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
                let data: Data
                if let pendingURL = store.pendingContentURL(nodeId: stored.id) {
                    data = try Data(contentsOf: pendingURL)
                } else {
                    let client = try store.makeClient()
                    data = try await client.fetchFile(id: stored.id).data
                }
                let manager = NSFileProviderManager(for: domain)
                let directory = (manager.flatMap { try? $0.temporaryDirectoryURL() })
                    ?? FileManager.default.temporaryDirectory.appendingPathComponent("TernFileProvider", isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let fileURL = directory.appendingPathComponent(UUID().uuidString)
                    .appendingPathExtension((stored.name as NSString).pathExtension.isEmpty ? "data" : (stored.name as NSString).pathExtension)
                try data.write(to: fileURL, options: .atomic)
                progress.completedUnitCount = 100
                completionHandler(fileURL, TernItem(stored: stored), nil)
            } catch {
                completionHandler(nil, nil, Self.providerError(error))
            }
        }
        return progress
    }

    // MARK: - Writes

    func createItem(basedOn itemTemplate: NSFileProviderItem,
                    fields: NSFileProviderItemFields,
                    contents url: URL?,
                    options: NSFileProviderCreateItemOptions = [],
                    request: NSFileProviderRequest,
                    completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void) -> Progress {
        let progress = Progress.discreteProgress(totalUnitCount: 100)
        let parent = itemTemplate.parentItemIdentifier == .rootContainer ? nil : itemTemplate.parentItemIdentifier.rawValue
        let name = itemTemplate.filename
        let isFolder = itemTemplate.contentType == .folder
        let clientId = UUID().uuidString.lowercased()

        Task {
            do {
                let client = try store.makeClient()
                let change: TernChange
                if isFolder {
                    change = try await client.createFolder(parentId: parent, name: name, clientId: clientId)
                } else {
                    guard let url, let data = try? Data(contentsOf: url) else {
                        completionHandler(nil, [], false, Self.unsupported())
                        return
                    }
                    let mime = itemTemplate.contentType?.preferredMIMEType ?? "application/octet-stream"
                    change = try await client.uploadFile(parentId: parent, name: name, clientId: clientId, data: data, mime: mime)
                }
                guard let stored = store.upsert(change) else {
                    throw SyncClientError.malformedResponse
                }
                progress.completedUnitCount = 100
                signalChanges()
                completionHandler(TernItem(stored: stored), [], false, nil)
            } catch {
                guard Self.isOffline(error) else {
                    completionHandler(nil, [], false, Self.providerError(error))
                    return
                }
                let localId = UUID().uuidString.lowercased()
                let now = ISO8601DateFormatter().string(from: Date())
                var contentFile: String? = nil
                if !isFolder, let url {
                    if let data = try? Data(contentsOf: url) {
                        contentFile = store.pending.writeContent(data)
                    }
                }
                let kind: PendingKind = isFolder ? .createFolder : .createFile
                store.pending.add(PendingOperation(
                    id: UUID().uuidString,
                    kind: kind,
                    clientId: localId,
                    nodeId: localId,
                    parentId: parent,
                    name: name,
                    moveToRoot: false,
                    contentFile: contentFile,
                    baseEtag: nil,
                    createdAt: Date().timeIntervalSince1970
                ))
                let local = StoredItem(
                    id: localId,
                    parentId: parent,
                    name: name,
                    type: isFolder ? "folder" : "file",
                    size: 0,
                    mime: itemTemplate.contentType?.preferredMIMEType,
                    createdAt: now,
                    updatedAt: now,
                    etag: nil,
                    deleted: false,
                    pending: true
                )
                store.upsertLocal(local)
                completionHandler(TernItem(stored: local), [], false, nil)
            }
        }
        return progress
    }

    func modifyItem(_ item: NSFileProviderItem,
                    baseVersion version: NSFileProviderItemVersion,
                    changedFields: NSFileProviderItemFields,
                    contents newContents: URL?,
                    options: NSFileProviderModifyItemOptions = [],
                    request: NSFileProviderRequest,
                    completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void) -> Progress {
        let progress = Progress.discreteProgress(totalUnitCount: 100)
        Task {
            do {
                guard let stored = store.item(id: item.itemIdentifier.rawValue) else {
                    completionHandler(nil, [], false, Self.noSuchItem())
                    return
                }
                let client = try store.makeClient()
                var latest = stored
                let baseEtag = changedFields.contains(.contents)
                    ? String(data: version.contentVersion, encoding: .utf8)
                    : nil

                if changedFields.contains(.contents), let newContents {
                    let data = try Data(contentsOf: newContents)
                    let updated = try await client.updateContent(id: stored.id, data: data, ifMatch: baseEtag)
                    if let storedUpdated = store.upsert(updated) { latest = storedUpdated }
                }
                if changedFields.contains(.filename) || changedFields.contains(.parentItemIdentifier) {
                    let newName = changedFields.contains(.filename) ? item.filename : nil
                    var newParent: String? = nil
                    var moveToRoot = false
                    if changedFields.contains(.parentItemIdentifier) {
                        if item.parentItemIdentifier == .rootContainer {
                            moveToRoot = true
                        } else {
                            newParent = item.parentItemIdentifier.rawValue
                        }
                    }
                    let updated = try await client.renameMove(
                        id: stored.id,
                        name: newName,
                        parentId: newParent,
                        moveToRoot: moveToRoot,
                        ifMatch: nil
                    )
                    if let storedUpdated = store.upsert(updated) { latest = storedUpdated }
                }
                progress.completedUnitCount = 100
                signalChanges()
                completionHandler(TernItem(stored: latest), [], false, nil)
            } catch {
                guard Self.isOffline(error) else {
                    completionHandler(nil, [], false, Self.providerError(error))
                    return
                }
                guard let stored = store.item(id: item.itemIdentifier.rawValue) else {
                    completionHandler(nil, [], false, Self.noSuchItem())
                    return
                }
                var local = stored
                local.pending = true
                local.updatedAt = ISO8601DateFormatter().string(from: Date())
                if changedFields.contains(.filename) { local.name = item.filename }
                if changedFields.contains(.parentItemIdentifier) {
                    local.parentId = item.parentItemIdentifier == .rootContainer ? nil : item.parentItemIdentifier.rawValue
                }
                if changedFields.contains(.contents), let newContents, let data = try? Data(contentsOf: newContents),
                   let contentFile = store.pending.writeContent(data) {
                    store.pending.add(PendingOperation(
                        id: UUID().uuidString,
                        kind: .modifyContent,
                        clientId: nil,
                        nodeId: stored.id,
                        parentId: nil,
                        name: nil,
                        moveToRoot: false,
                        contentFile: contentFile,
                        baseEtag: stored.etag,
                        createdAt: Date().timeIntervalSince1970
                    ))
                    local.size = Int64(data.count)
                }
                if changedFields.contains(.filename) || changedFields.contains(.parentItemIdentifier) {
                    let root = item.parentItemIdentifier == .rootContainer
                    store.pending.add(PendingOperation(
                        id: UUID().uuidString,
                        kind: .renameMove,
                        clientId: nil,
                        nodeId: stored.id,
                        parentId: root ? nil : item.parentItemIdentifier.rawValue,
                        name: changedFields.contains(.filename) ? item.filename : nil,
                        moveToRoot: root && changedFields.contains(.parentItemIdentifier),
                        contentFile: nil,
                        baseEtag: nil,
                        createdAt: Date().timeIntervalSince1970
                    ))
                }
                store.upsertLocal(local)
                completionHandler(TernItem(stored: local), [], false, nil)
            }
        }
        return progress
    }

    func deleteItem(identifier: NSFileProviderItemIdentifier,
                    baseVersion version: NSFileProviderItemVersion,
                    options: NSFileProviderDeleteItemOptions = [],
                    request: NSFileProviderRequest,
                    completionHandler: @escaping (Error?) -> Void) -> Progress {
        let progress = Progress.discreteProgress(totalUnitCount: 100)
        Task {
            do {
                let client = try store.makeClient()
                try await client.delete(id: identifier.rawValue)
                store.remove(id: identifier.rawValue)
                progress.completedUnitCount = 100
                signalChanges()
                completionHandler(nil)
            } catch {
                guard Self.isOffline(error) else {
                    completionHandler(Self.providerError(error))
                    return
                }
                store.remove(id: identifier.rawValue)
                store.pending.add(PendingOperation(
                    id: UUID().uuidString,
                    kind: .delete,
                    clientId: nil,
                    nodeId: identifier.rawValue,
                    parentId: nil,
                    name: nil,
                    moveToRoot: false,
                    contentFile: nil,
                    baseEtag: nil,
                    createdAt: Date().timeIntervalSince1970
                ))
                completionHandler(nil)
            }
        }
        return progress
    }

    private func change(from stored: StoredItem) -> StoredItem { stored }

    private static func isOffline(_ error: Error) -> Bool {
        guard let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost,
             .cannotFindHost, .timedOut, .dnsLookupFailed:
            return true
        default:
            return false
        }
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

    private func signalChanges() {
        let manager = NSFileProviderManager(for: domain)
        manager?.signalEnumerator(for: .workingSet) { _ in }
        manager?.signalEnumerator(for: .rootContainer) { _ in }
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
