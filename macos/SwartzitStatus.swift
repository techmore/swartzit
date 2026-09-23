import Cocoa
import Foundation

struct Health: Decodable {
    let api: String
    let web: String
    let database: String
    let caddy: String
    let worker: String
    let `public`: String
    let network: Network?
    let pulse: Pulse?
}
struct Pulse: Decodable { let status: String?; let url: String?; let latency_ms: Int?; let checked_at: String? }
struct Network: Decodable {
    let mode: String?
    let label: String?
    let web_interface: String?
    let web_bind_ip: String?
    let web_url: String?
    let api_interface: String?
    let api_bind_ip: String?
}
struct ActivityWindow: Decodable { let label: String; let users: Int; let posts: Int; let comments: Int }
struct ActivityFeatures: Decodable { let orchard_enabled: Bool? }
struct Activity: Decodable { let windows: [ActivityWindow]; let features: ActivityFeatures? }

final class StatusApp: NSObject, NSApplicationDelegate {
    private var item: NSStatusItem!
    private var menu: NSMenu!
    private var activitySeparator: NSMenuItem!
    private var activityRows: [NSMenuItem] = []
    private var orchardItems: [NSMenuItem] = []
    private var checkNowItem: NSMenuItem!
    private var networkItem: NSMenuItem!
    private var currentOpenURL: String?
    private var timer: Timer?
    private var command: String { ProcessInfo.processInfo.environment["SWARTZIT_COMMAND"] ?? "swartzit" }
    private var openURL: String { ProcessInfo.processInfo.environment["SWARTZIT_OPEN_URL"] ?? "http://127.0.0.1:4173" }

    func applicationDidFinishLaunching(_ notification: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let icon = loadIcon() {
            icon.size = NSSize(width: 18, height: 18)
            icon.isTemplate = false
            item.button?.image = icon
            item.button?.imagePosition = .imageOnly
        } else {
            item.button?.title = "● Swartzit"
        }
        item.button?.setAccessibilityLabel("Swartzit")
        menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Swartzit: Checking…", action: nil, keyEquivalent: ""))
        networkItem = NSMenuItem(title: "Network: Checking…", action: nil, keyEquivalent: "")
        networkItem.isEnabled = false
        menu.addItem(networkItem)
        let activityHeader = NSMenuItem(title: "Activity", action: nil, keyEquivalent: "")
        activityHeader.isEnabled = false
        menu.addItem(activityHeader)
        activitySeparator = .separator()
        menu.addItem(activitySeparator)
        renderActivity(nil)
        menu.addItem(.separator())
        add("Open Swartzit", #selector(openSwartzit))
        checkNowItem = add("Check Now", #selector(checkNow))
        add("Start Swartzit", #selector(startSwartzit))
        add("Stop Swartzit", #selector(stopSwartzit))
        menu.addItem(.separator())
        add("Quit", #selector(quit))
        setOrchardEnabled(true)
        item.menu = menu
        checkNow()
        timer = Timer.scheduledTimer(timeInterval: 30, target: self, selector: #selector(checkNow), userInfo: nil, repeats: true)
    }

    @discardableResult
    private func add(_ title: String, _ action: Selector) -> NSMenuItem {
        let entry = menuItem(title, action)
        menu.addItem(entry)
        return entry
    }

    private func menuItem(_ title: String, _ action: Selector) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
        entry.target = self
        return entry
    }

    private func setOrchardEnabled(_ enabled: Bool) {
        if enabled {
            guard orchardItems.isEmpty else { return }
            let entries = [
                menuItem("Open Orchard", #selector(openOrchard)),
                menuItem("Install Orchard with Homebrew…", #selector(installOrchard))
            ]
            let checkNowIndex = menu.index(of: checkNowItem)
            guard checkNowIndex != NSNotFound else { return }
            for (offset, entry) in entries.enumerated() {
                menu.insertItem(entry, at: checkNowIndex + offset)
            }
            orchardItems = entries
        } else {
            for entry in orchardItems {
                menu.removeItem(entry)
            }
            orchardItems.removeAll(keepingCapacity: true)
        }
    }

    @objc private func checkNow() {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            let result = self.run(["status", "--json"])
            let health = result.data.flatMap { try? JSONDecoder().decode(Health.self, from: $0) }
            DispatchQueue.main.async {
                let ready = health?.api == "ready" && health?.web == "ready" && health?.database == "ready" && health?.public != "down" && health?.pulse?.status != "down"
                if self.item.button?.image == nil {
                    self.item.button?.title = ready ? "● Swartzit" : "○ Swartzit"
                }
                let summary = self.menu.items[0]
                summary.title = ready ? "Swartzit: Running" : (health == nil ? "Swartzit: Unavailable" : "Swartzit: Needs attention")
                summary.toolTip = self.summary(health)
                self.networkItem.title = self.networkTitle(health?.network)
                if let webURL = health?.network?.web_url, !webURL.isEmpty {
                    self.currentOpenURL = webURL
                }
            }
            let activity = self.fetchActivity()
            DispatchQueue.main.async {
                self.setOrchardEnabled(activity?.features?.orchard_enabled ?? true)
                self.renderActivity(activity)
            }
        }
    }

    private func loadIcon() -> NSImage? {
        var candidates: [URL] = []
        if let configured = ProcessInfo.processInfo.environment["SWARTZIT_ICON_PATH"], !configured.isEmpty {
            candidates.append(URL(fileURLWithPath: configured))
        }
        let executable = URL(fileURLWithPath: CommandLine.arguments[0])
        let executableDirectory = executable.deletingLastPathComponent()
        candidates.append(executableDirectory.appendingPathComponent("../libexec/swartzit-icon.png").standardizedFileURL)
        candidates.append(executableDirectory.appendingPathComponent("swartzit-icon.png"))
        candidates.append(URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("apps/web/static/swartzit-icon.png"))
        for candidate in candidates {
            if let image = NSImage(contentsOf: candidate) { return image }
        }
        return nil
    }

    private func fetchActivity() -> Activity? {
        let api = ProcessInfo.processInfo.environment["SWARTZIT_API_URL"] ?? "http://127.0.0.1:18080"
        guard let url = URL(string: "\(api)/api/activity"), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Activity.self, from: data)
    }

    private func renderActivity(_ activity: Activity?) {
        for row in activityRows {
            menu.removeItem(row)
        }
        activityRows.removeAll(keepingCapacity: true)

        let titles: [String]
        if let activity, !activity.windows.isEmpty {
            titles = activity.windows.map { window in
                let label = window.label.isEmpty
                    ? "Activity"
                    : window.label.prefix(1).uppercased() + String(window.label.dropFirst())
                return "\(label) — \(window.users) users · \(window.posts) posts · \(window.comments) comments"
            }
        } else {
            titles = ["Activity unavailable"]
        }

        let separatorIndex = menu.index(of: activitySeparator)
        guard separatorIndex != NSNotFound else {
            return
        }
        for (offset, title) in titles.enumerated() {
            let row = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            row.isEnabled = false
            menu.insertItem(row, at: separatorIndex + offset)
            activityRows.append(row)
        }
    }

    private func summary(_ health: Health?) -> String {
        guard let health else { return "Could not read Swartzit status." }
        let pulse = health.pulse?.status ?? "unknown"
        return "\(networkTitle(health.network)) · API \(health.api) · Web \(health.web) · DB \(health.database) · Pulse \(pulse)"
    }

    private func networkTitle(_ network: Network?) -> String {
        guard let network else { return "Network: unknown" }
        let label = network.label ?? network.mode ?? "unknown"
        let web = [network.web_interface, network.web_bind_ip]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        let api = [network.api_interface, network.api_bind_ip]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        var value = "Network: \(label)"
        if !web.isEmpty { value += " · Web \(web)" }
        if !api.isEmpty { value += " · API \(api)" }
        return value
    }

    private func run(_ arguments: [String]) -> (data: Data?, code: Int32) {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [command] + arguments
        process.standardOutput = pipe
        process.standardError = pipe
        do { try process.run(); process.waitUntilExit(); return (pipe.fileHandleForReading.readDataToEndOfFile(), process.terminationStatus) }
        catch { return (nil, -1) }
    }

    @objc private func openSwartzit() { if let url = URL(string: currentOpenURL ?? openURL) { NSWorkspace.shared.open(url) } }
    @objc private func openOrchard() { if let url = URL(string: "orchard://dashboard") { NSWorkspace.shared.open(url) } }
    @objc private func installOrchard() {
        let alert = NSAlert()
        alert.messageText = "Install Orchard?"
        alert.informativeText = "This runs `brew install orchard` on this Mac. Homebrew may download and modify host software."
        alert.addButton(withTitle: "Install")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            let result = self.run(["orchard", "install", "--yes"])
            DispatchQueue.main.async {
                self.menu.items[0].title = result.code == 0 ? "Orchard: Installed" : "Orchard: Install failed"
                self.checkNow()
            }
        }
    }
    @objc private func startSwartzit() { _ = run(["start"]); checkNow() }
    @objc private func stopSwartzit() { _ = run(["stop"]); checkNow() }
    @objc private func quit() { NSApplication.shared.terminate(nil) }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = StatusApp()
app.delegate = delegate
app.run()
