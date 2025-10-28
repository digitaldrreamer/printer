import express from "express"
import { createServer } from "node:http"

import { handler } from "../build/handler.js"
// * Import connection initialization functions
import { connectDatabase, disconnectDatabase } from "../src/lib/server/database/prisma.js"
import { initRedis, closeRedis } from "../src/lib/server/queue/redis.js"

const port = process.env.PORT || 3000
const app = express()
const server = createServer(app)

// * Store document worker reference for graceful shutdown
let documentWorker = null

/**
 * Initialize all connections on startup
 */
async function initializeConnections() {
  console.log("🔄 Initializing connections...")

  try {
    // * Initialize database connection with retry logic
    await connectDatabase()
    console.log("✅ Database connected")

    // * Initialize Redis connections
    await initRedis()
    console.log("✅ Redis connections established")

    console.log("🎉 All connections initialized successfully")
  } catch (error) {
    console.error("❌ Failed to initialize connections:", error.message)
    // * Don't exit immediately, let the app start and retry connections
    // * The reconnection strategies will handle ongoing issues
    console.log("⚠️  Server starting with connection issues - will retry automatically")
  }

  // * Start document worker after connections are established
  console.log("🔄 Starting document worker...")
  try {
    const { default: worker } = await import("../src/lib/server/queue/document-worker.js")
    documentWorker = worker
    console.log("✅ Document worker started")
  } catch (error) {
    console.error("❌ Failed to start document worker:", error.message)
  }

  // * Start meeting scheduler worker
  console.log("🔄 Starting meeting scheduler worker...")
  try {
    const { meetingSchedulerWorker } = await import(
      "../src/lib/server/queue/meeting-scheduler-worker.js"
    )
    console.log("✅ Meeting scheduler worker started")
  } catch (error) {
    console.error("❌ Failed to start meeting scheduler worker:", error.message)
  }
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`)

  try {
    // * Close server to stop accepting new connections
    server.close(() => {
      console.log("📡 HTTP server closed")
    })

    // * Close database connection
    await disconnectDatabase()
    console.log("🔌 Database disconnected")

    // * Close Redis connections
    await closeRedis()
    console.log("🔌 Redis connections closed")

    // * Close document worker
    if (documentWorker) {
      await documentWorker.close()
      console.log("🔌 Document worker closed")
    }

    console.log("👋 Graceful shutdown completed")
    process.exit(0)
  } catch (error) {
    console.error("❌ Error during shutdown:", error.message)
    process.exit(1)
  }
}

// * Setup graceful shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
process.on("SIGINT", () => gracefulShutdown("SIGINT"))

// * SvelteKit should handle everything else using Express middleware
// * https://github.com/sveltejs/kit/tree/master/packages/adapter-node#custom-server
app.use(handler)

server.listen(port, async () => {
  console.log(`🚀 Server running on port ${port}`)

  // * Initialize connections after server starts
  await initializeConnections()
})
