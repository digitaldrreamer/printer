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

const port = process.env.PDF_SERVICE_PORT || 3002
const app = express()
const server = createServer(app)

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

  let browser
  try {
    // * Use Puppeteer's bundled Chrome for Testing (as per official Docker docs)
    // * The ghcr.io/puppeteer/puppeteer image includes Chrome for Testing pre-installed
    // * We don't need to specify executablePath - Puppeteer will find it automatically
    console.log("PDF Service: Launching Puppeteer with bundled Chrome for Testing")

    browser = await puppeteer.launch({
      headless: "new",
      // * Explicitly use Puppeteer's resolved Chrome path to avoid cache/path issues
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
      timeout: 30000,
      protocolTimeout: 30000,
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
      timeout: 30000,
    })

    // * Small wait to allow any microtasks/animations to settle
    await new Promise((r) => setTimeout(r, 750))

    const margins = { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" }

    const pdfBuffer = await page.pdf({
      format: "Letter",
      orientation: "portrait",
      margin: margins,
      scale: 1,
      displayHeaderFooter: false,
      printBackground: true,
      preferCSSPageSize: false,
      tagged: true,
      outline: false,
      timeout: 30000,
    })

    const durationMs = performance.now() - start
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `attachment; filename="render-${Date.now()}.pdf"`)
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
