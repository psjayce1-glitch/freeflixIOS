(() => {
  const android = window.AndroidFreeFlix;
  if (!android) return;

  document.documentElement.classList.add("android-app");
  if (android.isTelevision?.() === true) {
    document.documentElement.classList.add("android-tv-app");
    document.body.classList.add("controller-mode");
  }
  const watchRequestListeners = new Set();
  const watchProgressListeners = new Set();
  const pendingTmdbRequests = new Map();
  let nextTmdbRequestId = 0;

  function parseResult(raw) {
    const result = JSON.parse(raw);
    if (result && result.__error) throw new Error(result.__error);
    return result;
  }

  function tmdbGet(endpoint, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = `tmdb-${++nextTmdbRequestId}`;
      const timeout = setTimeout(() => {
        pendingTmdbRequests.delete(requestId);
        reject(new Error("The catalog request timed out. Check your connection and retry."));
      }, 15000);

      pendingTmdbRequests.set(requestId, (raw) => {
        clearTimeout(timeout);
        try {
          resolve(parseResult(raw));
        } catch (error) {
          reject(error);
        }
      });

      try {
        android.tmdbGetAsync(endpoint, JSON.stringify(params), requestId);
      } catch (error) {
        clearTimeout(timeout);
        pendingTmdbRequests.delete(requestId);
        reject(error);
      }
    });
  }

  window.freeflix = {
    windowControl: () => {},
    tmdbGet,
    imdbSearch: async (query) => parseResult(android.imdbSearch(query)),
    imdbWatchExternal: (url) => android.imdbWatchExternal(url),
    getImdbId: async (args = {}) => android.getImdbId(JSON.stringify(args)) || null,
    openStream: async (args = {}) => android.openStream(JSON.stringify(args)),
    onWatchProgress: (callback) => {
      if (typeof callback !== "function") return () => {};
      watchProgressListeners.add(callback);
      return () => watchProgressListeners.delete(callback);
    },
    getPendingWatchRequest: async () => null,
    onWatchRequest: (callback) => {
      if (typeof callback !== "function") return () => {};
      watchRequestListeners.add(callback);
      return () => watchRequestListeners.delete(callback);
    },
    authSignup: async (username, password) => parseResult(android.authSignup(username, password)),
    authLogin: async (username, password) => parseResult(android.authLogin(username, password)),
    authUpdatePassword: async (currentPassword, newPassword) => parseResult(android.authUpdatePassword(currentPassword, newPassword)),
    authCheck: async () => parseResult(android.authCheck()),
    authLogout: async () => parseResult(android.authLogout()),
    _emitWatchProgress: (progress) => watchProgressListeners.forEach((callback) => callback(progress)),
    _emitWatchRequest: (request) => watchRequestListeners.forEach((callback) => callback(request)),
    _resolveTmdbRequest: (requestId, raw) => {
      const resolve = pendingTmdbRequests.get(requestId);
      if (!resolve) return;
      pendingTmdbRequests.delete(requestId);
      resolve(raw);
    },
  };
})();