# Printer

A lightweight, production-ready microservice for converting web pages to PDFs using Puppeteer. Perfect for generating invoices, reports, documentation, and any web-based content as PDF files.

## Features

- 🚀 **Fast & Efficient**: Single-concurrency queue system for optimal resource usage
- 🔒 **Security First**: Domain whitelisting to prevent unauthorized access
- 🎨 **Highly Configurable**: Extensive PDF formatting options (margins, orientation, scale, etc.)
- 📦 **Docker Ready**: Pre-configured Docker image with Chrome for Testing
- 📚 **API Documentation**: Built-in OpenAPI specification and interactive docs
- 🏥 **Health Monitoring**: Health check endpoint for service monitoring
- ⚡ **Production Ready**: Graceful shutdown, error handling, and performance tracking

## Quick Start

### Using Docker (Recommended)

```bash
docker build -t printer-pdf-service .
docker run -p 3002:3002 \
  -e ALLOWED_DOMAINS="example.com,myapp.com" \
  -e PDF_TARGET_BASE_URL="https://myapp.com" \
  printer-pdf-service
```

### Using Node.js

```bash
# Install dependencies
npm install

# Set environment variables
export ALLOWED_DOMAINS="example.com,myapp.com"
export PDF_TARGET_BASE_URL="https://myapp.com"

# Start the service
npm start

# Or run in development mode
npm run dev
```

## Configuration

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `ALLOWED_DOMAINS` | Yes* | Comma-separated list of allowed domains (or `*` for all) | `example.com,myapp.com` |
| `PDF_TARGET_BASE_URL` | Yes** | Base URL for relative path requests | `https://myapp.com` |
| `PDF_SERVICE_PORT` | No | Port to run the service on | `3002` (default) |

\* Required unless set to `*` to allow all domains  
\*\* Required when using relative paths in the `url` parameter

### Security Configuration

The service validates that all requested URLs belong to domains listed in `ALLOWED_DOMAINS` or their subdomains. For example:

- `ALLOWED_DOMAINS=example.com` allows:
  - ✅ `https://example.com/page`
  - ✅ `https://app.example.com/page`
  - ❌ `https://other.com/page`

Set `ALLOWED_DOMAINS=*` to allow all domains (use with caution in production).

## API Usage

### Render a Web Page to PDF

```bash
GET /pdf?url=<URL>
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | - | Full http(s) URL or relative path |
| `disposition` | string | No | `attachment` | `attachment` or `inline` |
| `timeoutMs` | integer | No | `30000` | Timeout in milliseconds |
| `format` | string | No | `Letter` | Page format (e.g., `A4`, `Letter`) |
| `orientation` | string | No | `portrait` | `portrait` or `landscape` |
| `scale` | number | No | `1` | Scale factor (0.1-2) |
| `margin` | string | No | `0.5in` | Uniform margin for all sides |
| `marginTop` | string | No | - | Top margin (overrides `margin`) |
| `marginRight` | string | No | - | Right margin (overrides `margin`) |
| `marginBottom` | string | No | - | Bottom margin (overrides `margin`) |
| `marginLeft` | string | No | - | Left margin (overrides `margin`) |
| `printBackground` | boolean | No | `true` | Print background graphics |
| `displayHeaderFooter` | boolean | No | `false` | Display header and footer |
| `preferCSSPageSize` | boolean | No | `false` | Prefer CSS page size |
| `tagged` | boolean | No | `true` | Generate tagged PDF (accessibility) |
| `outline` | boolean | No | `false` | Generate PDF outline/bookmarks |

### Examples

#### Basic Usage

```bash
# Render a full URL
curl "http://localhost:3002/pdf?url=https://example.com/invoice/123" \
  --output invoice.pdf

# Render a relative path (requires PDF_TARGET_BASE_URL)
curl "http://localhost:3002/pdf?url=/invoice/123" \
  --output invoice.pdf
```

#### Advanced Formatting

```bash
# A4 format, landscape, custom margins
curl "http://localhost:3002/pdf?url=https://example.com/report&format=A4&orientation=landscape&marginTop=1in&marginBottom=1in" \
  --output report.pdf

# Inline display with custom scale
curl "http://localhost:3002/pdf?url=https://example.com/page&disposition=inline&scale=0.9" \
  --output page.pdf
```

#### Using Relative Paths

```bash
# Set base URL
export PDF_TARGET_BASE_URL="https://myapp.com"

# Use relative paths
curl "http://localhost:3002/pdf?url=/dashboard/report/123" \
  --output report.pdf
```

### Health Check

```bash
GET /health
```

Returns service health status:

```json
{
  "status": "healthy",
  "service": "pdf-service",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

### API Documentation

Interactive API documentation is available at:

- **Web UI**: `http://localhost:3002/docs`
- **OpenAPI Spec**: `http://localhost:3002/openapi.json`

## Response Headers

The service includes useful headers in PDF responses:

- `Content-Type`: `application/pdf`
- `Content-Disposition`: Download or inline disposition
- `Content-Length`: PDF file size in bytes
- `X-Render-Duration`: Rendering time in milliseconds

## Error Responses

All errors return JSON with the following structure:

```json
{
  "success": false,
  "error": "Error message description",
  "duration": "123.45ms"
}
```

### Common Error Codes

- `400 Bad Request`: Missing or invalid parameters
- `403 Forbidden`: URL host not in allowed domains
- `500 Internal Server Error`: Rendering failure

## Architecture

### Queue System

The service uses an in-memory, single-concurrency queue to serialize PDF rendering operations. This ensures:

- Optimal resource usage (one browser instance at a time)
- Predictable memory consumption
- Fair request handling

### Resource Optimization

The service automatically:

- Blocks images, media, and fonts during rendering (configurable)
- Uses headless Chrome for Testing
- Implements request timeouts
- Cleans up browser instances after each render

## Docker Deployment

### Build Image

```bash
docker build -t printer-pdf-service .
```

### Run Container

```bash
docker run -d \
  --name pdf-service \
  -p 3002:3002 \
  -e ALLOWED_DOMAINS="example.com,myapp.com" \
  -e PDF_TARGET_BASE_URL="https://myapp.com" \
  printer-pdf-service
```

### Docker Compose

```yaml
version: '3.8'

services:
  pdf-service:
    build: .
    ports:
      - "3002:3002"
    environment:
      - ALLOWED_DOMAINS=example.com,myapp.com
      - PDF_TARGET_BASE_URL=https://myapp.com
    restart: unless-stopped
```

## Requirements

- **Node.js**: >= 18.17
- **Dependencies**: Express 5.x, Puppeteer 24.x
- **System**: Linux, macOS, or Windows (Docker recommended)

## Performance Considerations

- **Concurrency**: The service processes one PDF at a time to optimize memory usage
- **Timeouts**: Default timeout is 30 seconds; adjust based on your page complexity
- **Resource Blocking**: Images/media/fonts are blocked by default to speed up rendering
- **Browser Reuse**: Each request spawns a new browser instance for isolation

## Security Best Practices

1. **Domain Whitelisting**: Always configure `ALLOWED_DOMAINS` in production
2. **Network Isolation**: Run the service in a private network when possible
3. **Rate Limiting**: Implement rate limiting at the reverse proxy level
4. **Input Validation**: The service validates URLs, but consider additional validation
5. **Resource Limits**: Set appropriate Docker/container resource limits

## Troubleshooting

### Service Won't Start

- Check that `ALLOWED_DOMAINS` is set (or set to `*`)
- Verify port `3002` (or `PDF_SERVICE_PORT`) is available
- Check Docker logs: `docker logs pdf-service`

### PDF Rendering Fails

- Verify the target URL is accessible from the service
- Check that the domain is in `ALLOWED_DOMAINS`
- Increase `timeoutMs` for slow-loading pages
- Review service logs for detailed error messages

### High Memory Usage

- This is expected; Puppeteer uses significant memory
- Consider horizontal scaling with a load balancer
- Monitor container memory limits

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is open source and available under the [MIT License](LICENSE).

## Support

For issues, questions, or contributions, please open an issue on the GitHub repository.

---

**Happy Hacking!**
