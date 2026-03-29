FROM node:20-slim

# sharp prebuilt binaries require libvips on Debian ARM64
# python3 + make + g++ needed for bcrypt and other native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
        git python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy source (pre-cloned from https://codeberg.org/ladigitale/digistorm)
# Codeberg blocks git clone from Docker build context
COPY src/ .

# Install all dependencies (including devDependencies needed for build)
RUN npm install

# Build Vike/Vite SSR bundle
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

EXPOSE 3000

CMD ["node", "./server"]
