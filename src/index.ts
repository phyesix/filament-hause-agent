/**
 * Filament Hause Agent
 * 
 * Runs on homelab, connects to local Bambulab printer via MQTT
 * and syncs status with cloud website.
 */

import mqtt from "mqtt";

// Configuration from environment
const config = {
    // Printer settings
    printerIp: process.env.PRINTER_IP || "",
    printerSerial: process.env.PRINTER_SERIAL || "",
    printerAccessCode: process.env.PRINTER_ACCESS_CODE || "",

    // Cloud settings
    apiUrl: process.env.API_URL || "https://filament-hause.vercel.app",
    agentToken: process.env.AGENT_TOKEN || "",

    // Sync interval (ms)
    syncInterval: parseInt(process.env.SYNC_INTERVAL || "5000"),
};

// Validate config
function validateConfig() {
    const required = ["printerIp", "printerSerial", "printerAccessCode", "agentToken"];
    const missing = required.filter((key) => !config[key as keyof typeof config]);

    if (missing.length > 0) {
        console.error(`Missing required environment variables: ${missing.join(", ")}`);
        console.error(`
Required environment variables:
  PRINTER_IP          - Bambulab printer IP address (e.g., 192.168.1.100)
  PRINTER_SERIAL      - Printer serial number
  PRINTER_ACCESS_CODE - LAN access code (8 characters)
  AGENT_TOKEN         - Token from Filament Hause website
  API_URL             - (optional) Cloud API URL
    `);
        process.exit(1);
    }
}

// Printer status type
interface PrinterStatus {
    online: boolean;
    gcodeState: string;
    printProgress: number;
    printTimeRemaining: number;
    currentLayer: number;
    totalLayers: number;
    nozzleTemp: number;
    nozzleTargetTemp: number;
    bedTemp: number;
    bedTargetTemp: number;
    chamberTemp: number;
    filamentUsed: number;
    ams: AMSUnit[];
}

interface AMSUnit {
    id: number;
    humidity: number;
    slots: AMSSlot[];
}

interface AMSSlot {
    slot: number;
    material: string;
    color: string;
    remaining: number;
}

// Current status
let currentStatus: PrinterStatus = {
    online: false,
    gcodeState: "IDLE",
    printProgress: 0,
    printTimeRemaining: 0,
    currentLayer: 0,
    totalLayers: 0,
    nozzleTemp: 0,
    nozzleTargetTemp: 0,
    bedTemp: 0,
    bedTargetTemp: 0,
    chamberTemp: 0,
    filamentUsed: 0,
    ams: [],
};

// MQTT Client
let mqttClient: mqtt.MqttClient | null = null;

function connectMqtt() {
    const url = `mqtts://${config.printerIp}:8883`;

    console.log(`[MQTT] Connecting to ${url}...`);

    mqttClient = mqtt.connect(url, {
        username: "bblp",
        password: config.printerAccessCode,
        rejectUnauthorized: false,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
    });

    mqttClient.on("connect", () => {
        console.log("[MQTT] Connected to printer!");
        currentStatus.online = true;

        const topic = `device/${config.printerSerial}/report`;
        mqttClient?.subscribe(topic, (err) => {
            if (err) {
                console.error("[MQTT] Subscribe error:", err.message);
            } else {
                console.log(`[MQTT] Subscribed to ${topic}`);
                requestFullStatus();
            }
        });
    });

    mqttClient.on("message", (_topic, payload) => {
        try {
            const data = JSON.parse(payload.toString());
            parseStatus(data);
        } catch (err) {
            // Ignore parse errors
        }
    });

    mqttClient.on("error", (err) => {
        console.error("[MQTT] Error:", err.message);
    });

    mqttClient.on("close", () => {
        console.log("[MQTT] Disconnected");
        currentStatus.online = false;
    });

    mqttClient.on("reconnect", () => {
        console.log("[MQTT] Reconnecting...");
    });
}

function requestFullStatus() {
    if (!mqttClient?.connected) return;

    const command = {
        pushing: {
            sequence_id: "0",
            command: "pushall",
        },
    };

    const topic = `device/${config.printerSerial}/request`;
    mqttClient.publish(topic, JSON.stringify(command));
}

function parseStatus(data: Record<string, unknown>) {
    const print = data.print as Record<string, unknown> | undefined;
    if (!print) return;

    // Parse gcode state
    if (print.gcode_state) {
        currentStatus.gcodeState = print.gcode_state as string;
    }

    // Parse progress
    if (print.mc_percent !== undefined) {
        currentStatus.printProgress = print.mc_percent as number;
    }

    // Parse time
    if (print.mc_remaining_time !== undefined) {
        currentStatus.printTimeRemaining = (print.mc_remaining_time as number) * 60;
    }

    // Parse layers
    if (print.layer_num !== undefined) {
        currentStatus.currentLayer = print.layer_num as number;
    }
    if (print.total_layer_num !== undefined) {
        currentStatus.totalLayers = print.total_layer_num as number;
    }

    // Parse temperatures
    if (print.nozzle_temper !== undefined) {
        currentStatus.nozzleTemp = print.nozzle_temper as number;
    }
    if (print.nozzle_target_temper !== undefined) {
        currentStatus.nozzleTargetTemp = print.nozzle_target_temper as number;
    }
    if (print.bed_temper !== undefined) {
        currentStatus.bedTemp = print.bed_temper as number;
    }
    if (print.bed_target_temper !== undefined) {
        currentStatus.bedTargetTemp = print.bed_target_temper as number;
    }
    if (print.chamber_temper !== undefined) {
        currentStatus.chamberTemp = print.chamber_temper as number;
    }

    // Parse filament usage
    if (print.total_weight !== undefined) {
        currentStatus.filamentUsed = print.total_weight as number;
    }

    // Parse AMS
    const amsData = print.ams as Record<string, unknown> | undefined;
    if (amsData) {
        const amsUnits = amsData.ams as Array<Record<string, unknown>> | undefined;
        if (amsUnits) {
            currentStatus.ams = amsUnits.map((unit, unitIndex) => {
                const humidity = parseInt((unit.humidity as string) || "0", 10);
                const trays = unit.tray as Array<Record<string, unknown>> | undefined;

                const slots: AMSSlot[] = (trays || []).map((tray, slotIndex) => ({
                    slot: unitIndex * 4 + slotIndex,
                    material: (tray.tray_type as string) || "Unknown",
                    color: (tray.tray_color as string) || "000000",
                    remaining: parseInt((tray.remain as string) || "0", 10),
                }));

                return { id: unitIndex, humidity, slots };
            });
        }
    }
}

// Sync with cloud
async function syncWithCloud() {
    try {
        const response = await fetch(`${config.apiUrl}/api/agent/status`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${config.agentToken}`,
            },
            body: JSON.stringify({
                status: currentStatus,
                timestamp: new Date().toISOString(),
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            console.error(`[SYNC] Failed: ${response.status} - ${error}`);
        }
    } catch (err) {
        console.error(`[SYNC] Error: ${(err as Error).message}`);
    }
}

// Check for commands from cloud
async function checkCommands() {
    try {
        const response = await fetch(`${config.apiUrl}/api/agent/commands`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${config.agentToken}`,
            },
        });

        if (response.ok) {
            const data = await response.json() as { commands?: Array<{ type: string; payload?: unknown }> };
            if (data.commands && data.commands.length > 0) {
                for (const cmd of data.commands) {
                    executeCommand(cmd);
                }
            }
        }
    } catch {
        // Silently fail for polling
    }
}

function executeCommand(cmd: { type: string; payload?: unknown }) {
    if (!mqttClient?.connected) {
        console.log(`[CMD] Cannot execute, printer not connected: ${cmd.type}`);
        return;
    }

    console.log(`[CMD] Executing: ${cmd.type}`);

    const topic = `device/${config.printerSerial}/request`;
    let command: Record<string, unknown> | null = null;

    switch (cmd.type) {
        case "pause":
            command = { print: { command: "pause", sequence_id: "0" } };
            break;
        case "resume":
            command = { print: { command: "resume", sequence_id: "0" } };
            break;
        case "stop":
            command = { print: { command: "stop", sequence_id: "0" } };
            break;
        case "refresh":
            requestFullStatus();
            return;
        default:
            console.log(`[CMD] Unknown command: ${cmd.type}`);
            return;
    }

    if (command) {
        mqttClient.publish(topic, JSON.stringify(command));
    }
}

// Main
async function main() {
    console.log("╔═══════════════════════════════════════╗");
    console.log("║     Filament Hause Agent v1.0.0       ║");
    console.log("╚═══════════════════════════════════════╝");
    console.log("");

    validateConfig();

    console.log(`[CONFIG] Printer IP: ${config.printerIp}`);
    console.log(`[CONFIG] Printer Serial: ${config.printerSerial}`);
    console.log(`[CONFIG] API URL: ${config.apiUrl}`);
    console.log(`[CONFIG] Sync Interval: ${config.syncInterval}ms`);
    console.log("");

    // Connect to printer
    connectMqtt();

    // Start sync loop
    setInterval(async () => {
        await syncWithCloud();
        await checkCommands();
    }, config.syncInterval);

    // Request full status every minute
    setInterval(() => {
        requestFullStatus();
    }, 60000);

    console.log("[AGENT] Running... Press Ctrl+C to stop.");
}

// Handle shutdown
process.on("SIGINT", () => {
    console.log("\n[AGENT] Shutting down...");
    mqttClient?.end();
    process.exit(0);
});

process.on("SIGTERM", () => {
    console.log("\n[AGENT] Shutting down...");
    mqttClient?.end();
    process.exit(0);
});

main();
