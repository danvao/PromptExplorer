import AppKit
import Foundation
import Darwin

struct LauncherError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

final class Engine {
    let resources = Bundle.main.resourceURL!
    let home = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!.appendingPathComponent("PromptExplorer")
    let instance = UUID().uuidString
    var port = 0
    var server: Process?
    var log: FileHandle?
    var lockFD: Int32 = -1

    func url(_ endpoint: String = "") -> URL { URL(string: "http://127.0.0.1:\(port)\(endpoint)")! }

    func acquireLock() throws -> Bool {
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        lockFD = Darwin.open(home.appendingPathComponent("launcher.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard lockFD >= 0 else { throw LauncherError(message: "No se pudo abrir la carpeta de datos.") }
        return flock(lockFD, LOCK_EX | LOCK_NB) == 0
    }

    func openExisting() async throws {
        let data = try Data(contentsOf: home.appendingPathComponent("instance.json"))
        let item = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let value = item?["port"] as? Int, (4317...4346).contains(value), let nonce = item?["instance"] as? String else {
            throw LauncherError(message: "La app ya se está iniciando. Espera unos segundos.")
        }
        port = value
        guard try await health(expected: nonce) else { throw LauncherError(message: "La instancia anterior todavía se está iniciando.") }
        _ = await MainActor.run { NSWorkspace.shared.open(self.url()) }
    }

    func health(expected: String) async throws -> Bool {
        var request = URLRequest(url: url("/health")); request.timeoutInterval = 2
        let (data, _) = try await URLSession.shared.data(for: request)
        let value = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return value?["app"] as? String == "PromptExplorer" && value?["instance"] as? String == expected
    }

    func choosePort() throws -> Int {
        for candidate in 4317...4346 {
            let fd = socket(AF_INET, SOCK_STREAM, 0)
            guard fd >= 0 else { continue }
            var address = sockaddr_in(); address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            address.sin_family = sa_family_t(AF_INET); address.sin_port = UInt16(candidate).bigEndian
            address.sin_addr.s_addr = inet_addr("127.0.0.1")
            let result = withUnsafePointer(to: &address) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
            }
            Darwin.close(fd)
            if result == 0 { return candidate }
        }
        throw LauncherError(message: "No hay un puerto local disponible entre 4317 y 4346.")
    }

    func start(dataDirectory: URL? = nil, isolated: Bool = false) async throws {
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        let data = dataDirectory ?? home.appendingPathComponent("data")
        try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
        let node = resources.appendingPathComponent("node/bin/node")
        let git = resources.appendingPathComponent("git")
        for item in [node.path, git.appendingPathComponent("bin/git").path, resources.appendingPathComponent("app/server.mjs").path] {
            guard FileManager.default.fileExists(atPath: item) else { throw LauncherError(message: "Falta un componente de la app: \(item)") }
        }
        port = try choosePort()
        let logURL = home.appendingPathComponent("PromptExplorer.log")
        if let size = try? FileManager.default.attributesOfItem(atPath: logURL.path)[.size] as? NSNumber, size.intValue > 2_000_000 {
            try? FileManager.default.removeItem(at: logURL.appendingPathExtension("previous"))
            try FileManager.default.moveItem(at: logURL, to: logURL.appendingPathExtension("previous"))
        }
        if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
        log = try FileHandle(forWritingTo: logURL); try log?.seekToEnd()
        let process = Process(); process.executableURL = node
        process.arguments = [resources.appendingPathComponent("app/server.mjs").path]
        process.currentDirectoryURL = resources.appendingPathComponent("app")
        var environment = ProcessInfo.processInfo.environment
        environment["PORT"] = String(port); environment["PE_DATA_DIR"] = data.path; environment["PE_INSTANCE_ID"] = instance
        environment["PATH"] = git.appendingPathComponent("bin").path + ":" + resources.appendingPathComponent("node/bin").path + ":" + (isolated ? "/usr/bin:/bin:/usr/sbin:/sbin" : environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin")
        environment["GIT_EXEC_PATH"] = git.appendingPathComponent("libexec/git-core").path
        environment["GIT_TEMPLATE_DIR"] = git.appendingPathComponent("share/git-core/templates").path
        if environment["GIT_CONFIG_SYSTEM"] == nil { environment["GIT_CONFIG_SYSTEM"] = git.appendingPathComponent("etc/gitconfig").path }
        process.environment = environment; process.standardOutput = log; process.standardError = log
        try process.run(); server = process
        for _ in 0..<100 {
            guard process.isRunning else { throw LauncherError(message: "El servidor se detuvo. Revisa \(logURL.path)") }
            if (try? await health(expected: instance)) == true { return }
            try await Task.sleep(nanoseconds: 150_000_000)
        }
        throw LauncherError(message: "El servidor local no respondió a tiempo.")
    }

    func saveInstance() throws {
        let data = try JSONSerialization.data(withJSONObject: ["port": port, "instance": instance])
        try data.write(to: home.appendingPathComponent("instance.json"), options: .atomic)
    }

    func stop() async {
        if let process = server, process.isRunning {
            var request = URLRequest(url: url("/quit")); request.httpMethod = "POST"; request.timeoutInterval = 10
            request.setValue("1", forHTTPHeaderField: "X-PromptExplorer")
            request.setValue(instance, forHTTPHeaderField: "X-PE-Instance")
            _ = try? await URLSession.shared.data(for: request)
            for _ in 0..<100 {
                if !process.isRunning { break }
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
            if process.isRunning { process.terminate() }
        }
        try? log?.close()
    }

    func smoke(output: URL) async -> Int32 {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("PromptExplorer-smoke-\(UUID().uuidString)")
        var result: [String: Any]
        var status: Int32 = 0
        do {
            try await start(dataDirectory: temporary, isolated: true)
            let configuration = URLSessionConfiguration.ephemeral
            let session = URLSession(configuration: configuration)
            func api(_ endpoint: String, body: [String: Any]? = nil) async throws -> Data {
                var request = URLRequest(url: url("/api/" + endpoint)); request.timeoutInterval = 45
                request.setValue("1", forHTTPHeaderField: "X-PromptExplorer")
                if let body = body {
                    request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.httpBody = try JSONSerialization.data(withJSONObject: body)
                }
                let (data, response) = try await session.data(for: request)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw LauncherError(message: "\(endpoint): \(String(decoding: data, as: UTF8.self))") }
                return data
            }
            _ = try await api("state?profile=0")
            _ = try await api("new", body: ["profile": 0, "path": "PruebaMac.md", "content": "# Mac portable\n"])
            _ = try await api("commit", body: ["profile": 0, "message": "Prueba de la app macOS"])
            for endpoint in ["/", "/app.js", "/vendor/marked.js", "/vendor/purify.js"] {
                let (_, response) = try await session.data(from: url(endpoint))
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw LauncherError(message: "No se pudo cargar \(endpoint)") }
            }
            result = ["ok": true, "bundledNode": true, "bundledGit": true, "commitCreated": true, "version": "0.4.1", "architecture": ProcessInfo.processInfo.environment["PE_BUILD_ARCH"] ?? "native"]
        } catch { status = 1; result = ["ok": false, "error": error.localizedDescription] }
        await stop(); try? FileManager.default.removeItem(at: temporary)
        do { try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(to: output) }
        catch { return 1 }
        return status
    }
}

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    let engine = Engine()
    var item: NSStatusItem?
    var closing = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item?.button?.image = NSImage(systemSymbolName: "doc.text.magnifyingglass", accessibilityDescription: "PromptExplorer")
        let menu = NSMenu()
        for (title, action) in [("Abrir PromptExplorer", #selector(openBrowser)), ("Carpeta de datos", #selector(openData)), ("Salir", #selector(quit))] {
            let entry = NSMenuItem(title: title, action: action, keyEquivalent: ""); entry.target = self; menu.addItem(entry)
        }
        item?.menu = menu
        Task {
            do {
                if try engine.acquireLock() { try await engine.start(); try engine.saveInstance(); openBrowser() }
                else { try await engine.openExisting(); NSApp.terminate(nil) }
            } catch {
                let alert = NSAlert(); alert.messageText = "No se pudo abrir PromptExplorer"; alert.informativeText = error.localizedDescription
                alert.runModal(); await engine.stop(); NSApp.terminate(nil)
            }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { openBrowser(); return true }
    @objc func openBrowser() { if engine.server?.isRunning == true { NSWorkspace.shared.open(engine.url()) } }
    @objc func openData() { NSWorkspace.shared.open(engine.home) }
    @objc func quit() {
        if closing { return }; closing = true
        Task { await engine.stop(); try? FileManager.default.removeItem(at: engine.home.appendingPathComponent("instance.json")); NSApp.terminate(nil) }
    }
}

if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--smoke-test" {
    Task.detached {
        let result = await Engine().smoke(output: URL(fileURLWithPath: CommandLine.arguments[2]))
        exit(result)
    }
    dispatchMain()
} else {
    MainActor.assumeIsolated {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate; app.setActivationPolicy(.accessory); app.run()
    }
}
