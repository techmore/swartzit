import Cocoa
import Foundation

struct Health: Decodable {
    let version: String?
    let status: String?
    let api: String
    let web: String
    let database: String
    let caddy: String
    let worker: String
    let `public`: String
    let network: Network?
    let uptime: Uptime?
    let pulse: Pulse?
}
struct Pulse: Decodable {
    let status: String?
    let url: String?
    let latency_ms: Int?
    let http_status: Int?
    let age_seconds: Int?
    let checked_at: String?
}
struct Uptime: Decodable {
    let status: String?
    let started_at: String?
    let seconds: Int?
    let duration: String?
}
struct Network: Decodable {
    let mode: String?
    let label: String?
    let web_interface: String?
    let web_bind_ip: String?
    let web_url: String?
    let api_interface: String?
    let api_bind_ip: String?
}
struct BindingOption: Decodable {
    let id: String
    let label: String
    let `interface`: String
    let ip: String
    let kind: String
}
struct ActivityWindow: Decodable { let label: String; let users: Int; let posts: Int; let comments: Int }
struct ActivityFeatures: Decodable { let orchard_enabled: Bool? }
struct Activity: Decodable { let windows: [ActivityWindow]; let features: ActivityFeatures? }

final class StatusApp: NSObject, NSApplicationDelegate {
    private var item: NSStatusItem!
    private var menu: NSMenu!
    private var summaryItem: NSMenuItem!
    private var activitySeparator: NSMenuItem!
    private var activityRows: [NSMenuItem] = []
    private var orchardItems: [NSMenuItem] = []
    private var checkNowItem: NSMenuItem!
    private var versionItem: NSMenuItem!
    private var networkItem: NSMenuItem!
    private var uptimeItem: NSMenuItem!
    private var pulseItem: NSMenuItem!
    private var bindingRootItem: NSMenuItem!
    private var bindingMenu: NSMenu!
    private var bindingRows: [NSMenuItem] = []
    private var bindingInProgress = false
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
        summaryItem = menuItem("Swartzit  ·  Checking…", nil)
        summaryItem.isEnabled = false
        summaryItem.image = loadMenuIcon()
        menu.addItem(summaryItem)
        versionItem = menuItem("Release  ·  Checking…", nil, icon: "info.circle")
        versionItem.isEnabled = false
        menu.addItem(versionItem)
        networkItem = menuItem("Network  ·  Checking…", nil, icon: "network")
        networkItem.isEnabled = false
        menu.addItem(networkItem)
        uptimeItem = menuItem("Uptime  ·  Checking…", nil, icon: "clock")
        uptimeItem.isEnabled = false
        menu.addItem(uptimeItem)
        pulseItem = menuItem("Pulse  ·  Checking…", nil, icon: "dot.radiowaves.left.and.right")
        pulseItem.isEnabled = false
        menu.addItem(pulseItem)
        bindingRootItem = menuItem("Bind interface", nil, icon: "arrow.triangle.2.circlepath")
        bindingRootItem.toolTip = "Restart Swartzit and refresh Caddy for an available macOS interface. The API remains loopback-only by default."
        bindingMenu = NSMenu()
        bindingRootItem.submenu = bindingMenu
        let checkingBindings = menuItem("Checking available interfaces…", nil, icon: "ellipsis.circle")
        checkingBindings.isEnabled = false
        bindingMenu.addItem(checkingBindings)
        menu.addItem(bindingRootItem)
        let activityHeader = menuItem("Recent activity", nil, icon: "chart.bar.fill")
        activityHeader.isEnabled = false
        menu.addItem(activityHeader)
        activitySeparator = .separator()
        menu.addItem(activitySeparator)
        renderActivity(nil)
        menu.addItem(.separator())
        add("Open Swartzit", #selector(openSwartzit), icon: "arrow.up.forward.app")
        checkNowItem = add("Refresh status", #selector(checkNow), icon: "arrow.clockwise")
        add("Start service", #selector(startSwartzit), icon: "play.fill")
        add("Stop service", #selector(stopSwartzit), icon: "stop.fill")
        menu.addItem(.separator())
        add("Quit", #selector(quit), icon: "power")
        setOrchardEnabled(true)
        item.menu = menu
        checkNow()
        timer = Timer.scheduledTimer(timeInterval: 30, target: self, selector: #selector(checkNow), userInfo: nil, repeats: true)
    }

    @discardableResult
    private func add(_ title: String, _ action: Selector, icon: String? = nil) -> NSMenuItem {
        let entry = menuItem(title, action, icon: icon)
        menu.addItem(entry)
        return entry
    }

    private func menuItem(_ title: String, _ action: Selector?, icon: String? = nil) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
        if action != nil {
            entry.target = self
        }
        if let icon {
            entry.image = symbol(icon)
        }
        return entry
    }

    private func symbol(_ name: String) -> NSImage? {
        guard let image = NSImage(systemSymbolName: name, accessibilityDescription: nil) else {
            return nil
        }
        image.isTemplate = true
        image.size = NSSize(width: 14, height: 14)
        return image
    }

    private func loadMenuIcon() -> NSImage? {
        guard let icon = loadIcon() else { return nil }
        icon.size = NSSize(width: 16, height: 16)
        icon.isTemplate = false
        return icon
    }

    private func setOrchardEnabled(_ enabled: Bool) {
        if enabled {
            guard orchardItems.isEmpty else { return }
            let entries = [
                menuItem("Open Orchard", #selector(openOrchard), icon: "square.grid.2x2"),
                menuItem("Install Orchard with Homebrew…", #selector(installOrchard), icon: "arrow.down.circle")
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
            let bindings = self.fetchBindings()
            DispatchQueue.main.async {
                let localUp = health?.status == "up" || (health?.api == "ready" && health?.web == "ready" && health?.database == "ready")
                let publicDown = health?.public == "down"
                let pulseDown = health?.pulse?.status == "down"
                if self.item.button?.image == nil {
                    self.item.button?.title = localUp ? "● Swartzit" : "○ Swartzit"
                }
                self.summaryItem.title = health == nil
                    ? "Swartzit  ·  Unavailable"
                    : (localUp
                        ? (publicDown ? "Swartzit  ·  Up · Public down" : (pulseDown ? "Swartzit  ·  Up · Pulse down" : "Swartzit  ·  Up"))
                        : "Swartzit  ·  Down")
                self.summaryItem.image = self.symbol(health == nil
                    ? "questionmark.circle.fill"
                    : (localUp && !publicDown && !pulseDown ? "checkmark.circle.fill" : (localUp ? "exclamationmark.triangle.fill" : "xmark.circle.fill")))
                self.summaryItem.toolTip = self.summary(health)
                self.item.button?.toolTip = self.summary(health)
                self.item.button?.setAccessibilityLabel(localUp ? "Swartzit up" : "Swartzit down")
                self.versionItem.title = "Release  ·  \(health?.version ?? "unknown")"
                self.networkItem.title = self.networkTitle(health?.network)
                self.uptimeItem.title = self.uptimeTitle(health?.uptime)
                self.pulseItem.title = self.pulseTitle(health?.pulse, publicStatus: health?.public)
                if let webURL = health?.network?.web_url, !webURL.isEmpty {
                    self.currentOpenURL = webURL
                }
                self.renderBindings(bindings, current: health?.network)
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

    private func fetchBindings() -> [BindingOption] {
        let result = run(["interfaces", "--json"])
        guard result.code == 0, let data = result.data else { return [] }
        return (try? JSONDecoder().decode([BindingOption].self, from: data)) ?? []
    }

    private func renderBindings(_ options: [BindingOption], current network: Network?) {
        for row in bindingRows {
            bindingMenu.removeItem(row)
        }
        bindingRows.removeAll(keepingCapacity: true)
        bindingMenu.removeAllItems()

        let currentMode = network?.mode
        let currentInterface = network?.web_interface
        bindingRootItem.title = "Bind interface  ·  \(currentInterface ?? "unknown")"

        guard !options.isEmpty else {
            let unavailable = menuItem("No active IPv4 interfaces found", nil, icon: "exclamationmark.triangle")
            unavailable.isEnabled = false
            bindingMenu.addItem(unavailable)
            return
        }

        let note = menuItem("Current  ·  \(currentInterface ?? "unknown")", nil, icon: "checkmark.circle")
        note.isEnabled = false
        bindingMenu.addItem(note)
        bindingMenu.addItem(.separator())
        for option in options {
            let row = menuItem("\(option.label)  ·  \(option.interface)  ·  \(option.ip)", #selector(selectBinding(_:)), icon: bindingIcon(for: option))
            row.representedObject = option.id
            row.toolTip = "Restart Swartzit with the web server bound to \(option.interface) (\(option.ip))."
            if option.id == currentMode || (currentMode == "interface" && option.interface == currentInterface) {
                row.state = .on
            }
            bindingMenu.addItem(row)
            bindingRows.append(row)
        }
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
                return "\(label)  ·  \(window.users) users  ·  \(window.posts) posts  ·  \(window.comments) comments"
            }
        } else {
            titles = ["Activity unavailable"]
        }

        let separatorIndex = menu.index(of: activitySeparator)
        guard separatorIndex != NSNotFound else {
            return
        }
        for (offset, title) in titles.enumerated() {
            let row = menuItem(title, nil, icon: "chart.bar.fill")
            row.isEnabled = false
            menu.insertItem(row, at: separatorIndex + offset)
            activityRows.append(row)
        }
    }

    private func summary(_ health: Health?) -> String {
        guard let health else { return "Could not read Swartzit status." }
        let state = health.status ?? (health.api == "ready" && health.web == "ready" && health.database == "ready" ? "up" : "down")
        let pulse = health.pulse?.status ?? "unknown"
        let uptime = health.uptime?.duration ?? "unknown"
        return "\(state.uppercased()) · \(networkTitle(health.network)) · Uptime \(uptime) · API \(health.api) · Web \(health.web) · DB \(health.database) · Uptime pulse \(pulse)"
    }

    private func networkTitle(_ network: Network?) -> String {
        guard let network else { return "Network  ·  unknown" }
        let label = network.label ?? network.mode ?? "unknown"
        let web = [network.web_interface, network.web_bind_ip]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        let api = [network.api_interface, network.api_bind_ip]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        var value = "Network  ·  \(label)"
        if !web.isEmpty { value += "  ·  Web \(web)" }
        if !api.isEmpty { value += "  ·  API \(api)" }
        return value
    }

    private func uptimeTitle(_ uptime: Uptime?) -> String {
        guard let uptime else { return "Uptime  ·  unknown" }
        let state = (uptime.status ?? "unknown").uppercased()
        let duration = uptime.duration ?? "unknown"
        guard let started = uptime.started_at, !started.isEmpty else {
            return "Uptime  ·  \(state)  ·  \(duration)"
        }
        return "Uptime  ·  \(state)  ·  \(duration)  ·  since \(shortTime(started))"
    }

    private func pulseTitle(_ pulse: Pulse?, publicStatus: String?) -> String {
        let state = (pulse?.status ?? (publicStatus == "down" ? "down" : "unknown")).uppercased()
        var value = "Pulse  ·  \(state)"
        if let latency = pulse?.latency_ms { value += "  ·  \(latency) ms" }
        if let age = pulse?.age_seconds { value += "  ·  checked \(age)s ago" }
        return value
    }

    private func bindingIcon(for option: BindingOption) -> String {
        switch option.kind.lowercased() {
        case "wifi": return "wifi"
        case "wireguard": return "lock.shield"
        case "vpn": return "network"
        case "loopback": return "arrow.triangle.2.circlepath"
        default: return "cable.connector"
        }
    }

    private func shortTime(_ value: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: value) else { return value }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        formatter.timeZone = .current
        return formatter.string(from: date)
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
                self.summaryItem.title = result.code == 0 ? "Swartzit  ·  Orchard installed" : "Swartzit  ·  Orchard install failed"
                self.summaryItem.image = self.symbol(result.code == 0 ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                self.checkNow()
            }
        }
    }
    @objc private func selectBinding(_ sender: NSMenuItem) {
        guard !bindingInProgress, let binding = sender.representedObject as? String else { return }
        bindingInProgress = true
        bindingRootItem.isEnabled = false
        for row in bindingRows { row.isEnabled = false }
        summaryItem.title = "Swartzit  ·  Rebinding web + Caddy…"
        summaryItem.image = symbol("arrow.clockwise.circle.fill")
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let result = self.run(["restart", binding])
            DispatchQueue.main.async {
                self.bindingInProgress = false
                self.bindingRootItem.isEnabled = true
                if result.code != 0 {
                    let alert = NSAlert()
                    alert.messageText = "Could not bind Swartzit and refresh Caddy for \(binding)."
                    alert.informativeText = String(data: result.data ?? Data(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "The restart command failed."
                    alert.alertStyle = .warning
                    alert.addButton(withTitle: "OK")
                    alert.runModal()
                }
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
