import UIKit
import WebKit

final class MainViewController: UIViewController {
    private var webView: WKWebView!
    private var bridge: FreeFlixBridge!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let contentController = WKUserContentController()
        bridge = FreeFlixBridge(viewController: self)
        contentController.add(bridge, name: "freeflix")
        contentController.addUserScript(WKUserScript(
            source: Self.bridgeScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        guard
            let rendererURL = Bundle.main.url(forResource: "renderer", withExtension: nil),
            let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "renderer")
        else {
            showLoadError()
            return
        }
        webView.loadFileURL(indexURL, allowingReadAccessTo: rendererURL)
    }

    func openPlayer(url: URL, metadata: [String: Any]) {
        let player = StreamPlayerViewController(url: url, metadata: metadata) { [weak self] message in
            self?.bridge.handlePlayerMessage(message)
        }
        player.modalPresentationStyle = .fullScreen
        present(player, animated: true)
    }

    func runJavaScript(_ script: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(script)
        }
    }

    private func showLoadError() {
        let label = UILabel()
        label.text = "FreeFlix could not load its bundled app files."
        label.textColor = .white
        label.textAlignment = .center
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24)
        ])
    }

    private static let bridgeScript = """
    (() => {
      document.documentElement.classList.add("ios-app");
      let nextId = 0;
      const pending = new Map();
      window.__freeflixResolve = (id, value, error) => {
        const handlers = pending.get(id);
        if (!handlers) return;
        pending.delete(id);
        if (error) handlers.reject(new Error(error));
        else handlers.resolve(value);
      };
      const call = (method, ...args) => new Promise((resolve, reject) => {
        const id = String(++nextId);
        pending.set(id, { resolve, reject });
        window.webkit.messageHandlers.freeflix.postMessage({ id, method, args });
      });
      const watchRequestListeners = new Set();
      const watchProgressListeners = new Set();
      window.freeflix = {
        windowControl: () => {},
        tmdbGet: (endpoint, params = {}) => call("tmdbGet", endpoint, params),
        imdbSearch: (query) => call("imdbSearch", query),
        imdbWatchExternal: (url) => call("imdbWatchExternal", url),
        getImdbId: (args = {}) => call("getImdbId", args),
        openStream: (args = {}) => call("openStream", args),
        authSignup: (username, password) => call("authSignup", username, password),
        authLogin: (username, password) => call("authLogin", username, password),
        authUpdatePassword: (currentPassword, newPassword) => call("authUpdatePassword", currentPassword, newPassword),
        authCheck: () => call("authCheck"),
        authLogout: () => call("authLogout"),
        getPendingWatchRequest: async () => null,
        onWatchRequest: (callback) => {
          if (typeof callback !== "function") return () => {};
          watchRequestListeners.add(callback);
          return () => watchRequestListeners.delete(callback);
        },
        onWatchProgress: (callback) => {
          if (typeof callback !== "function") return () => {};
          watchProgressListeners.add(callback);
          return () => watchProgressListeners.delete(callback);
        },
        _emitWatchRequest: (request) => watchRequestListeners.forEach((callback) => callback(request)),
        _emitWatchProgress: (progress) => watchProgressListeners.forEach((callback) => callback(progress))
      };
    })();
    """
}
