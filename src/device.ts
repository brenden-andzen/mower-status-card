/**
 * The two kinds of robot the card shows: a lawn mower, and a cleaner Home Assistant has as a vacuum, such as Mammotion's
 * Spino pool cleaner. The card works in the lawn_mower's terms throughout. A vacuum's features and actions are read
 * into them here, and its own cleaning modes, the vacuum's fan speeds, come out of it here too.
 */
import {
    FEATURE_DOCK,
    FEATURE_PAUSE,
    FEATURE_START_MOWING,
    FEATURE_STOP,
    VACUUM_FAN_SPEED,
    VACUUM_PAUSE,
    VACUUM_RETURN_HOME,
    VACUUM_START,
    VACUUM_STOP,
} from "./const";
import type { HassEntity } from "./hass";

/** The entity domains the card takes. */
export const ROBOT_DOMAINS = ["lawn_mower", "vacuum"];

export type RobotAction = "start" | "pause" | "dock" | "stop";

const SERVICES: Record<string, Record<RobotAction, string>> = {
    lawn_mower: {
        start: "lawn_mower.start_mowing",
        pause: "lawn_mower.pause",
        dock: "lawn_mower.dock",
        stop: "lawn_mower.stop",
    },
    vacuum: {
        start: "vacuum.start",
        pause: "vacuum.pause",
        dock: "vacuum.return_to_base",
        stop: "vacuum.stop",
    },
};

function domainOf(entityId: string): string {
    return entityId.split(".")[0];
}

export function isRobot(entityId: string): boolean {
    return ROBOT_DOMAINS.includes(domainOf(entityId));
}

export function isVacuum(entityId: string): boolean {
    return domainOf(entityId) === "vacuum";
}

/** The entity's supported_features as the lawn_mower's bits: start, pause, dock and stop. */
export function featuresOf(entity: HassEntity): number {
    const raw = Number(entity.attributes.supported_features ?? 0);
    if (!isVacuum(entity.entity_id)) {
        return raw;
    }
    return (
        (raw & VACUUM_START ? FEATURE_START_MOWING : 0) |
        (raw & VACUUM_PAUSE ? FEATURE_PAUSE : 0) |
        (raw & VACUUM_RETURN_HOME ? FEATURE_DOCK : 0) |
        (raw & VACUUM_STOP ? FEATURE_STOP : 0)
    );
}

/**
 * A vacuum idle on its charger reads as docked. Mammotion's Spino reports docked only while it docks, and idle for the rest
 * of the time it charges, so its charging sensor tells. A lawn mower reads as its own state says.
 */
export function chargingActivity(entityId: string, activity: string, charging: boolean): string {
    return isVacuum(entityId) && activity === "idle" && charging ? "docked" : activity;
}

/** The Home Assistant action that does this for the entity's domain. */
export function serviceFor(entityId: string, action: RobotAction): string {
    return (SERVICES[domainOf(entityId)] ?? SERVICES.lawn_mower)[action];
}

export interface Modes {
    /** The modes the cleaner offers, in its own order. */
    list: string[];
    /** The mode it is in, when that is one of the list. */
    current: string | null;
}

/**
 * A vacuum's cleaning modes, from its fan speeds, as Mammotion's Spino gives its Floor, Wall and Waterline modes. Null
 * for a lawn mower, a vacuum that can't change them, or one with fewer than two to choose from.
 */
export function modesOf(entity: HassEntity, hidden: string[] = []): Modes | null {
    if (!isVacuum(entity.entity_id) || !(Number(entity.attributes.supported_features ?? 0) & VACUUM_FAN_SPEED)) {
        return null;
    }
    const raw = entity.attributes.fan_speed_list;
    const list = (Array.isArray(raw) ? raw : []).filter(
        (mode): mode is string => typeof mode === "string" && mode !== "" && !hidden.includes(mode),
    );
    if (list.length < 2) {
        return null;
    }
    const speed = entity.attributes.fan_speed;
    return { list, current: typeof speed === "string" && list.includes(speed) ? speed : null };
}
