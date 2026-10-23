//
//  FileProviderStore.swift
//  File Provider metadata cache.
//
//  Contents are materialized by the system; this store only keeps the item
//  tree, etags and the sync cursor so the extension can answer Finder quickly.
//

import Foundation

public struct StoredItem: Codable, Hashable, Sendable {
    public var id: String
    public var parentId: String?
    public var name: String
    public var type: String
    public var size: Int64
    public var mime: String?
    public var createdAt: String?
    public var updatedAt: String?
    public var etag: String?
    public var deleted: Bool

    public var isFolder: Bool { type == "folder" }
}

private struct CacheFile: Codable {
    var cursor: Int = 0
    var items: [String: StoredItem] = [:]
}

public final class FileProviderStore: @unchecked Sendable {

    private let queue = DispatchQueue(label: "com.tern.menubar.fileprovider.store")
    private var cache = CacheFile()
    private let cacheURL: URL?

    public init() {
        let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: FileProviderShared.appGroup)
        cacheURL = container?.appendingPathComponent("fileprovider-cache.json")
        load()
    }

    public var cursor: Int {
        queue.sync { cache.cursor }
    }

    public var allItems: [StoredItem] {
        queue.sync { Array(cache.items.values) }
    }

    public func item(id: String) -> StoredItem? {
        queue.sync { cache.items[id] }
    }

    public func children(parentId: String?) -> [StoredItem] {
        queue.sync {
            cache.items.values
                .filter { $0.parentId == parentId && !$0.deleted }
                .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        }
    }

    /// Returns the deleted identifiers from the last accepted sync page so the
    /// enumerator can forward them to File Provider.
    @discardableResult
    public func apply(_ page: TernSyncPage) -> [String] {
        queue.sync {
            if page.reset {
                cache.items.removeAll()
            }
            var deleted: [String] = []
            for change in page.changes {
                if change.deleted {
                    cache.items.removeValue(forKey: change.id)
                    deleted.append(change.id)
                    continue
                }
                guard let name = change.name, let type = change.type else { continue }
                cache.items[change.id] = StoredItem(
                    id: change.id,
                    parentId: change.parentId,
                    name: name,
                    type: type,
                    size: change.size ?? 0,
                    mime: change.mime,
                    createdAt: change.createdAt,
                    updatedAt: change.updatedAt,
                    etag: change.etag,
                    deleted: false
                )
            }
            cache.cursor = page.cursor
            saveLocked()
            return deleted
        }
    }

    // MARK: - Credentials / client

    public func makeClient() throws -> TernSyncClient {
        guard let configuration = FileProviderShared.loadConfiguration(),
              let password = FileProviderShared.loadPassword(serverURL: configuration.serverURL,
                                                             username: configuration.username),
              !password.isEmpty else {
            throw SyncClientError.notConfigured
        }
        return try TernSyncClient(serverURL: configuration.serverURL,
                                  username: configuration.username,
                                  password: password)
    }

    /// Fetch the next batch. Callers should serialize syncs; File Provider
    /// normally issues one enumeration at a time per container.
    public func sync(forceBootstrap: Bool = false) async throws -> [String] {
        let client = try makeClient()
        let start = forceBootstrap ? 0 : cursor
        let page = try await client.sync(cursor: start)
        return apply(page)
    }

    // MARK: - Persistence

    private func load() {
        guard let cacheURL else { return }
        guard let data = try? Data(contentsOf: cacheURL),
              let decoded = try? JSONDecoder().decode(CacheFile.self, from: data) else { return }
        cache = decoded
    }

    private func saveLocked() {
        guard let cacheURL else { return }
        do {
            let data = try JSONEncoder().encode(cache)
            try data.write(to: cacheURL, options: .atomic)
        } catch {
            // A failed cache write must not break Finder; the next sync retries.
        }
    }
}
