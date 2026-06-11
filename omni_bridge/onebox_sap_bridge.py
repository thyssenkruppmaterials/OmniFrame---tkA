# Created and developed by Jai Singh
"""
OmniFrame SAP Bridge — Self-contained Python GUI application.

Renders the OmniFrame web app in a Chromium browser (WebView2 via pywebview)
with a SAP control bar injected at the bottom.

Capabilities:
    - Auto-detects "Complete Final Packing" and executes VL02N Post Goods Issue
    - Detects Putaway Log Search page and batch-confirms pending Transfer Orders
      via SAP LT12 transaction

Build to .exe:
    pip install -r requirements.txt
    pyinstaller --onefile --windowed --name OmniFrame_SAP_Bridge onebox_sap_bridge.py

Requirements:
    - Windows 10 21H2+ or Windows 11 (WebView2 Runtime built-in)
    - SAP GUI with Scripting enabled
"""

import json
import os
import sys
import time
import threading
import traceback
from datetime import datetime

import requests
import webview

APP_URL = "https://onebox-ai-logistics-production.up.railway.app/apps/outbound?tab=final-pack-tool"
CONFIG_FILE = os.path.join(os.getenv("APPDATA", ""), "OneBoxSAPBridge.json")

# ---------------------------------------------------------------------------
#  SAP COM (lazy import -- only on Windows with pywin32)
# ---------------------------------------------------------------------------
def _init_com():
    """Initialize COM for the current thread and return the win32com module."""
    import pythoncom
    pythoncom.CoInitialize()
    import win32com.client
    return win32com.client


_sap_conn_idx = 0
_sap_sess_idx = 0


def _get_sap_session():
    """Attach to the running SAP GUI and return (session, connection)."""
    w32 = _init_com()
    sap_gui = w32.GetObject("SAPGUI")
    app = sap_gui.GetScriptingEngine
    conn = app.Children(_sap_conn_idx)
    sess = conn.Children(_sap_sess_idx)
    return sess, conn


def _wait_for_session(sess, timeout_sec=15):
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            if not sess.Busy:
                sess.findById("wnd[0]")
                return
        except Exception:
            pass
        time.sleep(0.5)


# ---------------------------------------------------------------------------
#  JAVASCRIPT / CSS INJECTION
#  Injects a fixed bottom bar into the web app page and sets up the
#  mutation observer for auto-PGI detection.
# ---------------------------------------------------------------------------
INJECTION_JS = r"""
(function() {
    if (window.__oneboxBarInjected) return;
    window.__oneboxBarInjected = true;

    /* ── Inject CSS ── */
    var style = document.createElement('style');
    style.textContent = `
        /* layout height overrides injected dynamically by obxUpdateLayoutHeight */
        #obx-sap-bar {
            position: fixed; bottom: 0; left: 0; right: 0; z-index: 99999;
            background: #0c0c0f; border-top: 1px solid #27272a;
            font-family: 'Segoe UI', system-ui, sans-serif;
            display: flex; flex-direction: column;
            user-select: none;
        }
        #obx-sap-bar * { box-sizing: border-box; }
        #obx-resize-handle {
            height: 5px; cursor: ns-resize; background: transparent;
            flex-shrink: 0; transition: background 0.15s;
        }
        #obx-resize-handle:hover { background: #10b981; }
        #obx-ctrl-row {
            display: flex; align-items: center; gap: 8px;
            padding: 6px 12px; height: 40px; flex-shrink: 0;
            border-bottom: 1px solid #1a1a1e;
        }
        #obx-log-area {
            flex: 1; overflow-y: auto; padding: 4px 12px;
            font-family: Consolas, monospace; font-size: 11px;
            color: #71717a; line-height: 1.5;
        }
        .obx-typing-cursor {
            display: inline-block; width: 6px; height: 12px;
            background: #10b981; margin-left: 2px;
            animation: obxBlink 0.6s step-end infinite;
            vertical-align: text-bottom;
        }
        @keyframes obxBlink { 50% { opacity: 0; } }
        .obx-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        .obx-dot-red { background: #f87171; }
        .obx-dot-green { background: #10b981; }
        .obx-label { font-size: 11px; color: #71717a; white-space: nowrap; }
        .obx-label-green { color: #10b981; }
        .obx-sep { width: 1px; height: 20px; background: #27272a; flex-shrink: 0; }
        .obx-input {
            background: #18181b; border: 1px solid #27272a; border-radius: 4px;
            color: #e4e4e7; font-family: Consolas, monospace; font-size: 12px;
            padding: 4px 8px; width: 140px; outline: none;
        }
        .obx-input:focus { border-color: #10b981; }
        .obx-btn {
            border: 1px solid #27272a; border-radius: 4px; padding: 4px 12px;
            font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap;
            font-family: 'Segoe UI', system-ui, sans-serif;
        }
        .obx-btn-green {
            background: #10b981; border-color: #10b981; color: #fff;
        }
        .obx-btn-green:hover { background: #059669; }
        .obx-btn-green:disabled { background: #27272a; border-color: #27272a; color: #52525b; cursor: default; }
        .obx-btn-outline {
            background: transparent; border-color: #27272a; color: #a1a1aa;
        }
        .obx-btn-outline:hover { border-color: #10b981; color: #10b981; }
        .obx-btn-dark {
            background: #065f46; border-color: #10b981; color: #10b981;
        }
        .obx-btn-dark:hover { background: #047857; }
        .obx-status { font-size: 11px; color: #71717a; white-space: nowrap;
                       overflow: hidden; text-overflow: ellipsis; max-width: 400px; }
        .obx-log-time { color: #3f3f46; }
        .obx-log-ok { color: #34d399; }
        .obx-log-err { color: #f87171; }
        .obx-log-warn { color: #fbbf24; }
        .obx-log-info { color: #60a5fa; }
        .obx-log-sap { color: #c084fc; }
        .obx-log-dim { color: #52525b; }
    `;
    document.head.appendChild(style);

    /* ── Restore saved zoom, bar height, console font size ── */
    var savedZoom = localStorage.getItem('obx-zoom') || '100';
    document.body.style.zoom = savedZoom + '%';
    var barHeight = parseInt(localStorage.getItem('obx-bar-height') || '140', 10);
    var conFontSize = parseInt(localStorage.getItem('obx-font-size') || '11', 10);

    /* ── Build the bar ── */
    var bar = document.createElement('div');
    bar.id = 'obx-sap-bar';
    bar.style.height = barHeight + 'px';
    bar.innerHTML = `
        <div id="obx-resize-handle"></div>
        <div id="obx-ctrl-row">
            <span class="obx-dot obx-dot-red" id="obx-sap-dot"></span>
            <span class="obx-label" id="obx-sap-label">SAP Disconnected</span>
            <button class="obx-btn obx-btn-dark" id="obx-btn-sap" onclick="obxToggleSAP()">Connect SAP</button>
            <span class="obx-sep"></span>
            <span id="obx-shipment-controls" style="display:flex;align-items:center;gap:8px;">
                <button class="obx-btn obx-btn-green" id="obx-btn-shipment" onclick="obxShowShipmentForm()">Process Shipment</button>
            </span>
            <span id="obx-to-controls" style="display:none;align-items:center;gap:8px;">
                <span class="obx-label" id="obx-to-count">0 TOs pending</span>
                <button class="obx-btn obx-btn-green" id="obx-btn-confirm-tos" onclick="obxConfirmAllTOs()">Confirm All TOs</button>
                <button class="obx-btn obx-btn-outline" id="obx-btn-stop-tos" onclick="obxStopConfirm()" style="display:none;">Stop</button>
            </span>
            <span class="obx-sep"></span>
            <button class="obx-btn obx-btn-outline" onclick="obxShowSettings()">Settings</button>
            <span class="obx-status" id="obx-status"></span>
        </div>
        <div id="obx-log-area"></div>
    `;
    document.body.appendChild(bar);

    /* ── Apply saved console font size ── */
    document.getElementById('obx-log-area').style.fontSize = conFontSize + 'px';

    /* ── Resize handle drag ── */
    (function() {
        var handle = document.getElementById('obx-resize-handle');
        var dragging = false;
        handle.addEventListener('mousedown', function(e) {
            dragging = true; e.preventDefault();
        });
        document.addEventListener('mousemove', function(e) {
            if (!dragging) return;
            var h = Math.max(60, Math.min(400, window.innerHeight - e.clientY));
            bar.style.height = h + 'px';
            obxUpdateLayoutHeight(h);
        });
        document.addEventListener('mouseup', function() {
            if (!dragging) return;
            dragging = false;
            var h = parseInt(bar.style.height, 10);
            localStorage.setItem('obx-bar-height', h);
        });
    })();

    window.obxUpdateLayoutHeight = function(h) {
        var rules = document.getElementById('obx-layout-override');
        if (!rules) {
            rules = document.createElement('style');
            rules.id = 'obx-layout-override';
            document.head.appendChild(rules);
        }
        rules.textContent = '#content,.h-svh,.h-screen,.h-dvh,[class*="h-svh"],[class*="h-screen"],[class*="h-dvh"]{height:calc(100svh - '+h+'px)!important;max-height:calc(100svh - '+h+'px)!important;}';
    };
    obxUpdateLayoutHeight(barHeight);

    /* ── Logging with typewriter effect ── */
    window._obxLogQueue = [];
    window._obxLogTyping = false;

    window.obxLog = function(level, msg) {
        window._obxLogQueue.push({ level: level, msg: msg });
        if (!window._obxLogTyping) obxProcessLogQueue();
    };

    window.obxProcessLogQueue = async function() {
        if (window._obxLogTyping || window._obxLogQueue.length === 0) return;
        window._obxLogTyping = true;
        while (window._obxLogQueue.length > 0) {
            var entry = window._obxLogQueue.shift();
            await obxTypeLogEntry(entry.level, entry.msg);
        }
        window._obxLogTyping = false;
    };

    window.obxTypeLogEntry = function(level, msg) {
        return new Promise(function(resolve) {
            var area = document.getElementById('obx-log-area');
            if (!area) { resolve(); return; }
            var ts = new Date().toTimeString().slice(0, 8);
            var cls = 'obx-log-dim';
            if (level === 'OK') cls = 'obx-log-ok';
            else if (level === 'ERR') cls = 'obx-log-err';
            else if (level === 'WARN') cls = 'obx-log-warn';
            else if (level === 'INFO') cls = 'obx-log-info';
            else if (level === 'SAP') cls = 'obx-log-sap';

            var line = document.createElement('div');
            var timeSpan = document.createElement('span');
            timeSpan.className = 'obx-log-time';
            timeSpan.textContent = '[' + ts + '] ';
            var textSpan = document.createElement('span');
            textSpan.className = cls;
            var cursor = document.createElement('span');
            cursor.className = 'obx-typing-cursor';
            line.appendChild(timeSpan);
            line.appendChild(textSpan);
            line.appendChild(cursor);
            area.appendChild(line);
            area.scrollTop = area.scrollHeight;

            var idx = 0;
            var speed = Math.max(6, Math.min(18, 800 / (msg.length || 1)));
            var timer = setInterval(function() {
                if (idx < msg.length) {
                    var chunk = msg.substring(idx, Math.min(idx + 3, msg.length));
                    textSpan.textContent += chunk;
                    idx += 3;
                    area.scrollTop = area.scrollHeight;
                } else {
                    clearInterval(timer);
                    cursor.remove();
                    resolve();
                }
            }, speed);
        });
    };

    obxLog('DIM', 'OmniFrame SAP Bridge v2.0 — bar loaded.');
    obxLog('DIM', 'Connect SAP to enable PGI and TO confirmation. Settings for Supabase config.');

    /* ── SAP Connection ── */
    window._obxSapConnected = false;

    window.obxToggleSAP = async function() {
        var dot = document.getElementById('obx-sap-dot');
        var label = document.getElementById('obx-sap-label');
        var btn = document.getElementById('obx-btn-sap');

        if (window._obxSapConnected) {
            await window.pywebview.api.disconnect_sap();
            window._obxSapConnected = false;
            dot.className = 'obx-dot obx-dot-red';
            label.textContent = 'SAP Disconnected';
            label.className = 'obx-label';
            btn.textContent = 'Connect SAP';
            btn.className = 'obx-btn obx-btn-dark';
            obxLog('DIM', 'SAP disconnected.');
        } else {
            obxLog('INFO', 'Connecting to SAP GUI...');
            var result = await window.pywebview.api.connect_sap();
            if (result.startsWith('OK:')) {
                window._obxSapConnected = true;
                dot.className = 'obx-dot obx-dot-green';
                label.textContent = 'SAP Connected';
                label.className = 'obx-label obx-label-green';
                btn.textContent = 'Disconnect';
                btn.className = 'obx-btn obx-btn-outline';
                obxLog('OK', result.substring(3));
            } else {
                obxLog('ERR', result);
            }
        }
    };

    /* ── Process Shipment Form ── */
    window.obxShowShipmentForm = function() {
        if (!window._obxSapConnected) { obxLog('ERR', 'SAP not connected. Connect SAP first.'); return; }
        var existing = document.getElementById('obx-shipment-overlay');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = 'obx-shipment-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#121214;border:1px solid #27272a;border-radius:8px;padding:24px;width:480px;color:#e4e4e7;font-family:Segoe UI,sans-serif;max-height:90vh;overflow-y:auto;">
                <div style="font-size:15px;font-weight:600;margin-bottom:16px;">Process Shipment</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div>
                        <label style="font-size:11px;color:#71717a;">Delivery # *</label>
                        <input id="obx-ship-delivery" class="obx-input" style="width:100%;margin-top:4px;" placeholder="65506777">
                    </div>
                    <div>
                        <label style="font-size:11px;color:#71717a;">Item #</label>
                        <input id="obx-ship-item" class="obx-input" style="width:100%;margin-top:4px;" value="0010">
                    </div>
                    <div>
                        <label style="font-size:11px;color:#71717a;">TO Number *</label>
                        <input id="obx-ship-to" class="obx-input" style="width:100%;margin-top:4px;" placeholder="3672506">
                    </div>
                    <div>
                        <label style="font-size:11px;color:#71717a;">Warehouse *</label>
                        <input id="obx-ship-wh" class="obx-input" style="width:100%;margin-top:4px;" placeholder="PDC">
                    </div>
                </div>
                <div style="margin-top:10px;">
                    <label style="font-size:11px;color:#71717a;">Tracking # *</label>
                    <input id="obx-ship-tracking" class="obx-input" style="width:100%;margin-top:4px;" value="Tracking" placeholder="Tracking number">
                </div>
                <div style="margin-top:10px;">
                    <label style="font-size:11px;color:#71717a;">Serial Numbers (one per line, optional)</label>
                    <textarea id="obx-ship-serials" class="obx-input" style="width:100%;height:80px;margin-top:4px;resize:vertical;font-size:11px;" placeholder="JJ2220&#10;JJ2230&#10;JJ2208"></textarea>
                </div>
                <div style="display:flex;gap:8px;margin-top:14px;">
                    <button class="obx-btn obx-btn-green" id="obx-ship-submit">Run Shipment Process</button>
                    <button class="obx-btn obx-btn-outline" id="obx-ship-cancel">Cancel</button>
                    <span id="obx-ship-status" style="font-size:11px;color:#71717a;line-height:28px;margin-left:8px;"></span>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('obx-ship-cancel').onclick = function() { overlay.remove(); };
        document.getElementById('obx-ship-submit').onclick = async function() {
            var delivery = document.getElementById('obx-ship-delivery').value.trim();
            var item = document.getElementById('obx-ship-item').value.trim() || '0010';
            var toNum = document.getElementById('obx-ship-to').value.trim();
            var wh = document.getElementById('obx-ship-wh').value.trim();
            var tracking = document.getElementById('obx-ship-tracking').value.trim();
            var serialsRaw = document.getElementById('obx-ship-serials').value.trim();
            var serials = serialsRaw ? serialsRaw.split(/[\n,]+/).map(function(s) { return s.trim(); }).filter(Boolean) : [];

            var st = document.getElementById('obx-ship-status');
            if (!delivery || !toNum || !wh || !tracking) {
                st.textContent = 'Fill all required fields.'; st.style.color = '#f87171';
                return;
            }

            var submitBtn = document.getElementById('obx-ship-submit');
            submitBtn.disabled = true; submitBtn.textContent = 'Processing...';
            st.textContent = ''; st.style.color = '#60a5fa';
            overlay.remove();

            var status = document.getElementById('obx-status');
            var stepNames = ['', 'ZV26 Serials', 'VL02N Pack BOX', 'LT12 Confirm TO', 'VT01N Shipment', 'VL02N CASE+Output', 'VL02N PGI'];

            obxLog('SAP', 'Starting full shipment process for delivery ' + delivery + '...');
            status.textContent = 'Processing shipment ' + delivery + '...';
            status.style.color = '#60a5fa';

            var result = await window.pywebview.api.process_shipment({
                delivery: delivery, item: item, serials: serials,
                to_number: toNum, warehouse: wh, tracking: tracking
            });

            if (result.results) {
                result.results.forEach(function(r) {
                    if (r.status === 'ok') obxLog('OK', 'Step ' + r.step + ' ' + r.name + ': ' + (r.msg || 'Done'));
                    else if (r.status === 'skipped') obxLog('DIM', 'Step ' + r.step + ' ' + r.name + ': Skipped');
                    else obxLog('ERR', 'Step ' + r.step + ' ' + r.name + ': ' + (r.msg || 'Failed'));
                });
            }

            if (result.ok) {
                obxLog('OK', 'Shipment process complete for delivery ' + delivery);
                status.textContent = 'Shipment ' + delivery + ' — Complete';
                status.style.color = '#10b981';
            } else {
                obxLog('ERR', 'Shipment failed at step ' + result.failed_step + ' (' + (stepNames[result.failed_step] || '?') + '): ' + result.error);
                status.textContent = 'Shipment ' + delivery + ' — Failed at step ' + result.failed_step;
                status.style.color = '#f87171';
            }
        };
    };

    /* ── Settings dialog (in-page modal) ── */
    window.obxShowSettings = async function() {
        var cfg = await window.pywebview.api.get_config();
        var sapSessions = await window.pywebview.api.list_sap_sessions();
        var curZoom = parseInt(localStorage.getItem('obx-zoom') || '100', 10);
        var curFont = parseInt(localStorage.getItem('obx-font-size') || '11', 10);
        var overlay = document.createElement('div');
        overlay.id = 'obx-settings-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;';

        var sessOptionsHtml = '';
        if (sapSessions.ok && sapSessions.connections.length > 0) {
            sapSessions.connections.forEach(function(conn) {
                conn.sessions.forEach(function(sess) {
                    var sel = (conn.index === sapSessions.selected_conn && sess.index === sapSessions.selected_sess) ? ' selected' : '';
                    sessOptionsHtml += '<option value="' + conn.index + ':' + sess.index + '"' + sel + '>' + conn.label + ' — ' + sess.label + '</option>';
                });
            });
        } else {
            sessOptionsHtml = '<option value="0:0">Default (0:0)</option>';
        }

        overlay.innerHTML = `
            <div style="background:#121214;border:1px solid #27272a;border-radius:8px;padding:24px;width:480px;color:#e4e4e7;font-family:Segoe UI,sans-serif;max-height:90vh;overflow-y:auto;">
                <div style="font-size:15px;font-weight:600;margin-bottom:16px;">Settings</div>

                <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;padding:10px;background:#18181b;border-radius:6px;border:1px solid #27272a;">
                    <div style="flex:1;">
                        <div style="font-size:12px;font-weight:600;margin-bottom:4px;">Page Zoom</div>
                        <div style="display:flex;align-items:center;gap:6px;">
                            <button class="obx-btn obx-btn-outline" id="obx-zoom-down" style="padding:2px 10px;font-size:14px;">−</button>
                            <span id="obx-zoom-label" style="font-size:12px;color:#e4e4e7;min-width:40px;text-align:center;">${curZoom}%</span>
                            <button class="obx-btn obx-btn-outline" id="obx-zoom-up" style="padding:2px 10px;font-size:14px;">+</button>
                            <button class="obx-btn obx-btn-outline" id="obx-zoom-reset" style="margin-left:4px;">Reset</button>
                        </div>
                    </div>
                    <div>
                        <button class="obx-btn obx-btn-outline" id="obx-hard-reload" style="padding:6px 14px;">Hard Reload</button>
                    </div>
                </div>

                <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;padding:10px;background:#18181b;border-radius:6px;border:1px solid #27272a;">
                    <div style="font-size:12px;font-weight:600;white-space:nowrap;">Console Font</div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <button class="obx-btn obx-btn-outline" id="obx-font-down" style="padding:2px 10px;font-size:14px;">−</button>
                        <span id="obx-font-label" style="font-size:12px;color:#e4e4e7;min-width:36px;text-align:center;">${curFont}px</span>
                        <button class="obx-btn obx-btn-outline" id="obx-font-up" style="padding:2px 10px;font-size:14px;">+</button>
                        <button class="obx-btn obx-btn-outline" id="obx-font-reset" style="margin-left:4px;">Reset</button>
                    </div>
                </div>

                <div style="margin-bottom:12px;padding:10px;background:#18181b;border-radius:6px;border:1px solid #27272a;">
                    <div style="font-size:12px;font-weight:600;margin-bottom:6px;">SAP GUI Session</div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <select id="obx-sap-session-select" class="obx-input" style="width:100%;flex:1;cursor:pointer;">
                            ${sessOptionsHtml}
                        </select>
                        <button class="obx-btn obx-btn-outline" id="obx-sap-refresh-sessions">Refresh</button>
                    </div>
                    <span id="obx-sap-session-status" style="font-size:10px;color:#52525b;margin-top:4px;display:block;"></span>
                </div>

                <label style="font-size:11px;color:#71717a;">Supabase URL</label>
                <input id="obx-cfg-url" class="obx-input" style="width:100%;margin:4px 0 10px;" value="${cfg.url || ''}">
                <label style="font-size:11px;color:#71717a;">Anon Key</label>
                <input id="obx-cfg-key" class="obx-input" style="width:100%;margin:4px 0 10px;" value="${cfg.key || ''}">
                <label style="font-size:11px;color:#71717a;">Email</label>
                <input id="obx-cfg-email" class="obx-input" style="width:100%;margin:4px 0 10px;">
                <label style="font-size:11px;color:#71717a;">Password</label>
                <input id="obx-cfg-pass" class="obx-input" type="password" style="width:100%;margin:4px 0 10px;">
                <div style="display:flex;gap:8px;margin-top:12px;">
                    <button class="obx-btn obx-btn-green" id="obx-cfg-login">Save & Login</button>
                    <button class="obx-btn obx-btn-outline" id="obx-cfg-close">Close</button>
                    <span id="obx-cfg-status" style="font-size:11px;color:#71717a;line-height:28px;margin-left:8px;"></span>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        var applyZoom = function(val) {
            val = Math.max(50, Math.min(200, val));
            localStorage.setItem('obx-zoom', val);
            document.body.style.zoom = val + '%';
            document.getElementById('obx-zoom-label').textContent = val + '%';
            return val;
        };
        document.getElementById('obx-zoom-down').onclick = function() { curZoom = applyZoom(curZoom - 10); };
        document.getElementById('obx-zoom-up').onclick = function() { curZoom = applyZoom(curZoom + 10); };
        document.getElementById('obx-zoom-reset').onclick = function() { curZoom = applyZoom(100); };
        document.getElementById('obx-hard-reload').onclick = function() { window.location.reload(); };

        var applyFont = function(val) {
            val = Math.max(8, Math.min(20, val));
            localStorage.setItem('obx-font-size', val);
            document.getElementById('obx-log-area').style.fontSize = val + 'px';
            document.getElementById('obx-font-label').textContent = val + 'px';
            return val;
        };
        document.getElementById('obx-font-down').onclick = function() { curFont = applyFont(curFont - 1); };
        document.getElementById('obx-font-up').onclick = function() { curFont = applyFont(curFont + 1); };
        document.getElementById('obx-font-reset').onclick = function() { curFont = applyFont(11); };

        document.getElementById('obx-sap-session-select').onchange = async function() {
            var parts = this.value.split(':');
            var res = await window.pywebview.api.set_sap_session(parseInt(parts[0]), parseInt(parts[1]));
            var st = document.getElementById('obx-sap-session-status');
            if (res.startsWith('OK:')) {
                st.textContent = res.substring(3); st.style.color = '#10b981';
                obxLog('OK', 'SAP session: ' + res.substring(3));
            } else {
                st.textContent = res; st.style.color = '#f87171';
            }
        };
        document.getElementById('obx-sap-refresh-sessions').onclick = async function() {
            var st = document.getElementById('obx-sap-session-status');
            st.textContent = 'Scanning...'; st.style.color = '#60a5fa';
            var data = await window.pywebview.api.list_sap_sessions();
            var sel = document.getElementById('obx-sap-session-select');
            sel.innerHTML = '';
            if (data.ok && data.connections.length > 0) {
                data.connections.forEach(function(conn) {
                    conn.sessions.forEach(function(sess) {
                        var opt = document.createElement('option');
                        opt.value = conn.index + ':' + sess.index;
                        opt.textContent = conn.label + ' — ' + sess.label;
                        if (conn.index === data.selected_conn && sess.index === data.selected_sess) opt.selected = true;
                        sel.appendChild(opt);
                    });
                });
                st.textContent = data.connections.length + ' connection(s) found'; st.style.color = '#10b981';
            } else {
                sel.innerHTML = '<option value="0:0">Default (0:0)</option>';
                st.textContent = data.error || 'No connections found'; st.style.color = '#fbbf24';
            }
        };

        document.getElementById('obx-cfg-close').onclick = function() { overlay.remove(); };
        document.getElementById('obx-cfg-login').onclick = async function() {
            var st = document.getElementById('obx-cfg-status');
            var url = document.getElementById('obx-cfg-url').value.replace(/\/+$/, '');
            var key = document.getElementById('obx-cfg-key').value.trim();
            var email = document.getElementById('obx-cfg-email').value.trim();
            var pass = document.getElementById('obx-cfg-pass').value;
            if (!url || !key) { st.textContent = 'URL and Key required.'; st.style.color = '#f87171'; return; }
            if (email && pass) {
                st.textContent = 'Logging in...'; st.style.color = '#60a5fa';
                var res = await window.pywebview.api.login_supabase(url, key, email, pass);
                if (res.startsWith('OK:')) {
                    st.textContent = res.substring(3); st.style.color = '#10b981';
                    obxLog('OK', 'Supabase: ' + res.substring(3));
                } else {
                    st.textContent = res; st.style.color = '#f87171';
                    obxLog('ERR', 'Supabase: ' + res);
                }
            } else {
                await window.pywebview.api.save_config(url, key);
                st.textContent = 'Config saved.'; st.style.color = '#fbbf24';
            }
        };
    };

    /* ── TO Confirm Mode — page detection, scanning, batch confirm ── */
    window._obxCurrentMode = 'shipment';
    window._obxConfirmRunning = false;
    window._obxConfirmStopped = false;
    window._obxReloadTimer = null;

    window.obxSleep = function(ms) {
        return new Promise(function(resolve) { setTimeout(resolve, ms); });
    };

    window.obxIsPutawayLogPage = function() {
        var ths = document.querySelectorAll('th');
        var hasTONumber = false, hasWarehouse = false;
        for (var i = 0; i < ths.length; i++) {
            var t = (ths[i].textContent || '').trim();
            if (t === 'TO Number') hasTONumber = true;
            if (t === 'Warehouse') hasWarehouse = true;
        }
        return hasTONumber && hasWarehouse;
    };

    window.obxDetectPage = function() {
        var newMode = obxIsPutawayLogPage() ? 'to-confirm' : 'shipment';
        if (newMode === window._obxCurrentMode) return;
        window._obxCurrentMode = newMode;
        var ship = document.getElementById('obx-shipment-controls');
        var toc = document.getElementById('obx-to-controls');
        if (newMode === 'to-confirm') {
            ship.style.display = 'none';
            toc.style.display = 'flex';
            obxLog('INFO', 'Putaway Log Search detected — TO Confirm mode active.');
            obxScanPendingTOs();
        } else {
            ship.style.display = 'flex';
            toc.style.display = 'none';
            obxStopReloadTimer();
        }
    };

    window.obxScanPendingTOs = function() {
        var pending = [];
        var tables = document.querySelectorAll('table');
        if (tables.length === 0) { obxUpdateTOCount(0); return pending; }
        var rows = tables[0].querySelectorAll('tbody tr');
        for (var i = 0; i < rows.length; i++) {
            var cells = rows[i].querySelectorAll('td');
            if (cells.length < 9) continue;
            var statusText = (cells[8].textContent || '').trim();
            if (statusText.indexOf('Pending TO Confirm') === -1) continue;
            var toSpan = cells[4].querySelector('.font-medium, span');
            var toNum = toSpan ? toSpan.textContent.trim() : cells[4].textContent.trim();
            var warehouse = cells[1].textContent.trim();
            if (toNum && warehouse && toNum !== 'N/A') {
                pending.push({ to_number: toNum, warehouse: warehouse, rowIndex: i });
            }
        }
        obxUpdateTOCount(pending.length);
        return pending;
    };

    window.obxClickStatusButton = async function(toNumber) {
        var tables = document.querySelectorAll('table');
        if (tables.length === 0) return;
        var rows = tables[0].querySelectorAll('tbody tr');
        for (var i = 0; i < rows.length; i++) {
            var cells = rows[i].querySelectorAll('td');
            if (cells.length < 9) continue;
            var toSpan = cells[4].querySelector('.font-medium, span');
            var rowTO = toSpan ? toSpan.textContent.trim() : cells[4].textContent.trim();
            if (rowTO !== toNumber) continue;
            var statusCell = cells[8];
            var badge = statusCell.querySelector('button, [class*="badge"], [class*="Badge"], span[class*="bg-"]');
            if (!badge) badge = statusCell.querySelector('span, div');
            if (badge) {
                badge.click();
                await obxSleep(600);
                badge.click();
                obxLog('DIM', 'Clicked status button for TO ' + toNumber);
            }
            break;
        }
    };

    window.obxUpdateTOCount = function(n) {
        var el = document.getElementById('obx-to-count');
        if (el) el.textContent = n + ' TO' + (n !== 1 ? 's' : '') + ' pending';
    };

    window.obxGetPendingCount = function() {
        var ps = document.querySelectorAll('p');
        for (var i = 0; i < ps.length; i++) {
            if (ps[i].textContent.indexOf('TOs awaiting') > -1) {
                var parent = ps[i].parentElement;
                if (!parent) continue;
                var divs = parent.querySelectorAll('div');
                for (var j = 0; j < divs.length; j++) {
                    if (divs[j].childElementCount === 0) {
                        var t = divs[j].textContent.trim();
                        if (/^\d+$/.test(t)) return parseInt(t, 10);
                    }
                }
            }
        }
        return -1;
    };

    window.obxFindNextPageButton = function() {
        var allBtns = document.querySelectorAll('button');
        var pagBtns = [];
        for (var i = 0; i < allBtns.length; i++) {
            var cls = allBtns[i].className || '';
            if (cls.indexOf('h-8') > -1 && cls.indexOf('w-8') > -1 &&
                cls.indexOf('p-0') > -1 && allBtns[i].querySelector('svg')) {
                pagBtns.push(allBtns[i]);
            }
        }
        return pagBtns.length >= 2 ? pagBtns[pagBtns.length - 1] : null;
    };

    window.obxStopConfirm = function() {
        window._obxConfirmStopped = true;
        obxLog('WARN', 'Stopping TO confirmation after current TO completes...');
    };

    window.obxRefreshTableData = async function() {
        var btns = document.querySelectorAll('button');
        var moreBtn = null;
        for (var i = 0; i < btns.length; i++) {
            if ((btns[i].textContent || '').indexOf('More') > -1 && btns[i].querySelector('svg')) {
                moreBtn = btns[i]; break;
            }
        }
        if (!moreBtn) { obxLog('WARN', 'Could not find More button for data refresh.'); return; }
        moreBtn.click();
        await obxSleep(300);
        var items = document.querySelectorAll('[role="menuitem"]');
        for (var j = 0; j < items.length; j++) {
            if ((items[j].textContent || '').indexOf('Refresh Data') > -1) {
                items[j].click();
                obxLog('DIM', 'Refreshing table data from Supabase...');
                await obxSleep(2500);
                return;
            }
        }
        document.body.click();
        obxLog('WARN', 'Refresh Data menu item not found.');
    };

    window.obxStartReloadTimer = function() {
        if (window._obxReloadTimer) return;
        obxLog('DIM', 'All TOs confirmed. Auto-refresh every 15s to check for new entries...');
        window._obxReloadTimer = setInterval(async function() {
            await obxRefreshTableData();
            await obxSleep(1000);
            var pc = obxGetPendingCount();
            if (pc > 0) {
                obxStopReloadTimer();
                obxLog('INFO', pc + ' new pending TO(s) detected.');
                obxScanPendingTOs();
            }
        }, 15000);
    };

    window.obxStopReloadTimer = function() {
        if (window._obxReloadTimer) {
            clearInterval(window._obxReloadTimer);
            window._obxReloadTimer = null;
        }
    };

    window.obxConfirmAllTOs = async function() {
        if (!window._obxSapConnected) {
            obxLog('ERR', 'SAP not connected. Connect SAP first.');
            return;
        }
        if (window._obxConfirmRunning) return;

        window._obxConfirmRunning = true;
        window._obxConfirmStopped = false;
        obxStopReloadTimer();

        var btn = document.getElementById('obx-btn-confirm-tos');
        var stopBtn = document.getElementById('obx-btn-stop-tos');
        var status = document.getElementById('obx-status');

        btn.disabled = true;
        btn.textContent = 'Processing...';
        stopBtn.style.display = 'inline-block';

        var totalConfirmed = 0;
        var totalErrors = 0;

        obxLog('SAP', 'Starting batch TO confirmation via LT12...');

        while (!window._obxConfirmStopped) {
            var pending = obxScanPendingTOs();

            if (pending.length === 0) {
                var pendingCount = obxGetPendingCount();
                if (pendingCount > 0) {
                    var nextBtn = obxFindNextPageButton();
                    if (nextBtn && !nextBtn.disabled) {
                        obxLog('INFO', 'No pending on this page. Moving to next page... (' + pendingCount + ' still pending)');
                        nextBtn.click();
                        await obxSleep(2500);
                        continue;
                    }
                }
                break;
            }

            for (var i = 0; i < pending.length; i++) {
                if (window._obxConfirmStopped) break;

                var to = pending[i];
                status.textContent = 'Confirming TO ' + to.to_number + ' (' + to.warehouse + ') — ' + (i + 1) + '/' + pending.length;
                status.style.color = '#60a5fa';

                obxLog('SAP', 'LT12: Confirming TO ' + to.to_number + ' in warehouse ' + to.warehouse + '...');
                var result = await window.pywebview.api.confirm_transfer_order(to.to_number, to.warehouse);

                if (result.startsWith('SUCCESS:')) {
                    totalConfirmed++;
                    obxLog('OK', 'TO ' + to.to_number + ': ' + result);
                    await obxClickStatusButton(to.to_number);
                } else if (result.startsWith('ERROR:')) {
                    totalErrors++;
                    obxLog('ERR', 'TO ' + to.to_number + ': ' + result);
                } else {
                    obxLog('WARN', 'TO ' + to.to_number + ': ' + result);
                }

                await obxSleep(1500);
            }

            if (window._obxConfirmStopped) break;

            obxLog('INFO', 'Page finished. Refreshing data...');
            status.textContent = 'Refreshing data...';
            status.style.color = '#60a5fa';
            await obxRefreshTableData();
            await obxSleep(2000);
        }

        var summary = 'Batch ' + (window._obxConfirmStopped ? 'stopped' : 'complete') + ': ' + totalConfirmed + ' confirmed, ' + totalErrors + ' error(s).';
        obxLog(totalErrors > 0 ? 'WARN' : 'OK', summary);
        status.textContent = summary;
        status.style.color = totalErrors > 0 ? '#fbbf24' : '#10b981';

        btn.disabled = false;
        btn.textContent = 'Confirm All TOs';
        stopBtn.style.display = 'none';
        window._obxConfirmRunning = false;

        obxScanPendingTOs();

        if (obxGetPendingCount() === 0) {
            obxStartReloadTimer();
        }
    };

    /* Page detection polling */
    setInterval(function() { obxDetectPage(); }, 2000);
    setInterval(function() {
        if (window._obxCurrentMode === 'to-confirm' && !window._obxConfirmRunning) {
            obxScanPendingTOs();
        }
    }, 5000);
    obxDetectPage();

    /* ── Load saved config status ── */
    (async function() {
        var cfg = await window.pywebview.api.get_config();
        if (cfg.url) obxLog('DIM', 'Supabase config loaded from file.');
    })();

})();
"""


# ---------------------------------------------------------------------------
#  PYTHON API (exposed to JavaScript via window.pywebview.api)
# ---------------------------------------------------------------------------
class SAPBridgeAPI:
    def __init__(self):
        self._sap_connected = False
        self._supabase_url = ""
        self._supabase_key = ""
        self._supabase_token = ""
        self._user_id = ""
        self._org_id = ""
        self._user_email = ""
        self._load_config()

    # ── SAP GUI ──

    def connect_sap(self):
        try:
            w32 = _init_com()

            try:
                sap_gui = w32.GetObject("SAPGUI")
            except Exception as e:
                self._sap_connected = False
                return "ERROR: GetObject SAPGUI failed — " + str(e)

            try:
                app = sap_gui.GetScriptingEngine
            except Exception as e:
                self._sap_connected = False
                return "ERROR: GetScriptingEngine failed — " + str(e)

            try:
                conn = app.Children(0)
            except Exception as e:
                self._sap_connected = False
                return "ERROR: No SAP connection found — " + str(e)

            try:
                sess = conn.Children(0)
            except Exception as e:
                self._sap_connected = False
                return "ERROR: No SAP session found — " + str(e)

            self._sap_connected = True
            try:
                desc = conn.Description
            except Exception:
                desc = "SAP GUI"
            return "OK:Connected — " + str(desc)
        except Exception as e:
            self._sap_connected = False
            return "ERROR: " + str(e)

    def disconnect_sap(self):
        self._sap_connected = False
        return "OK"

    def list_sap_sessions(self):
        """List all open SAP connections and their sessions."""
        global _sap_conn_idx, _sap_sess_idx
        try:
            w32 = _init_com()
            sap_gui = w32.GetObject("SAPGUI")
            app = sap_gui.GetScriptingEngine
            result = []
            for ci in range(app.Children.Count):
                conn = app.Children(ci)
                try:
                    desc = conn.Description
                except Exception:
                    desc = "Connection " + str(ci)
                sessions = []
                for si in range(conn.Children.Count):
                    sess = conn.Children(si)
                    try:
                        info = sess.Info
                        tx = info.Transaction
                        sys_name = info.SystemName
                        label = sys_name + " / " + tx
                    except Exception:
                        label = "Session " + str(si)
                    sessions.append({"index": si, "label": label})
                result.append({
                    "index": ci,
                    "label": str(desc),
                    "sessions": sessions,
                })
            return {"ok": True, "connections": result,
                    "selected_conn": _sap_conn_idx,
                    "selected_sess": _sap_sess_idx}
        except Exception as e:
            return {"ok": False, "error": str(e), "connections": [],
                    "selected_conn": _sap_conn_idx,
                    "selected_sess": _sap_sess_idx}

    def set_sap_session(self, conn_idx, sess_idx):
        """Set which SAP connection/session to use."""
        global _sap_conn_idx, _sap_sess_idx
        _sap_conn_idx = int(conn_idx)
        _sap_sess_idx = int(sess_idx)
        return f"OK:Using connection {conn_idx}, session {sess_idx}"

    # ── Full Shipment Process ──

    def process_shipment(self, data):
        """Run the full end-to-end shipment process in SAP.

        Based on FullTestAAAA2.vbs recording. Steps:
        1. ZV26 serial numbers (optional)
        2. VL02N pack BOX
        3. LT12 confirm TO
        4. VT01N create shipment (tracking set here)
        5. VL02N pack CASE + dimensions + output (continues from VT01N context)
        6. VL02N PGI

        data keys: delivery, item, serials (list), to_number, warehouse, tracking
        """
        if not self._sap_connected:
            return {"ok": False, "failed_step": 0, "error": "SAP not connected"}

        delivery = str(data.get("delivery", ""))
        item = str(data.get("item", "0010"))
        serials = data.get("serials", [])
        to_number = str(data.get("to_number", ""))
        warehouse = str(data.get("warehouse", ""))
        tracking = str(data.get("tracking", "Tracking"))

        if not delivery:
            return {"ok": False, "failed_step": 0, "error": "Delivery number required"}
        if not to_number:
            return {"ok": False, "failed_step": 0, "error": "TO number required"}
        if not warehouse:
            return {"ok": False, "failed_step": 0, "error": "Warehouse required"}
        if not tracking:
            return {"ok": False, "failed_step": 0, "error": "Tracking number required"}

        results = []
        try:
            w32 = _init_com()
            sess, conn = _get_sap_session()
        except Exception as e:
            return {"ok": False, "failed_step": 0, "error": "SAP session: " + str(e)}

        def _check_sbar():
            try:
                return sess.findById("wnd[0]/sbar").Text or ""
            except Exception:
                return ""

        def _dismiss_popups():
            for _ in range(3):
                try:
                    sess.findById("wnd[1]").sendVKey(0)
                    _wait_for_session(sess, 5)
                except Exception:
                    break

        def _open_vl02n(dlv):
            """Navigate to VL02N, enter delivery, dismiss incompletion/popups."""
            sess.findById("wnd[0]/tbar[0]/okcd").text = "/nVL02N"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)
            sess.findById("wnd[0]/usr/ctxtLIKP-VBELN").text = dlv
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 20)
            _dismiss_popups()
            # Dismiss incompletion log if shown
            for _ in range(2):
                try:
                    title = sess.findById("wnd[0]").Text or ""
                    if "ncompl" in title.lower():
                        sess.findById("wnd[0]/tbar[0]/btn[3]").press()
                        _wait_for_session(sess, 10)
                    else:
                        break
                except Exception:
                    break

        # ── Step 1: ZV26 Serial Numbers (optional) ──
        if serials and len(serials) > 0:
            try:
                sess.findById("wnd[0]/tbar[0]/okcd").text = "/nZV26"
                sess.findById("wnd[0]").sendVKey(0)
                _wait_for_session(sess, 15)

                sess.findById("wnd[0]/usr/ctxtPA_DELIV").text = delivery
                sess.findById("wnd[0]/tbar[1]/btn[8]").press()
                _wait_for_session(sess, 15)

                sess.findById("wnd[0]/usr/ctxtPA_ITEM").text = item
                sess.findById("wnd[0]/usr/ctxtPA_ITEM").setFocus()
                sess.findById("wnd[0]").sendVKey(0)
                _wait_for_session(sess, 10)
                sess.findById("wnd[0]").sendVKey(0)
                _wait_for_session(sess, 10)

                for idx, sn in enumerate(serials):
                    sn = str(sn).strip()
                    if not sn:
                        continue
                    field_id = f"wnd[0]/usr/tblZVBF9000TC_OUTINS/txtW_TEI_SERNO[1,{idx}]"
                    try:
                        sess.findById(field_id).text = sn
                        sess.findById("wnd[0]").sendVKey(0)
                        _wait_for_session(sess, 5)
                    except Exception:
                        break

                sess.findById("wnd[0]/tbar[0]/btn[11]").press()
                _wait_for_session(sess, 15)
                results.append({"step": 1, "name": "ZV26 Serials", "status": "ok", "msg": _check_sbar()})
            except Exception as e:
                results.append({"step": 1, "name": "ZV26 Serials", "status": "error", "msg": str(e)})
                return {"ok": False, "failed_step": 1, "error": str(e), "results": results}
        else:
            results.append({"step": 1, "name": "ZV26 Serials", "status": "skipped", "msg": "No serial numbers"})

        # ── Step 2: VL02N Pack BOX ──
        try:
            _open_vl02n(delivery)

            sess.findById("wnd[0]/tbar[1]/btn[18]").press()
            _wait_for_session(sess, 15)

            sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6POS/ssubTAB:SAPLV51G:6010/tblSAPLV51GTC_HU_001/ctxtV51VE-VHILM[2,0]").text = "BOX"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 10)

            sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6POS/ssubTAB:SAPLV51G:6010/tblSAPLV51GTC_HU_001").getAbsoluteRow(0).selected = True
            sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6POS/ssubTAB:SAPLV51G:6010/tblSAPLV51GTC_HU_002").getAbsoluteRow(0).selected = True
            sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6POS/ssubTAB:SAPLV51G:6010/tblSAPLV51GTC_HU_002/ctxtV51VP-MATNR[0,0]").setFocus()
            sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6POS/ssubTAB:SAPLV51G:6010/btn%#AUTOTEXT001").press()
            _wait_for_session(sess, 10)

            sess.findById("wnd[0]/tbar[0]/btn[11]").press()
            _wait_for_session(sess, 15)
            results.append({"step": 2, "name": "VL02N Pack BOX", "status": "ok", "msg": _check_sbar()})
        except Exception as e:
            results.append({"step": 2, "name": "VL02N Pack BOX", "status": "error", "msg": str(e)})
            return {"ok": False, "failed_step": 2, "error": str(e), "results": results}

        # ── Step 3: LT12 Confirm TO ──
        try:
            sess.findById("wnd[0]/tbar[0]/okcd").text = "/nLT12"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)

            sess.findById("wnd[0]/usr/txtLTAK-TANUM").text = to_number
            sess.findById("wnd[0]/usr/ctxtLTAK-LGNUM").text = warehouse
            sess.findById("wnd[0]/usr/chkRL03T-OFPOS").setFocus()
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)

            sess.findById("wnd[0]/tbar[0]/btn[11]").press()
            _wait_for_session(sess, 15)
            try:
                sess.findById("wnd[1]/usr/btnSPOP-OPTION1").press()
                _wait_for_session(sess, 10)
            except Exception:
                pass
            results.append({"step": 3, "name": "LT12 Confirm TO", "status": "ok", "msg": _check_sbar()})
        except Exception as e:
            results.append({"step": 3, "name": "LT12 Confirm TO", "status": "error", "msg": str(e)})
            return {"ok": False, "failed_step": 3, "error": str(e), "results": results}

        # ── Step 4: VT01N Create Shipment ──
        shipment_number = ""
        try:
            sess.findById("wnd[0]/tbar[0]/okcd").text = "/nVT01N"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)
            _dismiss_popups()

            # Set Transport Planning Point and Shipment Type explicitly
            sess.findById("wnd[0]/usr/ctxtVTTK-TPLST").text = "0001"
            sess.findById("wnd[0]/usr/cmbVTTK-SHTYP").key = "Z002"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 10)

            # Assign Deliveries
            sess.findById("wnd[0]/tbar[1]/btn[6]").press()
            _wait_for_session(sess, 10)

            sess.findById("wnd[1]/usr/ctxtS_VSTEL-LOW").text = "KY01"
            sess.findById("wnd[1]/usr/ctxtS_VBELN-LOW").text = delivery
            sess.findById("wnd[1]/tbar[0]/btn[8]").press()
            _wait_for_session(sess, 15)

            # Plan shipment (no tree selection needed)
            sess.findById("wnd[0]/tbar[1]/btn[16]").press()
            _wait_for_session(sess, 10)

            # Set tracking as shipment external ID
            sess.findById("wnd[0]/usr/tabsHEADER_TABSTRIP1/tabpTABS_OV_PR/ssubG_HEADER_SUBSCREEN1:SAPMV56A:1021/ctxtVTTK-EXTI1").text = tracking
            _wait_for_session(sess, 5)

            # Set all 4 status buttons
            for btn_id in (
                "wnd[0]/usr/tabsHEADER_TABSTRIP2/tabpTABS_OV_DE/ssubG_HEADER_SUBSCREEN2:SAPMV56A:1025/btn*RV56A-ICON_STDIS",
                "wnd[0]/usr/tabsHEADER_TABSTRIP2/tabpTABS_OV_DE/ssubG_HEADER_SUBSCREEN2:SAPMV56A:1025/btn*RV56A-ICON_STREG",
                "wnd[0]/usr/tabsHEADER_TABSTRIP2/tabpTABS_OV_DE/ssubG_HEADER_SUBSCREEN2:SAPMV56A:1025/btn*RV56A-ICON_STLBG",
                "wnd[0]/usr/tabsHEADER_TABSTRIP2/tabpTABS_OV_DE/ssubG_HEADER_SUBSCREEN2:SAPMV56A:1025/btn*RV56A-ICON_STLAD",
            ):
                try:
                    sess.findById(btn_id).press()
                    _wait_for_session(sess, 5)
                except Exception:
                    pass

            sess.findById("wnd[0]/tbar[0]/btn[11]").press()
            _wait_for_session(sess, 15)

            # Capture shipment number from status bar ("Shipment 11828019 has been saved")
            sbar4 = _check_sbar()
            import re
            match = re.search(r'(\d{7,})', sbar4)
            if match:
                shipment_number = match.group(1)
            results.append({"step": 4, "name": "VT01N Shipment", "status": "ok", "msg": sbar4})
        except Exception as e:
            results.append({"step": 4, "name": "VT01N Shipment", "status": "error", "msg": str(e)})
            return {"ok": False, "failed_step": 4, "error": str(e), "results": results}

        # ── Step 5: Pack CASE + Dimensions + Output ──
        try:
            # Open shipment in change mode via VT02N with the shipment number
            sess.findById("wnd[0]/tbar[0]/okcd").text = "/nVT02N"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 10)
            _dismiss_popups()

            if shipment_number:
                try:
                    sess.findById("wnd[0]/usr/ctxtVTTK-TKNUM").text = shipment_number
                    sess.findById("wnd[0]").sendVKey(0)
                    _wait_for_session(sess, 10)
                except Exception:
                    pass

            # Create new HU (packing)
            sess.findById("wnd[0]/tbar[1]/btn[21]").press()
            _wait_for_session(sess, 10)

            sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6POS/ssubTAB:SAPLV51G:6010/tblSAPLV51GTC_HU_001/ctxtV51VE-VHILM[2,0]").text = "CASE"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 10)

            sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6HUS").select()
            _wait_for_session(sess, 5)

            sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6HUS/ssubTAB:SAPLV51G:6020/tblSAPLV51GTC_HU_003").getAbsoluteRow(0).selected = True
            sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6HUS/ssubTAB:SAPLV51G:6020/tblSAPLV51GTC_HU_004").getAbsoluteRow(0).selected = True
            sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6HUS/ssubTAB:SAPLV51G:6020/tblSAPLV51GTC_HU_004/ctxtVEKPVB-EXIDV[0,0]").setFocus()
            sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6HUS/ssubTAB:SAPLV51G:6020/btn%#AUTOTEXT004").press()
            _wait_for_session(sess, 5)
            sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6HUS/ssubTAB:SAPLV51G:6020/btn%#AUTOTEXT011").press()
            _wait_for_session(sess, 5)

            det = "wnd[0]/usr/tabsTS_HU_DET/tabpDETVEKP/ssubTAB:SAPLV51G:6110"
            sess.findById(f"{det}/ctxtVEKPVB-GEWEI").text = "LB"
            sess.findById(f"{det}/ctxtVEKPVB-GEWEI_MAX").text = "LB"
            sess.findById(f"{det}/txtVEKPVB-NTGEW").text = ""
            sess.findById(f"{det}/txtVEKPVB-BRGEW").text = "10"
            sess.findById(f"{det}/txtVEKPVB-LAENG").text = "10"
            sess.findById(f"{det}/ctxtVEKPVB-MEABM").text = "IN"
            sess.findById(f"{det}/txtVEKPVB-BREIT").text = "10"
            sess.findById(f"{det}/txtVEKPVB-HOEHE").text = "4"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 10)

            sess.findById("wnd[0]/tbar[0]/btn[11]").press()
            _wait_for_session(sess, 15)

            # Output processing
            sess.findById("wnd[0]/tbar[1]/btn[18]").press()
            _wait_for_session(sess, 10)

            tbl = "wnd[0]/usr/tblSAPDV70ATC_NAST3"

            # Refresh rows 2-3
            sess.findById(tbl).getAbsoluteRow(2).selected = True
            sess.findById(tbl).getAbsoluteRow(3).selected = True
            sess.findById("wnd[0]/tbar[1]/btn[6]").press()
            _wait_for_session(sess, 5)

            # Three print rounds: 3, 4, 3 copies
            for copies in ("3", "4", "3"):
                sess.findById(tbl).getAbsoluteRow(2).selected = True
                sess.findById(tbl).getAbsoluteRow(4).selected = True
                sess.findById(tbl).getAbsoluteRow(7).selected = True
                sess.findById("wnd[0]/tbar[1]/btn[2]").press()
                _wait_for_session(sess, 5)
                sess.findById("wnd[0]/usr/ctxtNAST-LDEST").text = "PG44"
                sess.findById("wnd[0]/usr/txtNAST-ANZAL").text = copies
                sess.findById("wnd[0]/tbar[0]/btn[3]").press()
                _wait_for_session(sess, 5)

            # Set send time to "4" on row 7
            sess.findById(tbl).getAbsoluteRow(7).selected = True
            sess.findById("wnd[0]/tbar[1]/btn[5]").press()
            _wait_for_session(sess, 5)
            sess.findById("wnd[0]/usr/cmbNAST-VSZTP").key = "4"
            sess.findById("wnd[0]/tbar[0]/btn[3]").press()
            _wait_for_session(sess, 5)

            # Final select and save
            sess.findById(tbl).getAbsoluteRow(2).selected = True
            sess.findById(tbl).getAbsoluteRow(4).selected = True
            sess.findById(tbl).getAbsoluteRow(7).selected = True
            sess.findById("wnd[0]/tbar[0]/btn[11]").press()
            _wait_for_session(sess, 15)

            results.append({"step": 5, "name": "VL02N CASE+Output", "status": "ok", "msg": _check_sbar()})
        except Exception as e:
            results.append({"step": 5, "name": "VL02N CASE+Output", "status": "error", "msg": str(e)})
            return {"ok": False, "failed_step": 5, "error": str(e), "results": results}

        # ── Step 6: VL02N Tracking (BOLNR) + PGI ──
        try:
            sess.findById("wnd[0]/tbar[0]/okcd").text = "/nVL02N"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)

            sess.findById("wnd[0]/usr/ctxtLIKP-VBELN").text = delivery
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)
            _dismiss_popups()

            # Open header detail
            sess.findById("wnd[0]/tbar[1]/btn[8]").press()
            _wait_for_session(sess, 10)

            # Select T\04 tab (Shipment) and set tracking as Bill of Lading
            sess.findById("wnd[0]/usr/tabsTAXI_TABSTRIP_HEAD/tabpT\\04").select()
            _wait_for_session(sess, 5)
            sess.findById("wnd[0]/usr/tabsTAXI_TABSTRIP_HEAD/tabpT\\04/ssubSUBSCREEN_BODY:SAPMV50A:2108/txtLIKP-BOLNR").text = tracking
            _wait_for_session(sess, 5)

            # Post Goods Issue
            sess.findById("wnd[0]/tbar[1]/btn[20]").press()
            _wait_for_session(sess, 20)

            sbar = _check_sbar()
            results.append({"step": 6, "name": "VL02N PGI", "status": "ok", "msg": sbar})
            self._log_transaction(delivery, "success", "PGI: " + sbar)
        except Exception as e:
            results.append({"step": 6, "name": "VL02N PGI", "status": "error", "msg": str(e)})
            return {"ok": False, "failed_step": 6, "error": str(e), "results": results}

        self._log_transaction(delivery, "success", f"Full shipment completed: TO {to_number}, tracking {tracking}")
        return {"ok": True, "failed_step": 0, "error": "", "results": results}

    # ── LT12 Transfer Order Confirmation ──

    def confirm_transfer_order(self, to_number, warehouse):
        """Confirm a single Transfer Order via SAP LT12 transaction."""
        if not to_number:
            return "ERROR: No TO number provided"
        if not warehouse:
            return "ERROR: No warehouse provided"
        if not self._sap_connected:
            return "ERROR: SAP not connected"

        try:
            w32 = _init_com()
            sess, conn = _get_sap_session()

            sess.findById("wnd[0]/tbar[0]/okcd").text = "/nLT12"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)

            sess.findById("wnd[0]/usr/txtLTAK-TANUM").text = str(to_number)
            sess.findById("wnd[0]/usr/ctxtLTAK-LGNUM").text = str(warehouse)

            sess.findById("wnd[0]/usr/chkRL03T-OFPOS").setFocus()
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)

            status_bar = sess.findById("wnd[0]/sbar").Text or ""
            for err_phrase in (
                "does not exist", "not found", "no authorization",
                "already confirmed", "already been confirmed",
                "does not belong", "is locked",
            ):
                if err_phrase in status_bar.lower():
                    self._log_to_transaction(to_number, warehouse, "error", status_bar)
                    return "ERROR: " + status_bar

            sess.findById("wnd[0]/tbar[0]/btn[11]").press()
            _wait_for_session(sess, 15)

            try:
                sess.findById("wnd[1]/usr/btnSPOP-OPTION1").press()
                _wait_for_session(sess, 10)
            except Exception:
                pass

            status_bar = sess.findById("wnd[0]/sbar").Text or ""
            msg_type = ""
            try:
                msg_type = sess.findById("wnd[0]/sbar").MessageType or ""
            except Exception:
                pass

            if msg_type == "S" or any(
                w in status_bar.lower()
                for w in ("confirmed", "saved", "updated", "posted")
            ):
                self._log_to_transaction(to_number, warehouse, "success", status_bar)
                self._update_putaway_status(to_number, warehouse)
                return "SUCCESS: " + status_bar
            elif msg_type in ("E", "A"):
                self._log_to_transaction(to_number, warehouse, "error", status_bar)
                return "ERROR: " + status_bar
            else:
                self._log_to_transaction(to_number, warehouse, "warning", status_bar)
                return "RESULT: " + status_bar

        except Exception as e:
            self._log_to_transaction(to_number, warehouse, "error", str(e))
            return "ERROR: " + str(e)

    # ── Supabase ──

    def get_config(self):
        return {"url": self._supabase_url, "key": self._supabase_key}

    def save_config(self, url, key):
        self._supabase_url = url
        self._supabase_key = key
        self._persist_config()
        return "OK"

    def login_supabase(self, url, key, email, password):
        self._supabase_url = url
        self._supabase_key = key

        try:
            resp = requests.post(
                f"{url}/auth/v1/token?grant_type=password",
                json={"email": email, "password": password},
                headers={"apikey": key, "Content-Type": "application/json"},
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
            self._supabase_token = data.get("access_token", "")
            self._user_id = data.get("user", {}).get("id", "")
            self._user_email = data.get("user", {}).get("email", "")

            # Fetch org
            profile_resp = self._supabase_get(
                f"/rest/v1/user_profiles?id=eq.{self._user_id}&select=organization_id"
            )
            if profile_resp and len(profile_resp) > 0:
                self._org_id = profile_resp[0].get("organization_id", "")

            self._persist_config()
            return f"OK:Logged in as {self._user_email}"
        except Exception as e:
            return f"ERROR: {e}"

    def _supabase_get(self, endpoint):
        token = self._supabase_token or self._supabase_key
        try:
            resp = requests.get(
                self._supabase_url + endpoint,
                headers={
                    "apikey": self._supabase_key,
                    "Authorization": f"Bearer {token}",
                },
                timeout=10,
            )
            return resp.json()
        except Exception:
            return None

    def _log_transaction(self, delivery_id, status, message):
        if not self._supabase_token or not self._org_id:
            return
        token = self._supabase_token
        try:
            requests.post(
                self._supabase_url + "/rest/v1/sap_transaction_logs",
                json={
                    "delivery_id": delivery_id,
                    "transaction_code": "VL02N",
                    "action": "post_goods_issue",
                    "status": status,
                    "sap_message": message[:500],
                    "executed_by": self._user_id,
                    "organization_id": self._org_id,
                },
                headers={
                    "apikey": self._supabase_key,
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation",
                },
                timeout=10,
            )
        except Exception:
            pass

    def _log_to_transaction(self, to_number, warehouse, status, message):
        """Log a TO confirmation transaction to Supabase."""
        if not self._supabase_token or not self._org_id:
            return
        token = self._supabase_token
        try:
            requests.post(
                self._supabase_url + "/rest/v1/sap_transaction_logs",
                json={
                    "delivery_id": str(to_number),
                    "transaction_code": "LT12",
                    "action": "confirm_transfer_order",
                    "status": status,
                    "sap_message": (f"WH:{warehouse} | " + message)[:500],
                    "executed_by": self._user_id,
                    "organization_id": self._org_id,
                },
                headers={
                    "apikey": self._supabase_key,
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation",
                },
                timeout=10,
            )
        except Exception:
            pass

    def _update_putaway_status(self, to_number, warehouse):
        """Mark a putaway operation as TO Confirmed in Supabase."""
        if not self._supabase_token:
            return
        token = self._supabase_token
        today = datetime.utcnow().strftime("%Y-%m-%d")
        try:
            requests.patch(
                self._supabase_url + "/rest/v1/rf_putaway_operations"
                f"?to_number=eq.{to_number}"
                f"&warehouse=eq.{warehouse}"
                f"&to_status=neq.TO%20Confirmed"
                f"&created_at=gte.{today}",
                json={
                    "to_status": "TO Confirmed",
                    "confirmed_by": self._user_id,
                    "confirmed_at": datetime.utcnow().isoformat() + "Z",
                },
                headers={
                    "apikey": self._supabase_key,
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation",
                },
                timeout=10,
            )
        except Exception:
            pass

    # ── Config persistence ──

    def _load_config(self):
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, "r") as f:
                    cfg = json.load(f)
                self._supabase_url = cfg.get("supabase_url", "")
                self._supabase_key = cfg.get("supabase_anon_key", "")
        except Exception:
            pass

    def _persist_config(self):
        try:
            with open(CONFIG_FILE, "w") as f:
                json.dump({
                    "supabase_url": self._supabase_url,
                    "supabase_anon_key": self._supabase_key,
                }, f)
        except Exception:
            pass


# ---------------------------------------------------------------------------
#  MAIN
# ---------------------------------------------------------------------------
def main():
    api = SAPBridgeAPI()

    window = webview.create_window(
        title="OmniFrame SAP Bridge",
        url=APP_URL,
        js_api=api,
        width=1300,
        height=880,
        min_size=(900, 500),
        text_select=True,
    )

    def on_loaded():
        window.evaluate_js(INJECTION_JS)

    window.events.loaded += on_loaded

    webview.start(
        debug=False,
        private_mode=False,
    )


if __name__ == "__main__":
    main()

# Created and developed by Jai Singh
