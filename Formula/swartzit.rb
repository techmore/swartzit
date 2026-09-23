class Swartzit < Formula
  desc "Self-hosted, pseudonymous discussion community"
  homepage "https://stoverparc.org"
  url "https://github.com/techmore/swartzit/archive/refs/tags/v0.1.19-20260923T18.tar.gz"
  version "0.1.19.20260923.18"
  sha256 "7e005f4fd400c61e2d93d3b58e098a19fc6d254eb2de00aa40a8668def6b2c47"

  depends_on "node" => :build
  depends_on "rust" => :build

  def install
    ENV.prepend_path "PATH", HOMEBREW_PREFIX/"bin"
    system "cargo", "install", *std_cargo_args(path: "crates/server")
    system "npm", "--prefix", "apps/web", "ci"
    system "npm", "--prefix", "apps/web", "run", "build"

    if OS.mac?
      system "swiftc", "-O", "-o", "swartzit-status", "macos/SwartzitStatus.swift"
      bin.install "swartzit-status"
    end

    bin.install "scripts/swartzit"
    libexec.install "VERSION", "apps/web/build", "apps/web/static/swartzit-icon.png"
    libexec.install "scripts/status-local.sh", "scripts/network-options.sh", "scripts/db-backup.sh",
      "scripts/db-restore-verify.sh", "scripts/db-restore.sh",
      "scripts/swartzit-update.sh",
      "scripts/swartzit-monitor.sh", "scripts/install-mac-monitor.sh",
      "scripts/install-mac-status.sh", "scripts/install-mac-backup.sh",
      "scripts/swartzit-caddy.sh", "scripts/install-mac-caddy.sh",
      "scripts/record-uptime-pulse.mjs", "scripts/runner-starter.mjs",
      "scripts/runner-prompt.mjs", "scripts/draw-things-runner.mjs",
      "scripts/x-cross-post-runner.mjs", "scripts/crawler-adapters.mjs", "scripts/x-media.mjs",
      "scripts/swartzit-orchard.sh"
    etc.install ".env.example" => "swartzit.env.example"
  end

  def caveats
    <<~EOS
      Swartzit requires PostgreSQL. Start the app with:
        swartzit start
      Configure DATABASE_URL and BIND_ADDR in #{etc}/swartzit.env.example.
      Runtime state and backups default to ~/Library/Application Support/Swartzit;
      set SWARTZIT_DATA_DIR to choose another persistent location.
      On macOS, run `swartzit-status` for a native menu-bar health indicator.
    EOS
  end

  test do
    assert_path_exists bin/"swartzit-server"
  end
end
