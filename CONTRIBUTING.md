# Contributing

1. Fork the repository and create a branch from `main`.
2. Make your change and run the same checks as CI (Node 22):

   ```bash
   npm ci
   npm run lint
   npm test
   npm run build
   ```

3. Open a pull request against `main`.

Every pull request, including those from maintainers, requires code owner approval from @paul-theplato and a passing `verify` CI check before it can be merged.

Do not report vulnerabilities or exposed secrets in issues or pull requests. Follow [SECURITY.md](SECURITY.md) instead.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
