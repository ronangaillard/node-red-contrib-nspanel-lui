import { NSPanelMessageUtils } from './nspanel-message-utils'
import { NSPanelUtils } from './nspanel-utils'
import { Logger } from './logger'
import { NSPanelColorUtils } from './nspanel-colorutils'
import {
    EventArgs,
    StartupEventArgs,
    HardwareEventArgs,
    SensorEventArgs,
    LightEventArgs,
    FirmwareEventArgs,
    FirmwareType,
    TasmotaEventArgs,
} from '../types/types'
import * as NSPanelConstants from './nspanel-constants'

const log = Logger('NSPanelMessageParser')

export class NSPanelMessageParser {
    public static parse(payloadStr: string): EventArgs {
        let result: EventArgs = null

        try {
            const temp = JSON.parse(payloadStr)

            if ('CustomRecv' in temp) {
                result = NSPanelMessageParser.parseCustomMessage(temp.CustomRecv.split(','))
            } else if ('nlui_driver_version' in temp) {
                result = NSPanelMessageParser.parseNluiDriverEvent(temp)
            } else {
                result = {
                    type: 'unknown',
                    source: '',
                    event: '',
                    data: temp,
                }
            }
        } catch (err: unknown) {
            result.data = payloadStr
        }

        return result
    }

    public static parseCustomMessage(parts: Array<string>): EventArgs {
        let result: EventArgs = {
            type: 'event',
            event: '',
            event2: '',
            source: '',
        }

        switch (parts[0]) {
            case 'event':
                result = NSPanelMessageParser.parseEvent(parts)
                break
        }

        return result
    }

    public static parseSensorEvent(input: any): SensorEventArgs | null {
        let result: SensorEventArgs | null = null

        if (NSPanelMessageUtils.hasProperty(input, 'ANALOG')) {
            const analogSensorData = input['ANALOG']
            const temp = analogSensorData['Temperature1']
            const tempUnit = input['TempUnit']
            if (temp != null) {
                result = {
                    type: 'sensor',
                    source: 'temperature1',
                    event: 'measurement',
                    temp: Number(temp) ?? null,
                    tempUnit: tempUnit ?? null,
                }
                if (NSPanelMessageUtils.hasProperty(input, 'Time')) {
                    const date = NSPanelMessageUtils.toDate(input['Time'])
                    if (date !== null) {
                        result.date = date
                    }
                }
            }
        }

        return result
    }

    public static parseHardwareEvent(input: any): HardwareEventArgs[] {
        const result: HardwareEventArgs[] = []
        let eventArgs: HardwareEventArgs

        if (NSPanelMessageUtils.hasProperty(input, 'POWER1')) {
            eventArgs = NSPanelMessageParser.convertToRelayEvent(input, 'POWER1')
            result.push(eventArgs)
        }
        if (NSPanelMessageUtils.hasProperty(input, 'POWER2')) {
            eventArgs = NSPanelMessageParser.convertToRelayEvent(input, 'POWER2')
            result.push(eventArgs)
        }

        if (NSPanelMessageUtils.hasProperty(input, 'Button1')) {
            eventArgs = NSPanelMessageParser.convertToButtonEvent(input, 'Button1')
            result.push(eventArgs)
        }
        if (NSPanelMessageUtils.hasProperty(input, 'Button2')) {
            eventArgs = NSPanelMessageParser.convertToButtonEvent(input, 'Button2')
            result.push(eventArgs)
        }

        if (result.length === 0) {
            eventArgs = {
                type: 'hw',
                date: new Date(),
                event: '',
                source: '',
                data: input,
            }
            result.push(eventArgs)
        }

        return result
    }

    public static parseTasmotaCommandResult(input: any): TasmotaEventArgs {
        let tasmotaEvent: TasmotaEventArgs | null = null

        if (NSPanelMessageUtils.hasProperty(input, NSPanelConstants.STR_TASMOTA_CMD_OTAURL)) {
            const cmdResult = input[NSPanelConstants.STR_TASMOTA_CMD_OTAURL]

            tasmotaEvent = {
                type: 'fw',
                source: NSPanelConstants.FIRMWARE_TASMOTA,
                event: NSPanelConstants.STR_TASMOTA_CMD_OTAURL,
                data: cmdResult,
            }
        }

        return tasmotaEvent
    }

    public static parseTasmotaStatus2Event(input: any): FirmwareEventArgs {
        // TODO: consolidate parsing into parse()
        let result: FirmwareEventArgs | null = null

        if (NSPanelMessageUtils.hasProperty(input, 'StatusFWR')) {
            const statusFwr = input['StatusFWR']
            const version = statusFwr['Version']

            if (version != null) {
                result = {
                    type: 'fw',
                    source: NSPanelConstants.FIRMWARE_TASMOTA,
                    event: 'version',
                    version,
                }
            }
        }

        return result
    }

    public static parseTasmotaUpgradeEvent(input: any): FirmwareEventArgs {
        // TODO: consolidate parsing into parse()
        let result: FirmwareEventArgs | null = null

        if (NSPanelMessageUtils.hasProperty(input, NSPanelConstants.STR_TASMOTA_MSG_UPGRADE)) {
            const statusValue = input[NSPanelConstants.STR_TASMOTA_MSG_UPGRADE]
            if (NSPanelUtils.isString(statusValue) && !NSPanelUtils.stringIsNullOrEmpty(statusValue)) {
                const statusResult = String.prototype.startsWith.call(
                    statusValue,
                    NSPanelConstants.STR_TASMOTA_UPGRADE_SUCCESSFUL
                )
                    ? 'success'
                    : 'failed'

                result = {
                    type: 'fw',
                    source: NSPanelConstants.FIRMWARE_TASMOTA,
                    event: 'update',
                    status: statusResult,
                }
                if (statusResult === 'failed') {
                    result.statusMsg = statusValue.substring(
                        statusValue.indexOf(NSPanelConstants.STR_TASMOTA_UPGRADE_FAILED) +
                            NSPanelConstants.STR_TASMOTA_UPGRADE_FAILED.length +
                            1
                    )
                }
            }
        }

        return result
    }

    public static parseBerryDriverUpdateEvent(input: any): FirmwareEventArgs {
        // TODO: consolidate parsing into parse()
        let result: FirmwareEventArgs | null = null
        let key: string = null
        let source: FirmwareType | null = null

        if (NSPanelMessageUtils.hasProperty(input, NSPanelConstants.STR_BERRYDRIVER_CMD_UPDATEDRIVER)) {
            key = NSPanelConstants.STR_BERRYDRIVER_CMD_UPDATEDRIVER
            source = NSPanelConstants.FIRMWARE_BERRYDRIVER
        } else if (NSPanelMessageUtils.hasProperty(input, NSPanelConstants.STR_BERRYDRIVER_CMD_FLASHNEXTION)) {
            key = NSPanelConstants.STR_BERRYDRIVER_CMD_FLASHNEXTION
            source = NSPanelConstants.FIRMWARE_HMI
        }

        if (key != null && source != null) {
            const cmdResult: string = input[key] as string
            result = {
                type: 'fw',
                source,
                event: 'update',
                status: NSPanelConstants.STR_LUI_CMD_SUCCESS === cmdResult ? 'success' : null,
            }
        }

        return result
    }

    public static parseNluiDriverEvent(input: any): FirmwareEventArgs {
        // TODO: consolidate parsing into parse()
        let result: FirmwareEventArgs | null = null

        if (NSPanelMessageUtils.hasProperty(input, 'nlui_driver_version')) {
            const version = input['nlui_driver_version']

            if (version != null) {
                result = {
                    type: 'fw',
                    source: NSPanelConstants.FIRMWARE_BERRYDRIVER,
                    event: 'version',
                    version,
                }
            }
        }

        return result
    }

    private static convertToRelayEvent(input: any, property: string): HardwareEventArgs {
        const eventArgs: HardwareEventArgs = {
            type: 'hw',
            date: new Date(),
            event: 'relay',
            event2: 'state',
            source: property.toLowerCase(),
            active: input[property] === 'ON',
        }
        return eventArgs
    }

    private static convertToButtonEvent(input: any, property: string): HardwareEventArgs {
        const eventArgs: HardwareEventArgs = {
            type: 'hw',
            date: new Date(),
            event: 'button',
            event2: 'press',
            source: property.toLowerCase(),
            value: NSPanelMessageParser.actionStringToNumber(input[property]['Action']),
        }
        return eventArgs
    }

    public static parseEvent(parts: Array<string>): EventArgs {
        let eventArgs: EventArgs = {
            type: 'event',
            date: new Date(),
            event: parts[1],
            source: parts[2],
        }

        switch (parts[1]) {
            case NSPanelConstants.STR_LUI_EVENT_STARTUP: {
                const startupEventArgs = eventArgs as StartupEventArgs
                startupEventArgs.source = 'hmi'
                startupEventArgs.hmiVersion = {
                    version: null,
                    internalVersion: parts[2],
                    model: parts[3],
                }
                eventArgs = startupEventArgs
                break
            }

            case NSPanelConstants.STR_LUI_EVENT_SLEEPREACHED: {
                break
            }

            case NSPanelConstants.STR_LUI_EVENT_BUTTONPRESS2: {
                eventArgs.event2 = parts[3]
                // normalize eventArgs
                switch (parts[3]) {
                    case 'button': {
                        eventArgs.source = parts[3]
                        eventArgs.event2 = parts[2]
                        eventArgs.entityId = parts[2]
                        break
                    }

                    case 'OnOff': {
                        eventArgs.source = parts[2]
                        eventArgs.entityId = parts[2]
                        eventArgs.active = NSPanelMessageUtils.toBoolean(parts[4]) || undefined
                        break
                    }

                    case 'number-set': {
                        // "event,buttonPress2,fan.0,number-set,3"
                        eventArgs.entityId = parts[2]
                        eventArgs.source = parts[2]

                        const n = Number(parts[4])
                        if (Number.isNaN(n)) {
                            eventArgs.data = parts[4]
                        } else {
                            eventArgs.value = n
                        }
                        break
                    }

                    case 'colorWheel': {
                        const lightEventArgs = eventArgs as LightEventArgs
                        lightEventArgs.event2 = 'color'

                        const colorDataStr = parts[4]
                        const colorDataArr = NSPanelUtils.stringIsNullOrEmpty(colorDataStr)
                            ? []
                            : colorDataStr.split('|')
                        if (colorDataArr.length === 3) {
                            const colorData = colorDataArr.map((v) => Number(v))
                            const colorTuple = NSPanelColorUtils.hmiPosToColor(colorData[0], colorData[1])
                            lightEventArgs.rgb = colorTuple[0]
                            lightEventArgs.hsv = colorTuple[1]
                        }

                        eventArgs = lightEventArgs
                        break
                    }
                    case 'positionSlider': {
                        eventArgs.event2 = 'position'
                        break
                    }

                    case 'tiltSlider': {
                        eventArgs.event2 = 'tilt'
                        break
                    }

                    default:
                        break
                }

                if (parts.length === 5) {
                    const n = Number(parts[4])

                    if (Number.isNaN(n)) {
                        eventArgs.data = parts[4]
                    } else {
                        eventArgs.value = n
                    }
                }
                break
            }

            case NSPanelConstants.STR_LUI_EVENT_PAGEOPENDETAIL: {
                eventArgs.entityId = parts[3]
                break
            }
            default: {
                eventArgs.data = {
                    raw: parts.slice(2),
                }
            }
        }

        log.debug(`parseEvent ${JSON.stringify(eventArgs)}`)
        return eventArgs
    }

    public static actionStringToNumber(actionString: string): number | undefined {
        let result: number
        switch (actionString.toLowerCase()) {
            case 'single':
                result = 1
                break
            case 'double':
                result = 2
                break
            case 'triple':
                result = 3
                break
            case 'quad':
                result = 4
                break
            case 'penta':
                result = 5
                break
        }

        return result
    }
}
