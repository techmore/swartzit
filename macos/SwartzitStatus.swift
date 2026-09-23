import Cocoa
import Darwin
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

final class SingleInstanceLock {
    private var descriptor: Int32 = -1

    init?() {
        let fileManager = FileManager.default
        let supportDirectory = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Swartzit", isDirectory: true)
        try? fileManager.createDirectory(at: supportDirectory, withIntermediateDirectories: true)

        let lockURL = supportDirectory.appendingPathComponent("SwartzitStatus.lock")
        descriptor = Darwin.open(lockURL.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        var lock = Darwin.flock()
        lock.l_type = Int16(F_WRLCK)
        lock.l_whence = Int16(SEEK_SET)
        lock.l_start = 0
        lock.l_len = 0
        guard descriptor >= 0, Darwin.fcntl(descriptor, F_SETLK, &lock) == 0 else {
            if descriptor >= 0 {
                Darwin.close(descriptor)
                descriptor = -1
            }
            return nil
        }
    }

    deinit {
        guard descriptor >= 0 else { return }
        Darwin.close(descriptor)
    }
}

final class StatusHeaderView: NSView {
    private let iconView = NSImageView()
    private let titleLabel = NSTextField(labelWithString: "Swartzit")
    private let statusLabel = NSTextField(labelWithString: "Checking…")
    private let detailLabel = NSTextField(labelWithString: "Checking local services")

    override init(frame frameRect: NSRect) {
        super.init(frame: NSRect(x: 0, y: 0, width: 320, height: 72))

        iconView.imageScaling = .scaleProportionallyUpOrDown
        iconView.contentTintColor = .controlAccentColor
        iconView.translatesAutoresizingMaskIntoConstraints = false
        iconView.widthAnchor.constraint(equalToConstant: 30).isActive = true
        iconView.heightAnchor.constraint(equalToConstant: 30).isActive = true

        titleLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        titleLabel.textColor = .labelColor
        statusLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        statusLabel.textColor = .secondaryLabelColor
        detailLabel.font = .systemFont(ofSize: 11)
        detailLabel.textColor = .secondaryLabelColor
        detailLabel.lineBreakMode = .byTruncatingTail
        detailLabel.maximumNumberOfLines = 1

        let titleRow = NSStackView(views: [titleLabel, statusLabel])
        titleRow.orientation = .horizontal
        titleRow.spacing = 7
        titleRow.alignment = .centerY

        let copy = NSStackView(views: [titleRow, detailLabel])
        copy.orientation = .vertical
        copy.spacing = 3
        copy.alignment = .leading
        copy.translatesAutoresizingMaskIntoConstraints = false

        let content = NSStackView(views: [iconView, copy])
        content.orientation = .horizontal
        content.spacing = 11
        content.alignment = .centerY
        content.translatesAutoresizingMaskIntoConstraints = false
        addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            content.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            content.topAnchor.constraint(equalTo: topAnchor, constant: 11),
            content.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -11)
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func update(status: String, detail: String, symbol: String, tint: NSColor) {
        iconView.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        iconView.contentTintColor = tint
        statusLabel.stringValue = status
        statusLabel.textColor = tint
        detailLabel.stringValue = detail
    }
}

final class StatusApp: NSObject, NSApplicationDelegate {
    private var item: NSStatusItem!
    private var menu: NSMenu!
    private var summaryItem: NSMenuItem!
    private var statusHeaderView: StatusHeaderView!
    private var activityRows: [NSMenuItem] = []
    private var activityRootItem: NSMenuItem!
    private var activityMenu: NSMenu!
    private var orchardRootItem: NSMenuItem!
    private var orchardMenu: NSMenu!
    private var checkNowItem: NSMenuItem!
    private var startItem: NSMenuItem!
    private var stopItem: NSMenuItem!
    private var versionItem: NSMenuItem!
    private var networkItem: NSMenuItem!
    private var uptimeItem: NSMenuItem!
    private var pulseItem: NSMenuItem!
    private var detailsRootItem: NSMenuItem!
    private var detailsMenu: NSMenu!
    private var networkRootItem: NSMenuItem!
    private var networkMenu: NSMenu!
    private var networkRows: [NSMenuItem] = []
    private var bindingInProgress = false
    private var serviceInProgress = false
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
        menu.autoenablesItems = false

        statusHeaderView = StatusHeaderView()
        summaryItem = menuItem("Swartzit  ·  Checking…", nil)
        summaryItem.isEnabled = false
        summaryItem.view = statusHeaderView
        menu.addItem(summaryItem)

        menu.addItem(.separator())
        add("Open Swartzit", #selector(openSwartzit), icon: "arrow.up.forward.app")
        checkNowItem = add("Refresh status", #selector(checkNow), icon: "arrow.clockwise")
        menu.addItem(.separator())
        startItem = add("Start service", #selector(startSwartzit), icon: "play.fill")
        stopItem = add("Stop service", #selector(stopSwartzit), icon: "stop.fill")
        stopItem.isEnabled = false

        networkItem = menuItem("Network  ·  Checking…", nil, icon: "network")
        networkItem.isEnabled = false
        networkRootItem = menuItem("Network", nil, icon: "network")
        networkRootItem.toolTip = "Inspect the active network binding or choose another available macOS interface."
        networkMenu = NSMenu()
        networkRootItem.submenu = networkMenu
        networkMenu.addItem(networkItem)
        networkMenu.addItem(.separator())
        let checkingBindings = menuItem("Checking available interfaces…", nil, icon: "ellipsis.circle")
        checkingBindings.isEnabled = false
        networkMenu.addItem(checkingBindings)
        menu.addItem(networkRootItem)

        activityRootItem = menuItem("Recent activity", nil, icon: "chart.bar.fill")
        activityMenu = NSMenu()
        activityRootItem.submenu = activityMenu
        menu.addItem(activityRootItem)
        renderActivity(nil)

        detailsRootItem = menuItem("Server details", nil, icon: "info.circle")
        detailsMenu = NSMenu()
        detailsRootItem.submenu = detailsMenu
        versionItem = menuItem("Release  ·  Checking…", nil, icon: "info.circle")
        uptimeItem = menuItem("Uptime  ·  Checking…", nil, icon: "clock")
        pulseItem = menuItem("Pulse  ·  Checking…", nil, icon: "dot.radiowaves.left.and.right")
        for detail in [versionItem!, uptimeItem!, pulseItem!] {
            detail.isEnabled = false
            detailsMenu.addItem(detail)
        }
        menu.addItem(detailsRootItem)

        orchardRootItem = menuItem("Orchard", nil, icon: "square.grid.2x2")
        orchardMenu = NSMenu()
        orchardRootItem.submenu = orchardMenu
        menu.addItem(orchardRootItem)

        menu.addItem(.separator())
        add("Quit Swartzit Status", #selector(quit), icon: "power")
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

    private func setOrchardEnabled(_ enabled: Bool) {
        if enabled {
            orchardRootItem.isHidden = false
            guard orchardMenu.numberOfItems == 0 else { return }
            orchardMenu.addItem(menuItem("Open Orchard", #selector(openOrchard), icon: "square.grid.2x2"))
            orchardMenu.addItem(menuItem("Install Orchard with Homebrew…", #selector(installOrchard), icon: "arrow.down.circle"))
        } else {
            orchardRootItem.isHidden = true
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
                let headerStatus: String
                let headerDetail: String
                let headerSymbol: String
                let headerTint: NSColor
                if health == nil {
                    headerStatus = "Unavailable"
                    headerDetail = "Can’t reach the local status service"
                    headerSymbol = "questionmark.circle.fill"
                    headerTint = .systemOrange
                } else if !localUp {
                    headerStatus = "Stopped"
                    headerDetail = "Start service to bring Swartzit online"
                    headerSymbol = "xmark.circle.fill"
                    headerTint = .systemRed
                } else if publicDown || pulseDown {
                    headerStatus = "Running"
                    headerDetail = "Local server healthy · Public endpoint needs attention"
                    headerSymbol = "exclamationmark.triangle.fill"
                    headerTint = .systemOrange
                } else {
                    headerStatus = "Running"
                    headerDetail = "Local server healthy · Public endpoint available"
                    headerSymbol = "checkmark.circle.fill"
                    headerTint = .systemGreen
                }
                if self.item.button?.image == nil {
                    self.item.button?.title = localUp ? "● Swartzit" : "○ Swartzit"
                }
                if !self.serviceInProgress && !self.bindingInProgress {
                    self.statusHeaderView.update(status: headerStatus, detail: headerDetail, symbol: headerSymbol, tint: headerTint)
                    self.summaryItem.title = "Swartzit  ·  \(headerStatus)"
                }
                self.summaryItem.toolTip = self.summary(health)
                self.item.button?.toolTip = self.summary(health)
                self.item.button?.setAccessibilityLabel("Swartzit \(headerStatus.lowercased())")
                self.versionItem.title = "Release  ·  \(health?.version ?? "unknown")"
                self.networkItem.title = self.networkTitle(health?.network)
                self.uptimeItem.title = self.uptimeTitle(health?.uptime)
                self.pulseItem.title = self.pulseTitle(health?.pulse, publicStatus: health?.public)
                self.startItem.isEnabled = !self.serviceInProgress && !self.bindingInProgress && !localUp
                self.stopItem.isEnabled = !self.serviceInProgress && !self.bindingInProgress && localUp
                self.networkRootItem.isEnabled = !self.serviceInProgress && !self.bindingInProgress
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
        let currentMode = network?.mode
        let currentInterface = network?.web_interface
        networkRootItem.title = currentInterface.map { "Network  ·  \($0)" } ?? "Network"
        networkMenu.removeAllItems()
        networkRows.removeAll(keepingCapacity: true)
        networkMenu.addItem(networkItem)
        networkMenu.addItem(.separator())

        guard !options.isEmpty else {
            let unavailable = menuItem("No active IPv4 interfaces found", nil, icon: "exclamationmark.triangle")
            unavailable.isEnabled = false
            networkMenu.addItem(unavailable)
            return
        }

        let note = menuItem("Current  ·  \(currentInterface ?? "unknown")", nil, icon: "checkmark.circle")
        note.isEnabled = false
        networkMenu.addItem(note)
        networkMenu.addItem(.separator())
        for option in options {
            let row = menuItem("\(option.label)  ·  \(option.interface)  ·  \(option.ip)", #selector(selectBinding(_:)), icon: bindingIcon(for: option))
            row.representedObject = option.id
            row.toolTip = "Restart Swartzit with the web server bound to \(option.interface) (\(option.ip))."
            if option.id == currentMode || (currentMode == "interface" && option.interface == currentInterface) {
                row.state = .on
            }
            networkMenu.addItem(row)
            networkRows.append(row)
        }
    }

    private func renderActivity(_ activity: Activity?) {
        activityMenu.removeAllItems()
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
            titles = ["No recent activity to show"]
        }

        for title in titles {
            let row = menuItem(title, nil, icon: "chart.bar.fill")
            row.isEnabled = false
            activityMenu.addItem(row)
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
                self.statusHeaderView.update(
                    status: result.code == 0 ? "Installed" : "Install failed",
                    detail: result.code == 0 ? "Orchard is ready to use" : "Could not install Orchard with Homebrew",
                    symbol: result.code == 0 ? "checkmark.circle.fill" : "exclamationmark.triangle.fill",
                    tint: result.code == 0 ? .systemGreen : .systemOrange
                )
                self.checkNow()
            }
        }
    }
    @objc private func selectBinding(_ sender: NSMenuItem) {
        guard !bindingInProgress, !serviceInProgress, let binding = sender.representedObject as? String else { return }
        bindingInProgress = true
        networkRootItem.isEnabled = false
        startItem.isEnabled = false
        stopItem.isEnabled = false
        for row in networkRows { row.isEnabled = false }
        summaryItem.title = "Swartzit  ·  Rebinding web + Caddy…"
        statusHeaderView.update(
            status: "Updating…",
            detail: "Rebinding web and refreshing Caddy",
            symbol: "arrow.clockwise.circle.fill",
            tint: .systemOrange
        )
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let result = self.run(["restart", binding])
            DispatchQueue.main.async {
                self.bindingInProgress = false
                self.networkRootItem.isEnabled = !self.serviceInProgress
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

    private func runService(_ arguments: [String], label: String) {
        guard !serviceInProgress, !bindingInProgress else { return }
        serviceInProgress = true
        startItem.isEnabled = false
        stopItem.isEnabled = false
        networkRootItem.isEnabled = false
        statusHeaderView.update(
            status: "Working…",
            detail: label,
            symbol: "arrow.clockwise.circle.fill",
            tint: .systemOrange
        )
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let result = self.run(arguments)
            DispatchQueue.main.async {
                self.serviceInProgress = false
                if result.code != 0 {
                    let alert = NSAlert()
                    alert.messageText = "Could not \(arguments.first ?? "update") Swartzit."
                    let output = String(data: result.data ?? Data(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
                    alert.informativeText = (output?.isEmpty == false ? output : nil) ?? "The service command failed."
                    alert.alertStyle = .warning
                    alert.addButton(withTitle: "OK")
                    alert.runModal()
                }
                self.checkNow()
            }
        }
    }

    @objc private func startSwartzit() {
        runService(["start"], label: "Starting local services")
    }

    @objc private func stopSwartzit() {
        runService(["stop"], label: "Stopping local services")
    }

    @objc private func quit() { NSApplication.shared.terminate(nil) }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
guard let instanceLock = SingleInstanceLock() else {
    exit(EXIT_SUCCESS)
}
let delegate = StatusApp()
app.delegate = delegate
withExtendedLifetime(instanceLock) {
    app.run()
}
