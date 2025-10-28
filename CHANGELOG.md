## 2025-10-28

- Fix Dockerfile for PDF microservice:
  - Install minimal runtime dependencies in image (`express`, `puppeteer`).
  - Preinstall Chrome for Testing during build to avoid runtime fetch.
  - Copy correct service path (`pdf-service.js` at project root).
  - Set correct start command and expose port 3002.

## 2025-10-28

- Update `pdf-service.js` to accept full URLs and enforce `ALLOWED_DOMAINS`:
  - Accepts http/https URLs or relative paths.
  - Validates hostname is in `ALLOWED_DOMAINS` or a subdomain.
  - Uses `PDF_TARGET_BASE_URL` when a relative path is provided.


## 2025-10-28

- Cleaned Docker containers/caches; built and tested PDF service.

## 2025-10-28

- Add .gitignore for Node, env, build, cache, editor files.

