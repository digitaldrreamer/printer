# Based on Puppeteer's official Docker image guidance
# Ref: https://pptr.dev/guides/docker
# The image includes Chrome for Testing + pre-installed Puppeteer

FROM ghcr.io/puppeteer/puppeteer:latest

WORKDIR /app

# Copy package.json and install dependencies reproducibly
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts \
  && npx --yes puppeteer browsers install chrome

# Copy the PDF service
COPY pdf-service.js ./pdf-service.js

ENV NODE_ENV=production
ENV PDF_SERVICE_PORT=3002

EXPOSE 3002

CMD ["node", "pdf-service.js"]


