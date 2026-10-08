class Swartzit < Formula
  desc "Self-hosted, pseudonymous discussion community"
  homepage "https://stoverparc.org"
  url "https://github.com/techmore/swartzit/archive/refs/tags/v0.1.94-20261008T2333.tar.gz"
  version "0.1.94.20261008.2333"
  sha256 "e0a6788974b559fd2991d80aecbd62bf8c4a0d38c264d0372a7807159c43a056"

  depends_on "node"
  depends_on "rust" => :build
  depends_on "python@3.14"

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
    # Keep the relative scripts/ paths used by runner templates intact in the
    # packaged worker. The launcher discovers this directory automatically.
    libexec.install "scripts" => "scripts"
    (libexec/"crates/server").install "crates/server/sqlite-migrations"
    etc.install ".env.example" => "swartzit.env.example"
  end

  def caveats
    <<~EOS
      Swartzit stores data in a local SQLite file. Start the app with:
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
