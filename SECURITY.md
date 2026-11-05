# Security and public client boundary

## Reporting a vulnerability
Report vulnerabilities privately at <https://github.com/plato-corp/tiro-obsidian/security/advisories/new>. Do not open public issues, pull requests or discussions for vulnerabilities or exposed secrets.

## Public client boundary
This integration is a public client. Its public OAuth client identifier, API hostnames, read scopes and desktop URL routes are not secrets. Credentials, private API implementations, organization data and internal work notes must never be bundled.

Authentication uses public-client PKCE or a user-provided API key. Requests are sent to the fixed Tiro API/MCP endpoints. This integration does not contain server signing keys, OAuth client secrets or backend business logic. Server-side authorization must enforce account, workspace and note permissions for every request; hiding client code is not an authorization control.

## Credentials
Obsidian keeps API keys and OAuth tokens in memory for the loaded plugin session. The plugin settings file contains only public settings and client registration. Existing plaintext credentials are loaded once into the current session and removed from the settings file on upgrade. Reloading the plugin or app requires signing in or entering an API key again. Mobile users enter an API key for each app session.

Logging out invalidates pending authorization work in Obsidian and Chrome. Revocation of already issued server tokens depends on the provider; removing local credentials does not prove provider-side revocation.

## Release checks
Build production output and copy only the approved files into an empty staging directory. Run `npm run security:package -- /absolute/path/to/staging`. The check fails on source maps, inline map references, private-key/token signatures, internal paths/context, credential files, symlinks and Gitleaks findings. Gitleaks is required; a missing scanner fails the check. Passing a pattern scanner is not a guarantee that every possible secret is absent. Review image assets and public source changes before distribution.
