# FreeFlix iOS

This repository contains the native iOS shell and the bundled FreeFlix renderer.
The unsigned IPA is built by GitHub Actions on macOS. Download the
`FreeFlix-iOS-unsigned` artifact from a completed workflow run, then sign and
install it with AltStore or Sideloadly.

To enable TMDB and intro database API access in builds, add repository Actions
secrets named `TMDB_API_KEY` and `INTRODB_API_KEY`. Builds still run without
these secrets, but features requiring those APIs will not be available.

Run the `Build FreeFlix iOS` workflow manually from the Actions tab, or push
changes to `main` in `ios-app`, `renderer`, `config.json`, or the workflow.
