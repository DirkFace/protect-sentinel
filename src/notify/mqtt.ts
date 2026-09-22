import mqtt, { type MqttClient } from 'mqtt';
import type { Config } from '../config.js';
import { log } from '../logger.js';

/**
 * Publishes the add-on's state as Home Assistant entities via MQTT
 * auto-discovery. Requires a broker reachable from the container (e.g. the
 * Mosquitto add-on) — set mqtt_host in the add-on config to enable this;
 * blank leaves it off entirely (safe default, no broker assumed).
 *
 * Uses one persistent connection for the life of the scheduler process,
 * publishes discovery configs (retained) once on connect, and publishes
 * fresh state (also retained) after every run — so entities show the last
 * known values even across a Home Assistant restart, until the next run.
 */

const TOPIC_BASE = 'protect_sentinel';
const AVAILABILITY_TOPIC = `${TOPIC_BASE}/availability`;

const DEVICE = {
  identifiers: ['protect_sentinel'],
  name: 'Protect Sentinel',
  manufacturer: 'protect-sentinel (community add-on)',
};

interface EntityDef {
  component: 'sensor' | 'binary_sensor';
  objectId: string;
  name: string;
  deviceClass?: string;
  unit?: string;
  icon?: string;
}

const ENTITIES: EntityDef[] = [
  { component: 'sensor', objectId: 'last_run', name: 'Sentinel Last Run', deviceClass: 'timestamp', icon: 'mdi:clock-check-outline' },
  { component: 'sensor', objectId: 'incidents', name: 'Sentinel Incidents', unit: 'incidents', icon: 'mdi:cctv' },
  { component: 'sensor', objectId: 'detections', name: 'Sentinel Detections', unit: 'detections', icon: 'mdi:motion-sensor' },
  { component: 'binary_sensor', objectId: 'watch_match', name: 'Sentinel Watchlist Match', deviceClass: 'motion', icon: 'mdi:eye-check' },
  { component: 'binary_sensor', objectId: 'sensitive_zone_alert', name: 'Sentinel Sensitive Zone Alert', deviceClass: 'problem', icon: 'mdi:alert-octagon' },
  { component: 'sensor', objectId: 'brief', name: 'Sentinel Brief', icon: 'mdi:text-box-outline' },
  { component: 'sensor', objectId: 'status', name: 'Sentinel Status', icon: 'mdi:information-outline' },
];

let client: MqttClient | null = null;

/** Idempotent — safe to call once at startup. No-ops if mqtt_host is unset. */
export function connectMqtt(cfg: Config): void {
  if (!cfg.MQTT_HOST) {
    log.debug('MQTT_HOST not set — skipping MQTT entity publishing');
    return;
  }
  if (client) return;

  client = mqtt.connect(`mqtt://${cfg.MQTT_HOST}:${cfg.MQTT_PORT}`, {
    username: cfg.MQTT_USERNAME || undefined,
    password: cfg.MQTT_PASSWORD || undefined,
    will: { topic: AVAILABILITY_TOPIC, payload: 'offline', qos: 0, retain: true },
    reconnectPeriod: 5000,
  });

  client.on('connect', () => {
    log.info(`Connected to MQTT broker at ${cfg.MQTT_HOST}:${cfg.MQTT_PORT}`);
    publishDiscovery();
    client?.publish(AVAILABILITY_TOPIC, 'online', { retain: true });
  });
  client.on('error', (err) => log.warn(`MQTT error: ${err.message}`));
  client.on('reconnect', () => log.debug('Reconnecting to MQTT broker…'));
}

function publishDiscovery(): void {
  if (!client) return;
  for (const e of ENTITIES) {
    const stateTopic = `${TOPIC_BASE}/${e.objectId}`;
    const configTopic = `homeassistant/${e.component}/${TOPIC_BASE}/${e.objectId}/config`;
    const payload: Record<string, unknown> = {
      unique_id: `${TOPIC_BASE}_${e.objectId}`,
      name: e.name,
      state_topic: stateTopic,
      availability_topic: AVAILABILITY_TOPIC,
      device: DEVICE,
    };
    if (e.deviceClass) payload.device_class = e.deviceClass;
    if (e.unit) payload.unit_of_measurement = e.unit;
    if (e.icon) payload.icon = e.icon;
    if (e.component === 'binary_sensor') {
      payload.payload_on = 'ON';
      payload.payload_off = 'OFF';
    }
    client.publish(configTopic, JSON.stringify(payload), { retain: true });
  }
}

export interface NightState {
  lastRunIso: string;
  incidents: number;
  detections: number;
  watchMatch: boolean;
  /** True if any smart detection landed on a configured sensitive-zone camera — a distinct, more urgent signal than watchMatch, suitable for its own automation (light, siren, etc). */
  sensitiveZoneAlert: boolean;
  brief: string;
}

/** Publishes a successful run's results. No-op if MQTT isn't connected. */
export function publishNightState(state: NightState): void {
  if (!client?.connected) {
    log.debug('MQTT not connected — skipping state publish');
    return;
  }
  client.publish(`${TOPIC_BASE}/last_run`, state.lastRunIso, { retain: true });
  client.publish(`${TOPIC_BASE}/incidents`, String(state.incidents), { retain: true });
  client.publish(`${TOPIC_BASE}/detections`, String(state.detections), { retain: true });
  client.publish(`${TOPIC_BASE}/watch_match`, state.watchMatch ? 'ON' : 'OFF', { retain: true });
  client.publish(`${TOPIC_BASE}/sensitive_zone_alert`, state.sensitiveZoneAlert ? 'ON' : 'OFF', { retain: true });
  client.publish(`${TOPIC_BASE}/brief`, state.brief.slice(0, 250), { retain: true });
  client.publish(`${TOPIC_BASE}/status`, 'ok', { retain: true });
}

/** Publishes a failed run, so the status entity reflects it rather than showing stale "ok". */
export function publishRunError(message: string): void {
  if (!client?.connected) return;
  client.publish(`${TOPIC_BASE}/status`, `error: ${message.slice(0, 200)}`, { retain: true });
}
