import Cocoa
import Foundation

struct Health: Decodable {
    let api: String
    let web: String
    let database: String
    let caddy: String
    let worker: String
    let `public`: String
}
struct ActivityWindow: Decodable { let label: String; let users: Int; let posts: Int; let comments: Int }
struct Activity: Decodable { let windows: [ActivityWindow] }

final class StatusApp: NSObject, NSApplicationDelegate {
    private var item: NSStatusItem!
    private var menu: NSMenu!
    private var timer: Timer?
    private var command: String { ProcessInfo.processInfo.environment["SWARTZIT_COMMAND"] ?? "swartzit" }
    private var openURL: String { ProcessInfo.processInfo.environment["SWARTZIT_OPEN_URL"] ?? "http://127.0.0.1:4173" }

    func applicationDidFinishLaunching(_ notification: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "● Swartzit"
        menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Swartzit: Checking…", action: nil, keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Activity: Checking…", action: nil, keyEquivalent: ""))
        menu.addItem(.separator())
        add("Open Swartzit", #selector(openSwartzit))
        add("Check Now", #selector(checkNow))
        add("Start Swartzit", #selector(startSwartzit))
        add("Stop Swartzit", #selector(stopSwartzit))
        menu.addItem(.separator())
        add("Quit", #selector(quit))
        item.menu = menu
        checkNow()
        timer = Timer.scheduledTimer(timeInterval: 30, target: self, selector: #selector(checkNow), userInfo: nil, repeats: true)
    }

    private func add(_ title: String, _ action: Selector) {
        let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
        entry.target = self
        menu.addItem(entry)
    }

    @objc private func checkNow() {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            let result = self.run(["status", "--json"])
            let health = result.data.flatMap { try? JSONDecoder().decode(Health.self, from: $0) }
            DispatchQueue.main.async {
                let ready = health?.api == "ready" && health?.web == "ready" && health?.database == "ready" && health?.public != "down"
                self.item.button?.title = ready ? "● Swartzit" : "○ Swartzit"
                let summary = self.menu.items[0]
                summary.title = ready ? "Swartzit: Running" : (health == nil ? "Swartzit: Unavailable" : "Swartzit: Needs attention")
                summary.toolTip = self.summary(health)
            }
            let activity = self.fetchActivity()
            DispatchQueue.main.async { self.menu.items[1].title = self.activitySummary(activity) }
        }
    }

    private func fetchActivity() -> Activity? {
        let api = ProcessInfo.processInfo.environment["SWARTZIT_API_URL"] ?? "http://127.0.0.1:18080"
        guard let url = URL(string: "\(api)/api/activity"), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Activity.self, from: data)
    }

    private func activitySummary(_ activity: Activity?) -> String {
        guard let activity else { return "Activity: unavailable" }
        return "Activity: " + activity.windows.map { "\($0.label): \($0.users) users · \($0.posts) posts · \($0.comments) comments" }.joined(separator: " | ")
    }

    private func summary(_ health: Health?) -> String {
        guard let health else { return "Could not read Swartzit status." }
        return "API \(health.api) · Web \(health.web) · DB \(health.database)"
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

    @objc private func openSwartzit() { if let url = URL(string: openURL) { NSWorkspace.shared.open(url) } }
    @objc private func startSwartzit() { _ = run(["start"]); checkNow() }
    @objc private func stopSwartzit() { _ = run(["stop"]); checkNow() }
    @objc private func quit() { NSApplication.shared.terminate(nil) }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = StatusApp()
app.delegate = delegate
app.run()
