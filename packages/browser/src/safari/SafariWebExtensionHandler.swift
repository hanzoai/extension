//
//  SafariWebExtensionHandler.swift
//  Shared (Extension)
//
//  Relays the extension to zapd, which is the same fabric Chrome and Firefox
//  join. They reach it by spawning `zapd` over stdio as a native messaging
//  host; Safari cannot spawn a binary, so it carries the last hop itself and
//  writes to the router's socket directly.
//
//  The message is the router envelope the shared transport already sends —
//  { t, flags, from, to, payload } with a base64 payload — so the browser side
//  is byte-identical across all three engines and only the hop changes.
//

import SafariServices
import Foundation
import os.log

/// One connection to the router, kept open across messages.
///
/// A native port is a channel, not a request: the router pushes ROUTE commands
/// on it long after the extension last spoke, and a socket opened per message
/// would miss every one of them.
final class ZapSocket {
    static let shared = ZapSocket()

    private let path = NSHomeDirectory() + "/.zap/run/zapd.sock"
    private var fd: Int32 = -1
    private let lock = NSLock()

    /// Connect if we are not already. Returns false when the router is absent —
    /// which is a normal state (zapd not running), not an error to throw at the
    /// browser.
    @discardableResult
    private func connect() -> Bool {
        if fd >= 0 { return true }
        let s = socket(AF_UNIX, SOCK_STREAM, 0)
        if s < 0 { return false }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        // sun_path is a fixed C array; a path that does not fit is not a path
        // this socket can name, and truncating it would name a different one.
        guard bytes.count < MemoryLayout.size(ofValue: addr.sun_path) else { close(s); return false }
        withUnsafeMutablePointer(to: &addr.sun_path) { p in
            p.withMemoryRebound(to: CChar.self, capacity: bytes.count + 1) { dst in
                for (i, b) in bytes.enumerated() { dst[i] = CChar(bitPattern: b) }
                dst[bytes.count] = 0
            }
        }
        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        let ok = withUnsafePointer(to: &addr) { p in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                Darwin.connect(s, sa, size) == 0
            }
        }
        if !ok { close(s); return false }
        fd = s
        return true
    }

    private func drop() {
        if fd >= 0 { close(fd) }
        fd = -1
    }

    /// Send one envelope and read one back.
    ///
    /// Length-prefixed both ways, matching the native messaging framing the
    /// other two engines get from the host: u32 little-endian, then the JSON.
    func exchange(_ message: Any) -> Any? {
        lock.lock()
        defer { lock.unlock() }
        guard connect() else { return nil }
        guard let body = try? JSONSerialization.data(withJSONObject: message) else { return nil }

        var length = UInt32(body.count).littleEndian
        var frame = Data(bytes: &length, count: 4)
        frame.append(body)

        guard write(frame) else { drop(); return nil }
        guard let header = read(exactly: 4) else { drop(); return nil }
        let expected = header.withUnsafeBytes { $0.load(as: UInt32.self).littleEndian }
        // A reply that claims more than the router will ever send is a desynced
        // stream, not a big message. Start over rather than block on it.
        guard expected > 0, expected <= 16 * 1024 * 1024, let payload = read(exactly: Int(expected)) else {
            drop(); return nil
        }
        return try? JSONSerialization.jsonObject(with: payload)
    }

    private func write(_ data: Data) -> Bool {
        var sent = 0
        return data.withUnsafeBytes { raw -> Bool in
            guard let base = raw.baseAddress else { return false }
            while sent < data.count {
                let n = Darwin.write(fd, base.advanced(by: sent), data.count - sent)
                if n <= 0 { return false }
                sent += n
            }
            return true
        }
    }

    private func read(exactly count: Int) -> Data? {
        var out = Data()
        var buf = [UInt8](repeating: 0, count: count)
        while out.count < count {
            let n = buf.withUnsafeMutableBytes { p -> Int in
                guard let base = p.baseAddress else { return -1 }
                return Darwin.read(fd, base, count - out.count)
            }
            if n <= 0 { return nil }
            out.append(contentsOf: buf[0..<n])
        }
        return out
    }
}

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        // iOS has no router to reach: zapd is a desktop daemon and an iOS app
        // has no filesystem path to another process's socket. The extension
        // treats a null reply as "not connected", which is what this is.
        var reply: Any? = nil
        #if os(macOS)
        if let message { reply = ZapSocket.shared.exchange(message) }
        #endif

        if reply == nil {
            os_log(.default, "zapd unreachable at ~/.zap/run/zapd.sock")
        }

        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [SFExtensionMessageKey: reply ?? [:]]
        } else {
            response.userInfo = ["message": reply ?? [:]]
        }
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
