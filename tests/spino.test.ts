import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FEATURE_DOCK, FEATURE_PAUSE, FEATURE_START_MOWING, FEATURE_STOP } from "../src/const";
import { chargingActivity, featuresOf, modesOf, serviceFor } from "../src/device";
import type { EntityRegistryEntry, HassEntity, HomeAssistant } from "../src/hass";
import "../src/mower-status-card";
import type { MowerStatusCard } from "../src/mower-status-card";
import { activityOf, detectSlots, presetOf } from "../src/slots";
import type { MowerStatusCardConfig } from "../src/types";
import { NOW } from "./fixtures";

// Start, return home, fan speed and state: what Mammotion-HA gives its Spino vacuum entity.
const SPINO_FEATURES = 8192 | 16 | 32 | 4096;

// A made-up Mammotion Spino pool cleaner, "Pip", with the entities and translation keys Mammotion-HA gives one.
const ENTITIES: Record<string, { state: string; attributes?: Record<string, unknown>; translation_key?: string }> = {
    "vacuum.pip": {
        state: "docked",
        attributes: {
            friendly_name: "Pip",
            supported_features: SPINO_FEATURES,
            fan_speed_list: ["AUTO", "FLOOR", "WALL", "ECO", "LINE"],
            fan_speed: "FLOOR",
        },
    },
    "sensor.pip_battery": {
        state: "88",
        attributes: { device_class: "battery", unit_of_measurement: "%" },
        translation_key: "spino_battery",
    },
    "binary_sensor.pip_charging": {
        state: "on",
        attributes: { device_class: "battery_charging" },
        translation_key: "spino_charging",
    },
    "sensor.pip_last_error": { state: "unknown", translation_key: "spino_error_message" },
    "sensor.pip_error_time": { state: "unknown", attributes: { device_class: "timestamp" }, translation_key: "spino_error_time" },
    "sensor.pip_status": { state: "CHARGING", translation_key: "spino_status" },
    "update.pip_firmware": { state: "off", attributes: { installed_version: "1.0.0", latest_version: "1.0.0" }, translation_key: "update" },
};

// Mammotion-HA's own English words for its work mode sensor, which the card borrows for the modes.
const WORK_MODES: Record<string, string> = { AUTO: "All", FLOOR: "Floor", WALL: "Wall", ECO: "Eco", LINE: "Waterline" };

function spino(changes: Record<string, Partial<{ state: string; attributes: Record<string, unknown> }>> = {}): HomeAssistant {
    const states: Record<string, HassEntity> = {};
    const entities: Record<string, EntityRegistryEntry> = {};
    for (const [id, base] of Object.entries(ENTITIES)) {
        const made = { ...base, ...changes[id], attributes: { ...base.attributes, ...changes[id]?.attributes } };
        states[id] = {
            entity_id: id,
            state: made.state,
            last_changed: new Date(NOW - 3_600_000).toISOString(),
            attributes: made.attributes,
        };
        entities[id] = { entity_id: id, device_id: "device-3", platform: "mammotion", translation_key: made.translation_key };
    }
    return {
        formatEntityState: (entity) => (entity.entity_id === "vacuum.pip" && entity.state === "cleaning" ? "Cleaning" : entity.state),
        callWS: async <T>() => ({}) as T,
        localize: (key) => {
            const match = /^component\.mammotion\.entity\.sensor\.spino_work_mode\.state\.(\w+)$/.exec(key);
            if (match) return WORK_MODES[match[1]] ?? "";
            return key === "component.lawn_mower.entity_component._.state.docked" ? "Docked" : "";
        },
        language: "en",
        locale: { language: "en", time_zone: "server" },
        config: { time_zone: "Europe/Helsinki" },
        states,
        entities,
        devices: { "device-3": { id: "device-3", name: "Spino-E1EXAMPLE", name_by_user: "Pip" } },
    };
}

async function card(state: HomeAssistant, config: Partial<MowerStatusCardConfig> = {}): Promise<MowerStatusCard> {
    const element = document.createElement("mower-status-card");
    element.setConfig({ type: "custom:mower-status-card", entity: "vacuum.pip", show_image: false, ...config } as MowerStatusCardConfig);
    element.hass = state;
    document.body.append(element);
    await element.updateComplete;
    return element;
}

function text(element: Element | null | undefined): string {
    return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function actions(element: MowerStatusCard): ReturnType<typeof vi.fn> {
    const fired = vi.fn();
    element.addEventListener("hass-action", (event) => fired((event as CustomEvent).detail.config.tap_action));
    return fired;
}

describe("a vacuum, such as Mammotion's Spino pool cleaner", () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        document.body.innerHTML = "";
    });

    it("reads a vacuum's features as a lawn mower's, and leaves a lawn mower's as they are", () => {
        const vacuum = spino().states["vacuum.pip"]!;
        expect(featuresOf(vacuum)).toBe(FEATURE_START_MOWING | FEATURE_DOCK);
        const full = { ...vacuum, attributes: { supported_features: 8192 | 4 | 16 | 8 } };
        expect(featuresOf(full)).toBe(FEATURE_START_MOWING | FEATURE_PAUSE | FEATURE_DOCK | FEATURE_STOP);
        expect(featuresOf({ ...vacuum, entity_id: "lawn_mower.x", attributes: { supported_features: 15 } })).toBe(15);
    });

    it("acts through the vacuum's own actions", () => {
        expect(serviceFor("vacuum.pip", "start")).toBe("vacuum.start");
        expect(serviceFor("vacuum.pip", "dock")).toBe("vacuum.return_to_base");
        expect(serviceFor("lawn_mower.matti", "start")).toBe("lawn_mower.start_mowing");
    });

    it("finds the Spino's entities by Mammotion's translation keys, apart from its mowers'", () => {
        expect(detectSlots(spino(), "vacuum.pip")).toEqual({
            battery: "sensor.pip_battery",
            charging: "binary_sensor.pip_charging",
            error: "sensor.pip_last_error",
            error_time: "sensor.pip_error_time",
            update: "update.pip_firmware",
        });
    });

    it("reads cleaning as mowing, for any vacuum", () => {
        expect(activityOf(presetOf(spino(), "vacuum.pip"), "cleaning")).toBe("mowing");
        const other = { ...spino(), entities: {} };
        expect(activityOf(presetOf(other, "vacuum.pip"), "cleaning")).toBe("mowing");
    });

    it("takes a vacuum in its configuration, and offers one from the picker when there is no lawn mower", () => {
        const element = document.createElement("mower-status-card");
        expect(() => element.setConfig({ type: "custom:mower-status-card", entity: "vacuum.pip" })).not.toThrow();
        const stub = (customElements.get("mower-status-card") as unknown as typeof MowerStatusCard).getStubConfig(spino());
        expect(stub).toEqual({ entity: "vacuum.pip" });
    });

    it("offers to start cleaning at the dock, with dock greyed", async () => {
        const element = await card(spino());
        const buttons = [...element.shadowRoot!.querySelectorAll<HTMLButtonElement>(".buttons button")];
        expect(text(buttons[0])).toBe("Start cleaning");
        expect(buttons).toHaveLength(2);
        expect(buttons[1].disabled).toBe(true);
        const fired = actions(element);
        buttons[0].click();
        expect(fired.mock.calls[0][0]).toEqual({
            action: "perform-action",
            perform_action: "vacuum.start",
            target: { entity_id: "vacuum.pip" },
        });
    });

    it("reads an idle vacuum on its charger as docked, and a lawn mower as its state says", () => {
        expect(chargingActivity("vacuum.pip", "idle", true)).toBe("docked");
        expect(chargingActivity("vacuum.pip", "idle", false)).toBe("idle");
        expect(chargingActivity("vacuum.pip", "mowing", true)).toBe("mowing");
        expect(chargingActivity("lawn_mower.matti", "idle", true)).toBe("idle");
    });

    it("shows a Spino idle on its charger as docked and charging, with dock greyed", async () => {
        const element = await card(spino({ "vacuum.pip": { state: "idle" }, "sensor.pip_status": { state: "PREPARE" } }));
        expect(text(element.shadowRoot!.querySelector(".state"))).toBe("Docked, charging");
        const buttons = [...element.shadowRoot!.querySelectorAll<HTMLButtonElement>(".buttons button")];
        expect(text(buttons[0])).toBe("Start cleaning");
        expect(buttons[1].disabled).toBe(true);
    });

    it("shows a Spino idle off its charger as idle", async () => {
        const element = await card(spino({ "vacuum.pip": { state: "idle" }, "binary_sensor.pip_charging": { state: "off" } }));
        expect(text(element.shadowRoot!.querySelector(".state"))).toBe("Idle");
    });

    it("sends it back to the dock while it cleans, as it can't pause", async () => {
        const element = await card(spino({ "vacuum.pip": { state: "cleaning" }, "binary_sensor.pip_charging": { state: "off" } }));
        expect(text(element.shadowRoot!.querySelector(".state"))).toContain("Cleaning");
        const buttons = [...element.shadowRoot!.querySelectorAll<HTMLButtonElement>(".buttons button")];
        expect(buttons).toHaveLength(1);
        const fired = actions(element);
        buttons[0].click();
        expect(fired.mock.calls[0][0].perform_action).toBe("vacuum.return_to_base");
    });

    it("shows its cleaning modes in Mammotion's words, without the one the dock button does", async () => {
        const element = await card(
            spino({ "vacuum.pip": { attributes: { fan_speed_list: ["RECHARGE", "AUTO", "FLOOR", "WALL", "ECO", "LINE"] } } }),
        );
        const modes = [...element.shadowRoot!.querySelectorAll<HTMLButtonElement>(".mode")];
        expect(modes.map(text)).toEqual(["All", "Floor", "Wall", "Eco", "Waterline"]);
        // Docked, it cleans in no mode, whatever mode it last had.
        expect(modes.some((mode) => mode.classList.contains("active"))).toBe(false);
    });

    it("asks before a mode starts it cleaning, and switches without asking while it cleans", async () => {
        const docked = await card(spino());
        const fired = actions(docked);
        docked.shadowRoot!.querySelectorAll<HTMLButtonElement>(".mode")[4].click();
        expect(fired.mock.calls[0][0]).toEqual({
            action: "perform-action",
            perform_action: "vacuum.set_fan_speed",
            target: { entity_id: "vacuum.pip" },
            data: { fan_speed: "LINE" },
            confirmation: { text: "Start cleaning in Waterline mode?" },
        });
        document.body.innerHTML = "";

        const cleaning = await card(spino({ "vacuum.pip": { state: "cleaning" } }));
        const modes = [...cleaning.shadowRoot!.querySelectorAll<HTMLButtonElement>(".mode")];
        expect(modes[1].classList.contains("active")).toBe(true);
        expect(modes[1].getAttribute("aria-pressed")).toBe("true");
        const switched = actions(cleaning);
        modes[1].click();
        expect(switched).not.toHaveBeenCalled();
        modes[2].click();
        expect(switched.mock.calls[0][0].confirmation).toBeUndefined();
        expect(switched.mock.calls[0][0].data).toEqual({ fan_speed: "WALL" });
    });

    it("tidies a mode's name when no translation has it", async () => {
        const element = await card(spino({ "vacuum.pip": { attributes: { fan_speed_list: ["DEEP_CLEAN", "QUICK"] } } }));
        expect([...element.shadowRoot!.querySelectorAll(".mode")].map(text)).toEqual(["Deep clean", "Quick"]);
    });

    it("shows no modes for a vacuum that can't change them, nor for a lawn mower", () => {
        const vacuum = spino().states["vacuum.pip"]!;
        expect(modesOf({ ...vacuum, attributes: { ...vacuum.attributes, supported_features: 8192 | 16 } })).toBeNull();
        expect(modesOf({ ...vacuum, entity_id: "lawn_mower.pip" })).toBeNull();
        expect(modesOf({ ...vacuum, attributes: { ...vacuum.attributes, fan_speed_list: ["AUTO"] } })).toBeNull();
    });

    it("shows the Spino's last error as a chip", async () => {
        const element = await card(
            spino({
                "sensor.pip_last_error": { state: "Brush stuck" },
                "sensor.pip_error_time": { state: new Date(NOW - 3_600_000).toISOString() },
            }),
        );
        expect([...element.shadowRoot!.querySelectorAll(".chip")].map(text)).toEqual(["Error"]);
    });
});
