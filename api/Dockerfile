# SAP RFC-enabled Python API for OneBox AI
# This Dockerfile includes the SAP NW RFC SDK for pyrfc connectivity

FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    make \
    wget \
    unzip \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Set SAP NW RFC SDK environment variables
# NOTE: You must provide the SDK files in the 'nwrfcsdk' folder
ENV SAPNWRFC_HOME=/usr/local/sap/nwrfcsdk
ENV LD_LIBRARY_PATH=/usr/local/sap/nwrfcsdk/lib:$LD_LIBRARY_PATH

# Create SAP SDK directory
RUN mkdir -p /usr/local/sap/nwrfcsdk

# Copy SAP NW RFC SDK (Linux version required!)
# You need to download the Linux x86_64 version from SAP
# and place it in api/nwrfcsdk/ before building
COPY nwrfcsdk/ /usr/local/sap/nwrfcsdk/

# Make SDK libraries accessible
RUN ldconfig /usr/local/sap/nwrfcsdk/lib || true

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
