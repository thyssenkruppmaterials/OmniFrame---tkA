/**
 * Badge Generation Utility
 * Creates printable ID badges with QR codes and employee information
 */

// Note: This is a client-side implementation that generates HTML/CSS badges
// For full PDF generation with QR codes, you would typically use a server-side
// library like jsPDF or a dedicated badge printing service.

export interface BadgeData {
  employeeName: string
  position: string
  department?: string
  badgeNumber: string
  email: string
  startDate: string
  photoUrl?: string
  emergencyContact?: string
  emergencyPhone?: string
  organizationName?: string
  organizationLogo?: string
}

export interface CredentialsData {
  employeeName: string
  email: string
  password: string
  badgeNumber: string
  loginUrl: string
  position: string
  startDate: string
}

/**
 * Generate a printable badge HTML
 */
export function generateBadgeHTML(data: BadgeData): string {
  const initials = data.employeeName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Employee Badge - ${data.employeeName}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Arial', sans-serif;
      background: #f0f0f0;
      padding: 20px;
    }
    .badge-container {
      display: flex;
      justify-content: center;
      gap: 40px;
    }
    .badge {
      width: 3.375in;
      height: 2.125in;
      background: linear-gradient(135deg, #1e3a5f 0%, #0d1b2a 100%);
      border-radius: 12px;
      padding: 16px;
      color: white;
      position: relative;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .badge::before {
      content: '';
      position: absolute;
      top: -50%;
      right: -50%;
      width: 100%;
      height: 100%;
      background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
      pointer-events: none;
    }
    .badge-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    .company-name {
      font-size: 14px;
      font-weight: bold;
      color: #64b5f6;
    }
    .badge-number {
      font-size: 11px;
      background: rgba(255,255,255,0.15);
      padding: 4px 8px;
      border-radius: 4px;
    }
    .badge-body {
      display: flex;
      gap: 14px;
      align-items: center;
    }
    .photo-area {
      width: 60px;
      height: 60px;
      background: rgba(255,255,255,0.9);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .photo-area img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .initials {
      font-size: 22px;
      font-weight: bold;
      color: #1e3a5f;
    }
    .info {
      flex: 1;
    }
    .employee-name {
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 4px;
    }
    .position {
      font-size: 11px;
      color: #90caf9;
      margin-bottom: 2px;
    }
    .department {
      font-size: 10px;
      color: #64b5f6;
      opacity: 0.8;
    }
    .badge-footer {
      position: absolute;
      bottom: 12px;
      left: 16px;
      right: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .start-date {
      font-size: 9px;
      color: rgba(255,255,255,0.6);
    }
    .qr-placeholder {
      width: 40px;
      height: 40px;
      background: white;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 7px;
      color: #333;
      text-align: center;
    }
    
    /* Back of badge */
    .badge-back {
      width: 3.375in;
      height: 2.125in;
      background: linear-gradient(135deg, #fff 0%, #f5f5f5 100%);
      border-radius: 12px;
      padding: 16px;
      color: #333;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    .badge-back h3 {
      font-size: 12px;
      margin-bottom: 10px;
      color: #1e3a5f;
    }
    .emergency-info {
      font-size: 10px;
      margin-bottom: 8px;
    }
    .emergency-info strong {
      display: block;
      color: #c62828;
      margin-bottom: 2px;
    }
    .badge-back .instructions {
      font-size: 9px;
      color: #666;
      margin-top: 12px;
      padding-top: 8px;
      border-top: 1px solid #ddd;
    }
    
    @media print {
      body { background: white; padding: 0; }
      .badge-container { page-break-inside: avoid; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="badge-container">
    <!-- Front of Badge -->
    <div class="badge">
      <div class="badge-header">
        <div class="company-name">${data.organizationName || 'OmniFrame'}</div>
        <div class="badge-number">${data.badgeNumber}</div>
      </div>
      <div class="badge-body">
        <div class="photo-area">
          ${
            data.photoUrl
              ? `<img src="${data.photoUrl}" alt="Photo">`
              : `<span class="initials">${initials}</span>`
          }
        </div>
        <div class="info">
          <div class="employee-name">${data.employeeName}</div>
          <div class="position">${data.position}</div>
          ${data.department ? `<div class="department">${data.department}</div>` : ''}
        </div>
      </div>
      <div class="badge-footer">
        <div class="start-date">Since: ${new Date(data.startDate).toLocaleDateString()}</div>
        <div class="qr-placeholder">QR<br>Code</div>
      </div>
    </div>

    <!-- Back of Badge -->
    <div class="badge-back">
      <h3>Emergency Contact</h3>
      <div class="emergency-info">
        <strong>Contact:</strong>
        ${data.emergencyContact || 'Not provided'}
        ${data.emergencyPhone ? `<br>${data.emergencyPhone}` : ''}
      </div>
      <div class="emergency-info">
        <strong>Employee Email:</strong>
        ${data.email}
      </div>
      <div class="instructions">
        This badge is the property of ${data.organizationName || 'the company'}.<br>
        If found, please return to the reception desk.<br>
        Report lost badges immediately.
      </div>
    </div>
  </div>
  
  <div class="no-print" style="text-align: center; margin-top: 30px;">
    <button onclick="window.print()" style="
      padding: 12px 24px;
      font-size: 16px;
      background: #1e3a5f;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
    ">Print Badge</button>
  </div>
</body>
</html>
  `.trim()
}

/**
 * Generate printable credentials sheet HTML
 */
export function generateCredentialsHTML(data: CredentialsData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Login Credentials - ${data.employeeName}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Arial', sans-serif;
      background: #f5f5f5;
      padding: 40px;
    }
    .credentials-sheet {
      max-width: 6in;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 2px solid #1e3a5f;
    }
    .header h1 {
      font-size: 24px;
      color: #1e3a5f;
      margin-bottom: 8px;
    }
    .header p {
      font-size: 14px;
      color: #666;
    }
    .employee-info {
      background: #f8f9fa;
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 24px;
    }
    .employee-info h2 {
      font-size: 20px;
      color: #333;
      margin-bottom: 8px;
    }
    .employee-info p {
      font-size: 14px;
      color: #666;
    }
    .credentials {
      margin-bottom: 24px;
    }
    .credential-row {
      display: flex;
      align-items: center;
      padding: 16px;
      border: 1px solid #ddd;
      border-radius: 8px;
      margin-bottom: 12px;
    }
    .credential-label {
      width: 140px;
      font-size: 13px;
      font-weight: bold;
      color: #666;
      text-transform: uppercase;
    }
    .credential-value {
      flex: 1;
      font-size: 16px;
      font-family: 'Courier New', monospace;
      color: #333;
    }
    .warning {
      background: #fff3e0;
      border: 1px solid #ff9800;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .warning h3 {
      font-size: 14px;
      color: #e65100;
      margin-bottom: 8px;
    }
    .warning p {
      font-size: 12px;
      color: #bf360c;
    }
    .instructions {
      font-size: 12px;
      color: #666;
      padding-top: 24px;
      border-top: 1px solid #eee;
    }
    .instructions h4 {
      color: #333;
      margin-bottom: 12px;
    }
    .instructions ol {
      margin-left: 20px;
    }
    .instructions li {
      margin-bottom: 8px;
    }
    .footer {
      margin-top: 24px;
      text-align: center;
      font-size: 10px;
      color: #999;
    }
    
    @media print {
      body { background: white; padding: 0; }
      .credentials-sheet { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="credentials-sheet">
    <div class="header">
      <h1>🔐 Login Credentials</h1>
      <p>Confidential - Handle with Care</p>
    </div>
    
    <div class="employee-info">
      <h2>${data.employeeName}</h2>
      <p>${data.position} • Badge: ${data.badgeNumber}</p>
      <p>Start Date: ${new Date(data.startDate).toLocaleDateString()}</p>
    </div>
    
    <div class="credentials">
      <div class="credential-row">
        <span class="credential-label">Email:</span>
        <span class="credential-value">${data.email}</span>
      </div>
      <div class="credential-row">
        <span class="credential-label">Password:</span>
        <span class="credential-value">${data.password}</span>
      </div>
      <div class="credential-row">
        <span class="credential-label">Login URL:</span>
        <span class="credential-value">${data.loginUrl}</span>
      </div>
    </div>
    
    <div class="warning">
      <h3>⚠️ Security Notice</h3>
      <p>
        This is a temporary password. You MUST change it immediately after your first login.
        Do not share these credentials with anyone. Destroy this document after memorizing your password.
      </p>
    </div>
    
    <div class="instructions">
      <h4>Getting Started</h4>
      <ol>
        <li>Visit the login URL shown above</li>
        <li>Enter your email and temporary password</li>
        <li>You will be prompted to create a new password</li>
        <li>Complete your profile setup</li>
        <li>Contact IT support if you have any issues</li>
      </ol>
    </div>
    
    <div class="footer">
      Generated: ${new Date().toLocaleString()}<br>
      This document is confidential and should be handled securely.
    </div>
  </div>
</body>
</html>
  `.trim()
}

/**
 * Open badge in new window for printing
 */
export function printBadge(data: BadgeData): void {
  const html = generateBadgeHTML(data)
  const printWindow = window.open('', '_blank')
  if (printWindow) {
    printWindow.document.write(html)
    printWindow.document.close()
  }
}

/**
 * Open credentials sheet in new window for printing
 */
export function printCredentials(data: CredentialsData): void {
  const html = generateCredentialsHTML(data)
  const printWindow = window.open('', '_blank')
  if (printWindow) {
    printWindow.document.write(html)
    printWindow.document.close()
  }
}

/**
 * Download badge as HTML file
 */
export function downloadBadge(data: BadgeData): void {
  const html = generateBadgeHTML(data)
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `badge-${data.badgeNumber}.html`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Download credentials as HTML file
 */
export function downloadCredentials(data: CredentialsData): void {
  const html = generateCredentialsHTML(data)
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `credentials-${data.badgeNumber}.html`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default {
  generateBadgeHTML,
  generateCredentialsHTML,
  printBadge,
  printCredentials,
  downloadBadge,
  downloadCredentials,
}
