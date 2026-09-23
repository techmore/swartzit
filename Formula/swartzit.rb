class Swartzit < Formula
  desc "Self-hosted, pseudonymous discussion community"
  homepage "https://stoverparc.org"
  url "https://github.com/techmore/swartzit/archive/refs/tags/v0.1.4-20260923T12.tar.gz"
  version "0.1.4.20260923.12"
  sha256 "a049e36ee8fbbc1476e89811299d17a604ef6ebb9843b1d0ad9fb2b3bb5c3b16"

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
    libexec.install "VERSION", "apps/web/build"
    libexec.install "scripts/status-local.sh", "scripts/db-backup.sh",
      "scripts/db-restore-verify.sh", "scripts/db-restore.sh",
      "scripts/swartzit-update.sh",
      "scripts/swartzit-monitor.sh"
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
