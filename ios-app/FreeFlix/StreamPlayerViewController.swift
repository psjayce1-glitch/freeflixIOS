import UIKit
import WebKit

final class StreamPlayerViewController: UIViewController, WKScriptMessageHandler {
    private let url: URL
    private let metadata: [String: Any]
    private let onMessage: ([String: Any]) -> Void
    private var webView: WKWebView!

    init(url: URL, metadata: [String: Any], onMessage: @escaping ([String: Any]) -> Void) {
        self.url = url
        self.metadata = metadata
        self.onMessage = onMessage
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var prefersStatusBarHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let controller = WKUserContentController()
        let metadataJSON = Self.jsonLiteral(metadata)
        let playerScript = """
        window.__freeflixStreamMetadata = \(metadataJSON);
        \(Self.playerScript)
        """
        controller.addUserScript(WKUserScript(source: playerScript, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        controller.add(self, name: "freeflixPlayer")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        var request = URLRequest(url: url)
        request.setValue("https://imdb.su/", forHTTPHeaderField: "Referer")
        webView.load(request)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        onMessage(body)
    }

    private static func jsonLiteral(_ object: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.fragmentsAllowed]),
              let string = String(data: data, encoding: .utf8) else { return "{}" }
        return string
    }

    private static let playerScript = """
    (() => {
      if (window.__freeflixIOSPlayerInstalled) return;
      window.__freeflixIOSPlayerInstalled = true;
      const send = (method, values = {}) => window.webkit.messageHandlers.freeflixPlayer.postMessage({
        method, metadata: window.__freeflixStreamMetadata || {}, ...values
      });
      const style = document.createElement("style");
      style.textContent = "#__ff_ios{position:fixed;inset:0;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .2s;font:600 14px system-ui,sans-serif}#__ff_ios.visible{opacity:1}#__ff_ios button{pointer-events:auto;border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:12px 16px;background:rgba(12,12,14,.88);color:#fff;font:inherit}#__ff_ios_back{position:absolute;top:calc(env(safe-area-inset-top) + 16px);left:16px}#__ff_ios_skip{position:absolute;right:16px;bottom:calc(env(safe-area-inset-bottom) + 24px);display:none;background:#e50914!important}#__ff_ios_skip.visible{display:block}";
      (document.head || document.documentElement).appendChild(style);
      const controls = document.createElement("div");
      controls.id = "__ff_ios";
      controls.innerHTML = '<button id="__ff_ios_back" type="button">Back to FreeFlix</button><button id="__ff_ios_skip" type="button">Skip Intro</button>';
      (document.body || document.documentElement).appendChild(controls);
      const back = controls.querySelector("#__ff_ios_back");
      const skip = controls.querySelector("#__ff_ios_skip");
      let hideTimer = 0, lastProgressAt = 0, introRange = window.__freeflixStreamMetadata?.introWindow || null, resumeApplied = Number(window.__freeflixStreamMetadata?.resumeAt || 0) < 5;
      back.addEventListener("click", () => send("close"));
      skip.addEventListener("click", () => {
        const video = document.querySelector("video");
        const end = Number(skip.dataset.end || introRange?.end || 0);
        if (video && end > 0) video.currentTime = end;
        skip.classList.remove("visible");
      });
      const showControls = () => {
        controls.classList.add("visible");
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => controls.classList.remove("visible"), 2800);
      };
      addEventListener("pointerdown", showControls, { passive: true });
      addEventListener("touchstart", showControls, { passive: true });
      addEventListener("keydown", event => { if (event.key === "Escape") send("close"); else showControls(); });
      const updateIntro = video => {
        const time = Number(video.currentTime) || 0, duration = Number(video.duration) || 0;
        const start = Number(introRange?.start ?? 30);
        const end = Number(introRange?.end ?? Math.min(Math.max(90, duration * .18), 180));
        if (end > start && time >= start && time < end) {
          skip.dataset.end = String(end);
          skip.classList.add("visible");
        } else {
          skip.dataset.end = "";
          skip.classList.remove("visible");
        }
      };
      const watch = video => {
        if (video.dataset.freeflixIOSWatched) return;
        video.dataset.freeflixIOSWatched = "1";
        const report = () => {
          if (video.duration > 0) send("reportProgress", { currentTime: video.currentTime, duration: video.duration });
        };
        video.addEventListener("timeupdate", () => {
          if (Date.now() - lastProgressAt >= 10000) { lastProgressAt = Date.now(); report(); }
          updateIntro(video);
        });
        video.addEventListener("pause", report);
        video.addEventListener("ended", () => { report(); send("nextEpisode"); });
        video.addEventListener("loadedmetadata", () => {
          const resume = Math.max(0, Number(window.__freeflixStreamMetadata?.resumeAt) || 0);
          if (!resumeApplied) {
            try { video.currentTime = Math.min(resume, Number.isFinite(video.duration) ? Math.max(0, video.duration - 1) : resume); resumeApplied = true; } catch {}
          }
          try { video.play().catch(() => {}); } catch {}
          updateIntro(video);
        });
      };
      const refresh = () => document.querySelectorAll("video").forEach(watch);
      refresh();
      new MutationObserver(refresh).observe(document.documentElement, { childList: true, subtree: true });
      setInterval(refresh, 2000);
      showControls();
    })();
    """
}
