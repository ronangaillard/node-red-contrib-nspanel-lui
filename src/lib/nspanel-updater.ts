// TODO: update node status
import * as nEvents from 'events'
import axios, { AxiosRequestConfig } from 'axios'
import * as semver from 'semver'

import { Logger } from './logger'
import { NSPanelUtils } from './nspanel-utils'
import {
    HMIVersion,
    IPanelController,
    IPanelMqttHandler,
    IPanelUpdater,
    IPanelUpdaterOptions,
    NotifyData,
    VersionData,
    NodeRedI18nResolver,
    FirmwareEventArgs,
    FirmwareType,
} from '../types/types'

import * as NSPanelConstants from './nspanel-constants'

type PanelVersionData = {
    tasmota: VersionData | null
    berryDriver: VersionData | null
    hmi: VersionData | null
}

enum VersionAcquisitionStatus {
    None = 0,
    TasmotaVersionCurrent = 1,
    TasmotaVersionLatest = 2,
    BerryDriverVersionCurrent = 4,
    BerryDriverVersionLatest = 8,
    HmiVersionCurrent = 16,
    HmiVersionLatest = 32,
    AllAcquired = ~(~0 << 6),

    TasmotaUpdateAvailable = 64,
    BerryDriverUpdateAvailable = 128,
    HmiUpdateAvailable = 256,
}

type UpdateVersionData = {
    versions: {
        current: PanelVersionData
        latest: PanelVersionData
    }
    versionAcquisitionStatus: VersionAcquisitionStatus
}

type GithubApiReleaseAssetsSchema = {
    name: string
    url: string
    browser_download_url: string
}

type GithubApiReleaseSchema = {
    name: string
    tag_name: string
    published_at: Date
    assets: GithubApiReleaseAssetsSchema[]
}

const URL_TASMOTA_RELEASES_LATEST_META = 'https://api.github.com/repositories/80286288/releases/latest'
const URL_BERRYDRIVER_LATEST = 'https://raw.githubusercontent.com/joBr99/nspanel-lovelace-ui/main/tasmota/autoexec.be'
// const URL_NLUI_RELEASES_LATEST_META = 'https://api.github.com/repos/joBr99/nspanel-lovelace-ui/releases/latest'
const URL_NLUI_LATEST =
    'https://raw.githubusercontent.com/joBr99/nspanel-lovelace-ui/main/apps/nspanel-lovelace-ui/nspanel-lovelace-ui.py'

const axiosRequestOptions: AxiosRequestConfig = {
    headers: {
        STR_HTTP_USER_AGENT: NSPanelConstants.STR_HTTP_USER_AGENT_VALUE,
    },
}

const BERRY_DRIVER_REGEX = /version_of_this_script\s*=\s*(?<version>\d+)/
const NLUI_HMI_VERSION_REGEX =
    /desired_display_firmware_version\s*=\s*(?<internalVersion>\d+)\s*version\s*=\s*['"]v(?<version>.*)['"]/

const log = Logger('NSPanelUpdater')

export class NSPanelUpdater extends nEvents.EventEmitter implements IPanelUpdater {
    private _panelController: IPanelController

    private _mqttHandler: IPanelMqttHandler | null = null

    private _i18n: NodeRedI18nResolver = null

    private _options: IPanelUpdaterOptions = null

    private _updateInProgress: boolean = false

    private _updateTaskStack: FirmwareType[] = []

    private _updateVersionData: UpdateVersionData = {
        versions: {
            current: {
                tasmota: null,
                berryDriver: null,
                hmi: null,
            },
            latest: {
                tasmota: null,
                berryDriver: null,
                hmi: null,
            },
        },
        versionAcquisitionStatus: VersionAcquisitionStatus.None,
    }

    constructor(
        panelController: IPanelController,
        mqttHandler: IPanelMqttHandler,
        i18n: NodeRedI18nResolver,
        options: IPanelUpdaterOptions
    ) {
        super()
        this._mqttHandler = mqttHandler
        this._panelController = panelController
        this._i18n = i18n
        this._options = options
    }

    public checkForUpdates(): void {
        // TODO: promisify the wait for version data
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this
        this._acquireVersions()
            .then(() => {
                if (self._options.autoUpdate === false) {
                    let notifyId: string
                    let notifyTextMain: string
                    let currentVersion: string
                    let latestVersion: string
                    if (
                        self._updateVersionData.versionAcquisitionStatus & VersionAcquisitionStatus.HmiUpdateAvailable
                    ) {
                        notifyId = NSPanelConstants.STR_UPDATE_FIRMWARE_HMI
                        notifyTextMain = self._i18n('nspanel-controller.panel.newHmiTextMain')
                        currentVersion = self._updateVersionData.versions.current.hmi.internalVersion
                        latestVersion = `${self._updateVersionData.versions.latest.hmi.version} (${self._updateVersionData.versions.latest.hmi.internalVersion})`
                    }

                    if (
                        self._updateVersionData.versionAcquisitionStatus &
                        VersionAcquisitionStatus.BerryDriverUpdateAvailable
                    ) {
                        notifyId = NSPanelConstants.STR_UPDATE_FIRMWARE_BERRYDRIVER
                        notifyTextMain = self._i18n('nspanel-controller.panel.newBerryDriverTextMain')
                        currentVersion = self._updateVersionData.versions.current.berryDriver.version
                        latestVersion = self._updateVersionData.versions.latest.berryDriver.version
                    }

                    if (
                        self._updateVersionData.versionAcquisitionStatus &
                        VersionAcquisitionStatus.TasmotaUpdateAvailable
                    ) {
                        notifyId = NSPanelConstants.STR_UPDATE_FIRMWARE_TASMOTA
                        notifyTextMain = self._i18n('nspanel-controller.panel.newFirmwareTasmotaTextMain')
                        currentVersion = self._updateVersionData.versions.current.tasmota.version
                        latestVersion = self._updateVersionData.versions.latest.tasmota.version
                    }

                    if (notifyId != null) {
                        self.showUpdateNotification(notifyId, notifyTextMain, currentVersion, latestVersion)
                    }
                } else {
                    // TODO: initiate update process
                }
            })
            .catch((versionAcquisitionStatus) => {
                log.error(`Could not acquire version data ${versionAcquisitionStatus}`)
            })
    }

    public onFirmwareEvent(fwEvent: FirmwareEventArgs): void {
        switch (fwEvent?.event) {
            case 'version': {
                if (fwEvent.source === NSPanelConstants.STR_UPDATE_FIRMWARE_TASMOTA) {
                    this.setTasmotaVersion(fwEvent.version)
                } else if (fwEvent.source === NSPanelConstants.STR_UPDATE_FIRMWARE_BERRYDRIVER) {
                    this.setBerryDriverVersion(fwEvent.version)
                }
                break
            }

            case 'update': {
                if (fwEvent.status === 'success') {
                    this._updateInProgress = false
                    this.processUpdateTasks()
                }
                break
            }
        }
    }

    public onUpdateNotificationResult(notifyId: string, action: string): void {
        if (
            !NSPanelUtils.stringIsNullOrEmpty(notifyId) &&
            !NSPanelUtils.stringIsNullOrEmpty(action) &&
            NSPanelConstants.STR_LUI_NOTIFY_ACTION_YES === action
        ) {
            const confirmedFirmware =
                notifyId.indexOf(NSPanelConstants.STR_UPDATE_NOTIFY_PREFIX) === 0
                    ? notifyId.substring(NSPanelConstants.STR_UPDATE_NOTIFY_PREFIX.length)
                    : null

            switch (confirmedFirmware) {
                case NSPanelConstants.STR_UPDATE_FIRMWARE_TASMOTA:
                    this._updateTaskStack.push(NSPanelConstants.FIRMWARE_TASMOTA)
                    break

                case NSPanelConstants.STR_UPDATE_FIRMWARE_BERRYDRIVER:
                    this._updateTaskStack.push(NSPanelConstants.FIRMWARE_BERRYDRIVER)
                    break

                case NSPanelConstants.STR_UPDATE_FIRMWARE_HMI:
                    this._updateTaskStack.push(NSPanelConstants.FIRMWARE_HMI)
                    break
            }
            this.processUpdateTasks()
        }
    }

    private processUpdateTasks(): void {
        const fwTask: FirmwareType = this._updateTaskStack.pop()
        switch (fwTask) {
            case NSPanelConstants.FIRMWARE_TASMOTA:
                this._updateTasmotaFirmware()
                break

            case NSPanelConstants.FIRMWARE_BERRYDRIVER:
                this._updateBerryDriver()
                break

            case NSPanelConstants.FIRMWARE_HMI:
                this._updateHmi()
                break
        }
    }

    private _acquireVersions(): Promise<VersionAcquisitionStatus> {
        this._updateVersionData.versionAcquisitionStatus = VersionAcquisitionStatus.None

        this.getCurrentTasmotaVersion()
        this.getCurrentBerryDriverVersion()
        this.getCurrentHmiVersion()
        this.getLatestVersion()
        let i = 10

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this
        return new Promise((resolve, reject) => {
            ;(function waitForDataAcquisition() {
                if (
                    (self._updateVersionData.versionAcquisitionStatus & VersionAcquisitionStatus.AllAcquired) ===
                    VersionAcquisitionStatus.AllAcquired
                ) {
                    if (
                        semver.gt(
                            self._updateVersionData.versions.latest.tasmota.version,
                            self._updateVersionData.versions.current.tasmota.version
                        )
                    ) {
                        self._updateVersionData.versionAcquisitionStatus |=
                            VersionAcquisitionStatus.TasmotaUpdateAvailable
                    }

                    if (
                        self._updateVersionData.versions.latest.berryDriver.version >
                        self._updateVersionData.versions.current.berryDriver.version
                    ) {
                        self._updateVersionData.versionAcquisitionStatus |=
                            VersionAcquisitionStatus.BerryDriverUpdateAvailable
                    }
                    if (
                        self._updateVersionData.versions.latest.hmi.internalVersion >
                        self._updateVersionData.versions.current.hmi.internalVersion
                    ) {
                        self._updateVersionData.versionAcquisitionStatus |= VersionAcquisitionStatus.HmiUpdateAvailable
                    }

                    return resolve(self._updateVersionData.versionAcquisitionStatus)
                }

                setTimeout(waitForDataAcquisition, 1000)

                i -= 1
                if (i === 0) reject(self._updateVersionData.versionAcquisitionStatus)
            })()
        })
    }

    private _updateHmi(): void {
        if (this._updateInProgress) {
            this._updateTaskStack.push(NSPanelConstants.FIRMWARE_HMI)
            return
        }

        // TODO: build URL
        log.info('Initiating flashing NSPanel HMI firmware')
        const hmiFirmwareUrl = 'http://nspanel.pky.eu/lui-release.tft'

        this._updateInProgress = true
        this._mqttHandler?.sendCommandToPanel(NSPanelConstants.STR_BERRYDRIVER_CMD_FLASHNEXTION, {
            payload: hmiFirmwareUrl,
        })
        /*
UNCATCHED msg {"type":"","event":"","event2":"","source":"","data":{"Flashing":{"complete":0,"time_elapsed":0}}}
        */
    }

    private _updateBerryDriver(): void {
        if (this._updateInProgress) {
            this._updateTaskStack.push(NSPanelConstants.FIRMWARE_BERRYDRIVER)
            return
        }
        log.info('Updating NSPanel BerryDriver ')

        this._updateInProgress = true
        const updCmd = `${NSPanelConstants.STR_TASMOTA_CMD_BACKLOG} ${NSPanelConstants.STR_BERRYDRIVER_CMD_UPDATEDRIVER} ${URL_BERRYDRIVER_LATEST}; ${NSPanelConstants.STR_TASMOTA_CMD_RESTART} ${NSPanelConstants.STR_TASMOTA_PARAM_RESTART_SAVE_TO_FLASH}`
        this._mqttHandler?.sendCommandToPanel(NSPanelConstants.STR_TASMOTA_CMD_BACKLOG, { payload: updCmd })
    }

    private _updateTasmotaFirmware() {
        if (this._updateInProgress) {
            this._updateTaskStack.push(NSPanelConstants.FIRMWARE_TASMOTA)
            return
        }
        // FIXME: keep care of update stepping

        /*
onEvent default {"type":"hw","date":"2023-10-16T15:15:05.211Z","event":"","source":"","data":{"Upgrade":"Version 13.1.0 from http://ota.tasmota.com/tasmota32/release/tasmota32-nspanel.bin"}}        
        */
        const otaUrl = 'http://ota.tasmota.com/tasmota32/release/tasmota32-nspanel.bin' // FIXME

        this._updateInProgress = true
        this._mqttHandler?.sendCommandToPanel(NSPanelConstants.STR_TASMOTA_CMD_OTAURL, { payload: otaUrl })
        // TODO: sleep
        this._mqttHandler?.sendCommandToPanel(NSPanelConstants.STR_TASMOTA_CMD_UPGRADE, { payload: '1' })
        /*
        mqtt topic /stat/UPGRADE
        {
            "Upgrade": "Successful. Restarting"
        }
        */
    }

    private setTasmotaVersion(tasmotaVersion: string): void {
        if (tasmotaVersion != null) {
            const tV =
                tasmotaVersion.indexOf('(') > 0
                    ? tasmotaVersion.substring(0, tasmotaVersion.indexOf('('))
                    : tasmotaVersion
            this._updateVersionData.versions.current.tasmota = { version: tV }
            this._updateVersionData.versionAcquisitionStatus |= VersionAcquisitionStatus.TasmotaVersionCurrent
        }
    }

    private setBerryDriverVersion(version: string): void {
        if (version != null) {
            this._updateVersionData.versions.current.berryDriver = { version }
            this._updateVersionData.versionAcquisitionStatus |= VersionAcquisitionStatus.BerryDriverVersionCurrent
        }
    }

    public setHmiVersion(hmiVersion: HMIVersion): void {
        this._updateVersionData.versions.current.hmi = hmiVersion
        this._updateVersionData.versionAcquisitionStatus |= VersionAcquisitionStatus.HmiVersionCurrent
    }

    private showUpdateNotification(
        notifyId: string,
        notifyTextMain: string,
        currentVersion: string,
        latestVersion: string
    ) {
        const instruction: string =
            notifyTextMain +
            NSPanelConstants.STR_LUI_LINEBREAK +
            NSPanelConstants.STR_LUI_LINEBREAK +
            this._i18n('nspanel-controller.panel.currentFirmwareVersionPrefix') +
            currentVersion +
            NSPanelConstants.STR_LUI_LINEBREAK +
            this._i18n('nspanel-controller.panel.newFirmwareVersionPrefix') +
            latestVersion +
            NSPanelConstants.STR_LUI_LINEBREAK +
            NSPanelConstants.STR_LUI_LINEBREAK +
            this._i18n('nspanel-controller.panel.newFirmwarPerformUpdate')

        const notifyData: NotifyData = {
            notifyId: `${NSPanelConstants.STR_UPDATE_NOTIFY_PREFIX}${notifyId}`,
            icon: NSPanelConstants.STR_UPDATE_NOTIFY_ICON,
            text: instruction,
            heading: this._i18n('nspanel-controller.panel.newFirmwareTitle'),
            headingColor: NSPanelConstants.STR_LUI_COLOR_RED,
            timeout: 0,
            fontSize: 0,
            cancelColor: NSPanelConstants.STR_LUI_COLOR_RED,
            cancelText: this._i18n('nspanel-controller.panel.btnTextNo'),
            okColor: NSPanelConstants.STR_LUI_COLOR_GREEN,
            okText: this._i18n('nspanel-controller.panel.btnTextYes'),
        }
        this._panelController?.showNotification(notifyData)
    }

    // #region version information retrieval
    private getCurrentHmiVersion(): void {
        const data = { payload: NSPanelConstants.STR_LUI_CMD_ACTIVATE_STARTUP_PAGE }
        this._mqttHandler?.sendToPanel(data)
    }

    private getCurrentBerryDriverVersion(): void {
        const data = { payload: 'x' }
        this._mqttHandler?.sendCommandToPanel(NSPanelConstants.STR_BERRYDRIVER_CMD_GETVERSION, data)
    }

    private getCurrentTasmotaVersion(): void {
        const data = { payload: '2' }
        this._mqttHandler?.sendCommandToPanel(NSPanelConstants.STR_TASMOTA_CMD_STATUS, data)
    }

    private getLatestVersion(): void {
        axios.get<GithubApiReleaseSchema>(URL_TASMOTA_RELEASES_LATEST_META, axiosRequestOptions).then((response) => {
            const { data } = response
            if (data?.tag_name != null) {
                const tasmotaVersionLatest = String.prototype.substring.call(data.tag_name, 1)
                this._updateVersionData.versions.latest.tasmota = { version: tasmotaVersionLatest }
                this._updateVersionData.versionAcquisitionStatus |= VersionAcquisitionStatus.TasmotaVersionLatest
                // TODO: pick right asset
            }
        })

        axios.get<string>(URL_BERRYDRIVER_LATEST, axiosRequestOptions).then((response) => {
            if (response?.data != null) {
                const match = response.data.match(BERRY_DRIVER_REGEX)

                if (match?.groups != null && match.groups['version'] != null) {
                    this._updateVersionData.versions.latest.berryDriver = { version: `${match.groups['version']}` }
                    this._updateVersionData.versionAcquisitionStatus |=
                        VersionAcquisitionStatus.BerryDriverVersionLatest
                }
            }
        })

        /* TODOGithub data needed?
        axios.get<githubApiReleaseSchema>(URL_NLUI_RELEASES_LATEST_META, axiosRequestOptions).then((response) => {
            const { data } = response
            if (data?.tag_name != null) {
                const hmiVersionLatest = String.prototype.substring.call(data.tag_name, 1)
                this.updateData.latest.hmi = { version: hmiVersionLatest }
                // TODO: pick right asset
            }
        }) */

        axios.get<string>(URL_NLUI_LATEST, axiosRequestOptions).then((response) => {
            if (response?.data != null) {
                const match = response.data.match(NLUI_HMI_VERSION_REGEX)

                if (match?.groups != null && match.groups['version'] != null && match.groups['internalVersion']) {
                    this._updateVersionData.versions.latest.hmi = {
                        internalVersion: `${match.groups['internalVersion']}`,
                        version: `${match.groups['version']}`,
                    }
                    this._updateVersionData.versionAcquisitionStatus |= VersionAcquisitionStatus.HmiVersionLatest
                }
            }
        })
    }
    // #endregion version information retrieval

    public dispose(): void {}
}
