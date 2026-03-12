# Build stage - using nightly for edition2024 support
FROM rustlang/rust:nightly-bookworm as builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests
COPY Cargo.toml Cargo.lock* ./

# Create dummy source to cache dependencies
RUN mkdir src && \
    echo "fn main() {}" > src/main.rs && \
    cargo build --release && \
    rm -rf src

# Copy actual source code
COPY src ./src

# Build the release binary
RUN touch src/main.rs && cargo build --release

# Runtime stage
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/target/release/rust-core-service ./rust-core-service

# Create non-root user
RUN useradd -r -s /bin/false appuser && \
    chown -R appuser:appuser /app

USER appuser

# Expose ports (HTTP and gRPC)
EXPOSE 8010 8011

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8010/api/v1/health || exit 1

# Run the binary
CMD ["./rust-core-service"]
