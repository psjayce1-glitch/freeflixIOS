import CryptoKit
import Foundation
import WebKit

final class FreeFlixBridge: NSObject, WKScriptMessageHandler {
    private weak var viewController: MainViewController?
    private let defaults = UserDefaults.standard
    private let config: [String: Any]

    init(viewController: MainViewController) {
        self.viewController = viewController
        if let url = Bundle.main.url(forResource: "config", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            config = object
        } else {
            config = [:]
        }
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            let body = message.body as? [String: Any],
            let id = body["id"] as? String,
            let method = body["method"] as? String,
            let args = body["args"] as? [Any]
        else { return }

        Task {
            do {
                let value = try await handle(method: method, args: args)
                resolve(id: id, value: value, error: nil)
            } catch {
                resolve(id: id, value: NSNull(), error: error.localizedDescription)
            }
        }
    }

    func handlePlayerMessage(_ message: [String: Any]) {
        guard let method = message["method"] as? String else { return }
        switch method {
        case "close":
            viewController?.dismiss(animated: true)
        case "reportProgress":
            guard
                let metadata = message["metadata"] as? [String: Any],
                let currentTime = message["currentTime"] as? Double,
                let duration = message["duration"] as? Double,
                currentTime.isFinite, duration.isFinite, currentTime >= 0, duration > 0
            else { return }
            var progress = metadata
            progress["currentTime"] = min(currentTime, duration)
            progress["duration"] = duration
            progress["updatedAt"] = Int(Date().timeIntervalSince1970 * 1000)
            emit("_emitWatchProgress", value: progress)
        case "nextEpisode":
            guard let metadata = message["metadata"] as? [String: Any] else { return }
            var request: [String: Any] = [
                "tmdbId": metadata["tmdbId"] ?? 0,
                "title": metadata["title"] ?? "",
                "kind": "tv",
                "season": metadata["season"] ?? 1,
                "episode": (metadata["episode"] as? Int ?? 1) + 1
            ]
            request["episodeTitle"] = ""
            emit("_emitWatchRequest", value: request)
            viewController?.dismiss(animated: true)
        default:
            break
        }
    }

    private func handle(method: String, args: [Any]) async throws -> Any {
        switch method {
        case "tmdbGet":
            guard let endpoint = args.first as? String, endpoint.hasPrefix("/"), !endpoint.hasPrefix("//") else {
                throw BridgeError.message("Invalid TMDB endpoint.")
            }
            guard let key = config["tmdbApiKey"] as? String, !key.isEmpty else {
                throw BridgeError.message("No TMDB API key configured.")
            }
            guard var components = URLComponents(string: "https://api.themoviedb.org/3\(endpoint)") else {
                throw BridgeError.message("Invalid TMDB endpoint.")
            }
            var query = [URLQueryItem(name: "api_key", value: key)]
            if args.count > 1, let params = args[1] as? [String: Any] {
                query += params.compactMap { key, value in
                    let string = String(describing: value)
                    return string.isEmpty || string == "null" ? nil : URLQueryItem(name: key, value: string)
                }
            }
            components.queryItems = query
            guard let url = components.url else { throw BridgeError.message("Invalid TMDB request.") }
            return try await jsonRequest(url)
        case "imdbSearch":
            let query = args.first as? String ?? ""
            let result = try await jsonRequest(serviceURL(host: "www.omdbapi.com", path: "/", query: [
                URLQueryItem(name: "s", value: query),
                URLQueryItem(name: "apikey", value: "T5851222")
            ]))
            guard let first = (result["Search"] as? [[String: Any]])?.first,
                  let imdbId = first["imdbID"] as? String else { return [] }
            return [[
                "title": first["Title"] ?? "",
                "imdbId": imdbId,
                "originalUrl": "https://www.imdb.com/title/\(imdbId)/"
            ]]
        case "getImdbId":
            let values = args.first as? [String: Any] ?? [:]
            let tmdbId = values["tmdbId"] as? Int ?? 0
            let kind = values["kind"] as? String == "tv" ? "tv" : "movie"
            if tmdbId > 0, let key = config["tmdbApiKey"] as? String {
                let url = try serviceURL(
                    host: "api.themoviedb.org",
                    path: "/3/\(kind)/\(tmdbId)/external_ids",
                    query: [URLQueryItem(name: "api_key", value: key)]
                )
                if let result = try? await jsonRequest(url), let id = result["imdb_id"] as? String, !id.isEmpty {
                    return id
                }
            }
            if let title = values["title"] as? String, !title.isEmpty,
               let result = try? await jsonRequest(serviceURL(host: "www.omdbapi.com", path: "/", query: [
                   URLQueryItem(name: "s", value: title),
                   URLQueryItem(name: "apikey", value: "T5851222")
               ])),
               let first = (result["Search"] as? [[String: Any]])?.first,
               let id = first["imdbID"] as? String {
                return id
            }
            return NSNull()
        case "authSignup":
            return signup(username: args[safe: 0] as? String, password: args[safe: 1] as? String)
        case "authLogin":
            return login(username: args[safe: 0] as? String, password: args[safe: 1] as? String)
        case "authUpdatePassword":
            return updatePassword(current: args[safe: 0] as? String, new: args[safe: 1] as? String)
        case "authCheck":
            let username = defaults.string(forKey: "freeflix.username") ?? ""
            return ["loggedIn": !username.isEmpty, "username": username.isEmpty ? NSNull() : username as Any]
        case "authLogout":
            defaults.removeObject(forKey: "freeflix.username")
            return ["ok": true]
        case "openStream":
            guard let values = args.first as? [String: Any],
                  let rawURL = values["streamUrl"] as? String,
                  let url = URL(string: rawURL),
                  ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
                throw BridgeError.message("The stream URL must use HTTP or HTTPS.")
            }
            var playerMetadata = values
            if let window = introWindow(title: values["title"] as? String ?? "",
                                        season: values["season"] as? Int ?? 1,
                                        episode: values["episode"] as? Int ?? 1) {
                playerMetadata["introWindow"] = window
            }
            DispatchQueue.main.async { [weak self] in
                self?.viewController?.openPlayer(url: url, metadata: playerMetadata)
            }
            return ["ok": true]
        case "imdbWatchExternal":
            guard let rawURL = args.first as? String,
                  let url = URL(string: rawURL),
                  ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
                throw BridgeError.message("The player URL must use HTTP or HTTPS.")
            }
            DispatchQueue.main.async { [weak self] in
                self?.viewController?.openPlayer(url: url, metadata: ["streamUrl": rawURL, "title": "FreeFlix"])
            }
            return ["ok": true]
        default:
            throw BridgeError.message("Unsupported FreeFlix action: \(method)")
        }
    }

    private func jsonRequest(_ url: URL) async throws -> [String: Any] {
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 20
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw BridgeError.message("Request failed: \((response as? HTTPURLResponse)?.statusCode ?? 0).")
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BridgeError.message("The service returned invalid JSON.")
        }
        return json
    }

    private func serviceURL(host: String, path: String, query: [URLQueryItem]) throws -> URL {
        var components = URLComponents()
        components.scheme = "https"
        components.host = host
        components.path = path
        components.queryItems = query
        guard let url = components.url else { throw BridgeError.message("Invalid service URL.") }
        return url
    }

    private func signup(username: String?, password: String?) -> [String: Any] {
        guard let username, let password, !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !password.isEmpty else {
            return ["ok": false, "error": "Username and password are required."]
        }
        let normalized = username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard normalized.count >= 3 else { return ["ok": false, "error": "Username must be at least 3 characters."] }
        guard password.count >= 4 else { return ["ok": false, "error": "Password must be at least 4 characters."] }
        var users = defaults.dictionary(forKey: "freeflix.users") as? [String: String] ?? [:]
        guard users[normalized] == nil else { return ["ok": false, "error": "Username already taken."] }
        users[normalized] = passwordHash(password)
        defaults.set(users, forKey: "freeflix.users")
        defaults.set(normalized, forKey: "freeflix.username")
        return ["ok": true, "username": normalized]
    }

    private func login(username: String?, password: String?) -> [String: Any] {
        guard let username, let password, !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !password.isEmpty else {
            return ["ok": false, "error": "Username and password are required."]
        }
        let normalized = username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let users = defaults.dictionary(forKey: "freeflix.users") as? [String: String] ?? [:]
        guard let hash = users[normalized] else { return ["ok": false, "error": "User not found."] }
        guard hash == passwordHash(password) else { return ["ok": false, "error": "Incorrect password."] }
        defaults.set(normalized, forKey: "freeflix.username")
        return ["ok": true, "username": normalized]
    }

    private func updatePassword(current: String?, new: String?) -> [String: Any] {
        let username = defaults.string(forKey: "freeflix.username") ?? ""
        guard !username.isEmpty else { return ["ok": false, "error": "Please log in again before changing your password."] }
        guard let new, new.count >= 4 else { return ["ok": false, "error": "New password must be at least 4 characters."] }
        var users = defaults.dictionary(forKey: "freeflix.users") as? [String: String] ?? [:]
        guard users[username] == passwordHash(current ?? "") else { return ["ok": false, "error": "Current password is incorrect."] }
        users[username] = passwordHash(new)
        defaults.set(users, forKey: "freeflix.users")
        return ["ok": true]
    }

    private func passwordHash(_ password: String) -> String {
        SHA256.hash(data: Data(password.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func introWindow(title: String, season: Int, episode: Int) -> [String: Double]? {
        guard let overrides = config["skipIntroOverrides"] as? [String: Any] else { return nil }
        let normalizedTitle = title.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: " ")
        guard let show = overrides.first(where: {
            $0.key.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: " ") == normalizedTitle
        })?.value as? [String: Any] else { return nil }
        let keys = ["\(season)x\(episode)", "s\(season)e\(episode)", "default", "intro", "opening", "recap", "coldOpen"]
        for key in keys {
            if let value = show[key] as? [String: Any],
               let start = (value["start"] as? NSNumber)?.doubleValue,
               let end = (value["end"] as? NSNumber)?.doubleValue,
               end > start {
                return ["start": start, "end": end]
            }
        }
        return nil
    }

    private func resolve(id: String, value: Any, error: String?) {
        guard let idJSON = Self.jsonLiteral(id),
              let valueJSON = Self.jsonLiteral(value),
              let errorJSON = Self.jsonLiteral(error as Any? ?? NSNull()) else { return }
        viewController?.runJavaScript("window.__freeflixResolve(\(idJSON), \(valueJSON), \(errorJSON))")
    }

    private func emit(_ method: String, value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
              let json = String(data: data, encoding: .utf8) else { return }
        viewController?.runJavaScript("window.freeflix?.\(method)(\(json))")
    }

    private static func jsonLiteral(_ value: Any) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

private enum BridgeError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case let .message(message) = self { return message }
        return nil
    }
}

private extension Collection {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
