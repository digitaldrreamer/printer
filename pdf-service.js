import express from "express"
import { createServer } from "node:http"
import puppeteer, { executablePath } from "puppeteer"
import fs from "node:fs"

// * Simple PDF microservice exposing a single GET /pdf endpoint
// * It accepts a full URL (http/https) or a relative path and returns the PDF buffer.
// * Security: Only allows hostnames listed in ALLOWED_DOMAINS or any of their subdomains.
// * Env:
// * - ALLOWED_DOMAINS: comma-separated domains, e.g. "example.com,sample.org" (required). If "*", allow any host.
// * - PDF_TARGET_BASE_URL: base used when a relative path is provided (required for relative paths)
// * Usage examples:
// *   GET /pdf?url=https://example.com/invoice/123
// *   GET /pdf?url=/invoice/123   (combined with PDF_TARGET_BASE_URL)
// * Optional query params (all optional, with safe defaults):
// *   - disposition: "attachment" (default) | "inline"
// *   - timeoutMs: integer milliseconds (default 30000)
// *   - format: Puppeteer-supported format (default "Letter")
// *   - orientation: "portrait" (default) | "landscape"
// *   - scale: number 0.1-2 (default 1)
// *   - margin: string applied to all sides, e.g. "0.5in" (default 0.5in)
// *   - marginTop/marginRight/marginBottom/marginLeft: per-side overrides
// *   - printBackground: "true"|"false" (default true)
// *   - displayHeaderFooter: "true"|"false" (default false)
// *   - preferCSSPageSize: "true"|"false" (default false)
// *   - tagged: "true"|"false" (default true)
// *   - outline: "true"|"false" (default false)

const port = process.env.PDF_SERVICE_PORT || 3002
const app = express()
const server = createServer(app)

// * Simple in-memory single-concurrency queue to serialize PDF renders
const __queue = []
let __isBusy = false

function enqueueJob(job) {
  return new Promise((resolve, reject) => {
    __queue.push({ job, resolve, reject })
    // eslint-disable-next-line no-void
    void __drain()
  })
}

async function __drain() {
  if (__isBusy) return
  const next = __queue.shift()
  if (!next) return
  __isBusy = true
  try {
    const result = await next.job()
    next.resolve(result)
  } catch (err) {
    next.reject(err)
  } finally {
    __isBusy = false
    // eslint-disable-next-line no-void
    void __drain()
  }
}

/**
 * GET /pdf
 * Query params:
 * - url: required. Full http(s) URL or a relative path
 */
app.get("/pdf", async (req, res) => {
  const start = performance.now()
  const rawUrl = req.query.url
  if (!rawUrl || typeof rawUrl !== "string") {
    return res.status(400).json({ success: false, error: "Missing required query param: url" })
  }

  // * Parse and validate ALLOWED_DOMAINS
  const allowedDomainsEnv = process.env.ALLOWED_DOMAINS || ""
  const isWildcardAllowed = allowedDomainsEnv.trim() === "*"
  const allowedDomains = isWildcardAllowed
    ? []
    : allowedDomainsEnv
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0)

  if (!isWildcardAllowed && allowedDomains.length === 0) {
    return res.status(400).json({
      success: false,
      error: "ALLOWED_DOMAINS is not configured; set a comma-separated list of domains or '*'",
    })
  }

  // * Helper: check if a hostname is allowed (domain or any subdomain)
  const isHostAllowed = (hostname) => {
    const host = String(hostname || "").toLowerCase()
    if (isWildcardAllowed) return true
    return allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))
  }

  // * Build final target URL from either a full URL or a relative path
  let targetUrl
  try {
    if (/^https?:\/\//i.test(rawUrl)) {
      // * Full URL case
      const parsed = new URL(rawUrl)
      if (!isHostAllowed(parsed.hostname)) {
        return res.status(403).json({ success: false, error: "URL host is not allowed" })
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return res.status(400).json({ success: false, error: "Only http/https protocols are allowed" })
      }
      targetUrl = parsed.toString()
    } else {
      // * Relative path case
      const baseUrl = process.env.PDF_TARGET_BASE_URL
      if (!baseUrl) {
        return res.status(400).json({
          success: false,
          error: "PDF_TARGET_BASE_URL is required when providing a relative path",
        })
      }
      const relativePath = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`
      const parsed = new URL(relativePath, baseUrl)
      if (!isHostAllowed(parsed.hostname)) {
        return res.status(403).json({ success: false, error: "Base URL host is not allowed" })
      }
      targetUrl = parsed.toString()
    }
  } catch (e) {
    return res.status(400).json({ success: false, error: "Invalid URL provided" })
  }

  await enqueueJob(async () => {
    let browser
    try {
      // * Parse PDF and runtime options from query with defaults
      const parseBool = (val, def) => {
        if (typeof val === "undefined") return def
        const s = String(val).toLowerCase()
        return s === "true" || s === "1" || s === "yes"
      }
      const parseNumber = (val, def) => {
        if (typeof val === "undefined") return def
        const n = Number(val)
        return Number.isFinite(n) ? n : def
      }

      const disposition = (req.query.disposition === "inline" ? "inline" : "attachment")
      const timeoutMs = Math.max(0, parseInt(String(req.query.timeoutMs || "30000"), 10) || 30000)

      const defaultMargin = String(req.query.margin || "0.5in")
      const margins = {
        top: String(req.query.marginTop || defaultMargin),
        right: String(req.query.marginRight || defaultMargin),
        bottom: String(req.query.marginBottom || defaultMargin),
        left: String(req.query.marginLeft || defaultMargin),
      }

      const format = String(req.query.format || "Letter")
      const orientation = (String(req.query.orientation || "portrait").toLowerCase() === "landscape")
        ? "landscape"
        : "portrait"
      const scale = (() => {
        const s = parseNumber(req.query.scale, 1)
        if (!Number.isFinite(s)) return 1
        return Math.max(0.1, Math.min(2, s))
      })()
      const printBackground = parseBool(req.query.printBackground, true)
      const displayHeaderFooter = parseBool(req.query.displayHeaderFooter, false)
      const preferCSSPageSize = parseBool(req.query.preferCSSPageSize, false)
      const tagged = parseBool(req.query.tagged, true)
      const outline = parseBool(req.query.outline, false)

      console.log("PDF Service: Launching Puppeteer with bundled Chrome for Testing")

      browser = await puppeteer.launch({
        headless: "new",
        executablePath: executablePath(),
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--single-process",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-extensions",
          "--disable-sync",
          "--hide-scrollbars",
          "--mute-audio",
        ],
        timeout: timeoutMs,
        protocolTimeout: timeoutMs,
      })

      const page = await browser.newPage()

      await page.setRequestInterception(true)
      page.on("request", (reqIntercept) => {
        const resourceType = reqIntercept.resourceType()
        if (["image", "media", "font"].includes(resourceType)) {
          return reqIntercept.abort()
        }
        reqIntercept.continue()
      })

      await page.goto(String(targetUrl), {
        waitUntil: ["domcontentloaded", "networkidle0"],
        timeout: timeoutMs,
      })

      await new Promise((r) => setTimeout(r, 750))

      const pdfBuffer = await page.pdf({
        format,
        orientation,
        margin: margins,
        scale,
        displayHeaderFooter,
        printBackground,
        preferCSSPageSize,
        tagged,
        outline,
        timeout: timeoutMs,
      })

      const durationMs = performance.now() - start
      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `${disposition}; filename=\"render-${Date.now()}\".pdf`)
      res.setHeader("Content-Length", String(pdfBuffer.length))
      res.setHeader("X-Render-Duration", `${durationMs.toFixed(2)}ms`)
      return res.status(200).send(pdfBuffer)
    } catch (error) {
      const durationMs = performance.now() - start
      console.error("PDF microservice error:", error)
      return res.status(500).json({
        success: false,
        error: String(error?.message || error),
        duration: `${durationMs.toFixed(2)}ms`,
      })
    } finally {
      if (browser) {
        try {
          await browser.close()
        } catch { }
      }
    }
  })
})

/**
 * GET /health
 * Simple health check endpoint that doesn't require PDF generation
 */
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    service: "pdf-service",
    timestamp: new Date().toISOString(),
  })
})

// * OpenAPI specification endpoint
app.get("/openapi.json", (req, res) => {
  const serverUrl = `${req.protocol}://${req.get("host")}`
  const openapi = {
    openapi: "3.0.3",
    info: {
      title: "Printer PDF Service API",
      description:
        "API for rendering web pages to PDF using Puppeteer. Host access is restricted by the ALLOWED_DOMAINS environment variable (or '*' to allow all). Relative paths require PDF_TARGET_BASE_URL.",
      version: "1.0.0",
    },
    servers: [{ url: serverUrl }],
    paths: {
      "/health": {
        get: {
          summary: "Service health check",
          operationId: "getHealth",
          responses: {
            "200": {
              description: "Service is healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", example: "healthy" },
                      service: { type: "string", example: "pdf-service" },
                      timestamp: { type: "string", format: "date-time" },
                    },
                    required: ["status", "service", "timestamp"],
                  },
                },
              },
            },
          },
        },
      },
      "/pdf": {
        get: {
          summary: "Render a web page to PDF",
          description:
            "Renders the provided URL or relative path to a PDF. Hostname must match ALLOWED_DOMAINS (or '*'). For relative paths, PDF_TARGET_BASE_URL must be set.",
          operationId: "renderPdf",
          parameters: [
            {
              name: "url",
              in: "query",
              required: true,
              description: "Full http(s) URL or a relative path (when combined with PDF_TARGET_BASE_URL)",
              schema: { type: "string", example: "https://example.com/invoice/123" },
            },
            {
              name: "disposition",
              in: "query",
              required: false,
              description: "Content disposition for download vs inline display",
              schema: { type: "string", enum: ["attachment", "inline"], default: "attachment", example: "inline" },
            },
            { name: "timeoutMs", in: "query", required: false, schema: { type: "integer", minimum: 0, default: 30000, example: 45000 }, description: "Navigation and protocol timeout in milliseconds" },
            { name: "format", in: "query", required: false, schema: { type: "string", default: "Letter", example: "A4" }, description: "PDF page format (e.g., A4, Letter)" },
            { name: "orientation", in: "query", required: false, schema: { type: "string", enum: ["portrait", "landscape"], default: "portrait", example: "landscape" }, description: "Page orientation" },
            { name: "scale", in: "query", required: false, schema: { type: "number", minimum: 0.1, maximum: 2, default: 1, example: 0.9 }, description: "Scale factor" },
            { name: "margin", in: "query", required: false, schema: { type: "string", default: "0.5in", example: "0.25in" }, description: "Uniform margin applied to all sides (overridden by per-side margins)" },
            { name: "marginTop", in: "query", required: false, schema: { type: "string", example: "1in" } },
            { name: "marginRight", in: "query", required: false, schema: { type: "string", example: "0.5in" } },
            { name: "marginBottom", in: "query", required: false, schema: { type: "string", example: "1in" } },
            { name: "marginLeft", in: "query", required: false, schema: { type: "string", example: "0.5in" } },
            { name: "printBackground", in: "query", required: false, schema: { type: "boolean", default: true, example: true } },
            { name: "displayHeaderFooter", in: "query", required: false, schema: { type: "boolean", default: false, example: false } },
            { name: "preferCSSPageSize", in: "query", required: false, schema: { type: "boolean", default: false, example: false } },
            { name: "tagged", in: "query", required: false, schema: { type: "boolean", default: true, example: true } },
            { name: "outline", in: "query", required: false, schema: { type: "boolean", default: false, example: false } },
          ],
          responses: {
            "200": {
              description: "Rendered PDF",
              headers: {
                "Content-Type": { schema: { type: "string" }, example: "application/pdf" },
                "Content-Disposition": { schema: { type: "string" }, example: "attachment; filename=render-123.pdf" },
                "X-Render-Duration": { schema: { type: "string" }, example: "523.17ms" },
              },
              content: {
                "application/pdf": {
                  schema: { type: "string", format: "binary" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "403": { $ref: "#/components/responses/Forbidden" },
            "500": { $ref: "#/components/responses/ServerError" },
          },
        },
      },
    },
    components: {
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string" },
            duration: { type: "string", description: "Render duration when available" },
          },
          required: ["success", "error"],
        },
      },
      responses: {
        BadRequest: {
          description: "Bad request",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
        Forbidden: {
          description: "Forbidden host",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
        ServerError: {
          description: "Server error",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
      },
    },
  }

  res.status(200).json(openapi)
})

// * Static docs using Scalar API Reference, pointing to local OpenAPI spec
app.get("/docs", (req, res) => {
  const serverUrl = `${req.protocol}://${req.get("host")}`
  const html = `<!doctype html>
<html>
  <head>
    <title>Scalar API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>
      Scalar.createApiReference('#app', {
        url: '${serverUrl}/openapi.json',
        proxyUrl: 'https://proxy.scalar.com'
      })
    </script>
  </body>
  </html>`
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.status(200).send(html)
})

function shutdown(signal) {
  console.log(`\n🛑 PDF service received ${signal}, shutting down...`)
  server.close(() => {
    console.log("📡 PDF HTTP server closed")
    process.exit(0)
  })
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))

server.listen(port, () => {
  console.log(`📄 PDF service listening on port ${port}`)
})
