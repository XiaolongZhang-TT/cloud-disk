//
//  PendingStore.swift
//  Durable queue for writes made while the server is unreachable.
//

import Foundation

public enum PendingKind: String, Codable, Sendable {
    case createFolder
    case createFile
    case modifyContent
    case renameMove
    case delete
}

public struct PendingOperation: Codable, Sendable {
    public var id: String
    public var kind: PendingKind
    public var clientId: String?
    public var nodeId: String?
    public var parentId: String?
    public var name: String?
    public var moveToRoot: Bool
    public var contentFile: String?
    public var baseEtag: String?
    public var createdAt: Double
}

public final class PendingStore: @unchecked Sendable {

    private let lock = NSLock()
    private let directory: URL?
    private let manifestURL: URL?

    public init() {
        let container = FileProviderStore.supportDirectory
        directory = container.appendingPathComponent("pending", isDirectory: true)
        manifestURL = directory?.appendingPathComponent("pending.json")
        if let directory {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
    }

    public func list() -> [PendingOperation] {
        lock.lock()
        defer { lock.unlock() }
        return loadLocked()
    }

    public func add(_ operation: PendingOperation) {
        lock.lock()
        defer { lock.unlock() }
        var items = loadLocked()
        items.append(operation)
        saveLocked(items)
    }

    public func remove(id: String) {
        lock.lock()
        defer { lock.unlock() }
        var items = loadLocked()
        if let index = items.firstIndex(where: { $0.id == id }) {
            let operation = items.remove(at: index)
            if let file = operation.contentFile, let directory {
                try? FileManager.default.removeItem(at: directory.appendingPathComponent(file))
            }
            saveLocked(items)
        }
    }

    public func writeContent(_ data: Data) -> String? {
        guard let directory else { return nil }
        let name = "\(UUID().uuidString).bin"
        do {
            try data.write(to: directory.appendingPathComponent(name), options: .atomic)
            return name
        } catch {
            return nil
        }
    }

    public func contentURL(for operation: PendingOperation) -> URL? {
        guard let file = operation.contentFile, let directory else { return nil }
        return directory.appendingPathComponent(file)
    }

    public func contentURL(nodeId: String) -> URL? {
        for operation in list() where operation.nodeId == nodeId || operation.clientId == nodeId {
            if let url = contentURL(for: operation) { return url }
        }
        return nil
    }

    private func loadLocked() -> [PendingOperation] {
        guard let manifestURL, let data = try? Data(contentsOf: manifestURL) else { return [] }
        return (try? JSONDecoder().decode([PendingOperation].self, from: data)) ?? []
    }

    private func saveLocked(_ items: [PendingOperation]) {
        guard let manifestURL else { return }
        guard let data = try? JSONEncoder().encode(items) else { return }
        try? data.write(to: manifestURL, options: .atomic)
    }
}
