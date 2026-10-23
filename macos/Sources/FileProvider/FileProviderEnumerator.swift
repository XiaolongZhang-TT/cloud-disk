//
//  FileProviderEnumerator.swift
//  Read-only enumerator backed by the cached sync snapshot.
//

import Foundation
import FileProvider

final class TernEnumerator: NSObject, NSFileProviderEnumerator {

    private let container: NSFileProviderItemIdentifier
    private let store: FileProviderStore
    private var invalidated = false

    init(container: NSFileProviderItemIdentifier, store: FileProviderStore) {
        self.container = container
        self.store = store
        super.init()
    }

    func invalidate() {
        invalidated = true
    }

    func enumerateItems(for observer: NSFileProviderEnumerationObserver,
                        startingAt page: NSFileProviderPage) {
        Task {
            if invalidated { return }
            do {
                if store.cursor == 0 {
                    _ = try await store.sync(forceBootstrap: true)
                }
                let items = self.itemsForContainer().map { TernItem(stored: $0) }
                observer.didEnumerate(items)
                observer.finishEnumerating(upTo: nil)
            } catch {
                observer.finishEnumeratingWithError(Self.nsError(error))
            }
        }
    }

    func enumerateChanges(for observer: NSFileProviderChangeObserver,
                          from anchor: NSFileProviderSyncAnchor) {
        Task {
            if invalidated { return }
            let start = Int(String(data: anchor.rawValue, encoding: .utf8) ?? "") ?? 0
            do {
                // If the system is at a valid older anchor, replay only what is
                // newer. A zero anchor triggers the server snapshot.
                let deleted = try await store.sync(forceBootstrap: start == 0)
                let updates = self.itemsForContainer().map { TernItem(stored: $0) }
                if !updates.isEmpty { observer.didUpdate(updates) }
                if !deleted.isEmpty { observer.didDeleteItems(withIdentifiers: deleted.map { NSFileProviderItemIdentifier(rawValue: $0) }) }
                observer.finishEnumeratingChanges(upTo: Self.anchor(store.cursor), moreComing: false)
            } catch {
                observer.finishEnumeratingWithError(Self.nsError(error))
            }
        }
    }

    func currentSyncAnchor(completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void) {
        completionHandler(Self.anchor(store.cursor))
    }

    private func itemsForContainer() -> [StoredItem] {
        switch container {
        case .rootContainer:
            return store.children(parentId: nil)
        case .workingSet:
            return store.allItems.filter { !$0.isFolder }
        case .trashContainer:
            return []
        default:
            return store.children(parentId: container.rawValue)
        }
    }

    private static func anchor(_ cursor: Int) -> NSFileProviderSyncAnchor {
        NSFileProviderSyncAnchor(rawValue: Data(String(cursor).utf8))
    }

    private static func nsError(_ error: Error) -> NSError {
        let description = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        let code: Int
        switch error {
        case SyncClientError.notConfigured:
            code = -1000 // NSFileProviderErrorNotAuthenticated
        case SyncClientError.http(401, _):
            code = -1000
        case SyncClientError.invalidServerURL, SyncClientError.malformedResponse:
            code = -1004 // NSFileProviderErrorServerUnreachable
        default:
            code = -1004
        }
        return NSError(domain: NSFileProviderErrorDomain, code: code, userInfo: [
            NSLocalizedDescriptionKey: description,
            NSFilePathErrorKey: "",
        ])
    }
}
