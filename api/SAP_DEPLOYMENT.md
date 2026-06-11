# SAP RFC Deployment Guide for OneBox AI

## Overview

The SAP RFC integration requires the **SAP NW RFC SDK**, which is a native C library. This guide explains how to deploy the Python API with SAP connectivity.

## Deployment Options

### Option 1: Docker on Railway (Recommended for Production)

Railway supports Docker deployments, allowing you to include the SAP SDK in your container.

#### Prerequisites
1. Download the **Linux x86_64** version of SAP NW RFC SDK from SAP Support Portal
   - File: `nwrfc750P_X-70002752.zip` (Linux on x86_64 64bit)
   - Requires SAP S-User credentials

2. Extract and copy the SDK to `api/nwrfcsdk/`:
   ```
   api/
   ├── nwrfcsdk/
   │   ├── lib/
   │   │   ├── libsapnwrfc.so
   │   │   ├── libsapucum.so
   │   │   └── ...
   │   ├── include/
   │   └── ...
   ├── Dockerfile
   ├── main.py
   └── ...
   ```

3. Deploy to Railway:
   ```bash
   railway up
   ```

#### Important Notes
- The SDK files are proprietary and **cannot be committed to Git**
- Add `nwrfcsdk/` to your `.gitignore`
- Use Railway's secrets for SAP credentials

### Option 2: Self-Hosted VM (Full Control)

For maximum flexibility, run the API on your own server.

#### AWS EC2 / Azure VM / DigitalOcean Setup

1. **Create a Linux VM** (Ubuntu 22.04 recommended)

2. **Install SAP NW RFC SDK**:
   ```bash
   # Create directory
   sudo mkdir -p /usr/local/sap/nwrfcsdk
   
   # Copy and extract SDK
   sudo unzip nwrfc750P_X-70002752.zip -d /usr/local/sap/nwrfcsdk
   
   # Set environment variables
   echo 'export SAPNWRFC_HOME=/usr/local/sap/nwrfcsdk' >> ~/.bashrc
   echo 'export LD_LIBRARY_PATH=/usr/local/sap/nwrfcsdk/lib:$LD_LIBRARY_PATH' >> ~/.bashrc
   source ~/.bashrc
   
   # Update library cache
   sudo ldconfig /usr/local/sap/nwrfcsdk/lib
   ```

3. **Install Python and dependencies**:
   ```bash
   sudo apt update
   sudo apt install python3.11 python3.11-venv python3-pip
   
   cd /opt/onebox-api
   python3.11 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

4. **Run with systemd**:
   ```bash
   sudo systemctl start onebox-api
   ```

### Option 3: Hybrid Architecture (Recommended for Existing Setup)

Keep your main app on Railway/Supabase, but run a dedicated **SAP Gateway Microservice** separately.

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Frontend      │────▶│  Railway API     │     │  SAP System │
│   (React)       │     │  (Main Backend)  │     │             │
└─────────────────┘     └────────┬─────────┘     └──────▲──────┘
                                 │                      │
                                 │ HTTP/REST            │ RFC
                                 ▼                      │
                        ┌────────────────────┐          │
                        │  SAP Gateway       │──────────┘
                        │  Microservice      │
                        │  (VM with SDK)     │
                        └────────────────────┘
```

#### Benefits:
- Main app stays serverless/managed
- SAP integration is isolated
- Can scale SAP gateway independently
- Easier to maintain and update

### Option 4: Local Development Only

For testing/development, run the API locally where the SDK is installed.

```powershell
# Windows - Set environment variable
$env:SAPNWRFC_HOME = "C:\SAP\nwrfcsdk"

# Run the API
cd api
python -m uvicorn main:app --reload --port 8000
```

## Environment Variables

Required environment variables for SAP connectivity:

```env
# SAP NW RFC SDK location
SAPNWRFC_HOME=/usr/local/sap/nwrfcsdk  # Linux
SAPNWRFC_HOME=C:\SAP\nwrfcsdk          # Windows

# SAP Connection (can also use database config)
SAP_DEFAULT_USER=STUDENT119
SAP_DEFAULT_ASHOST=172.21.72.22
SAP_DEFAULT_SYSNR=00
SAP_DEFAULT_CLIENT=100
SAP_DEFAULT_SAPROUTER=/H/161.38.17.212
```

## Security Considerations

1. **Never commit SDK files to Git** - They are proprietary SAP software
2. **Store SAP credentials in secrets** - Use Railway secrets or environment variables
3. **Use connection pooling** - Don't create new connections for every request
4. **Implement audit logging** - Track all SAP operations (already implemented in `sap_operation_logs` table)

## Troubleshooting

### pyrfc installation fails
```bash
# Ensure SAPNWRFC_HOME is set before pip install
export SAPNWRFC_HOME=/usr/local/sap/nwrfcsdk
pip install pyrfc
```

### Library not found errors
```bash
# Linux - Update library cache
sudo ldconfig /usr/local/sap/nwrfcsdk/lib

# Check library path
echo $LD_LIBRARY_PATH
```

### Connection timeout
- Check SAP Router string is correct
- Verify firewall allows connection to SAP host
- Test with `startrfc` utility from SDK

## Resources

- [PyRFC Documentation](https://github.com/SAP/PyRFC)
- [SAP NW RFC SDK Download](https://support.sap.com/en/product/connectors/nwrfcsdk.html)
- [Railway Docker Deployment](https://docs.railway.app/deploy/dockerfiles)
