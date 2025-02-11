import { ILogger, Logger } from './logger'
import { NodeBase } from './node-base'
import { DEFAULT_LUI_COLOR, STR_LUI_DELIMITER } from './nspanel-constants'
import { NSPanelMessageUtils } from './nspanel-message-utils'
import { NSPanelUtils } from './nspanel-utils'
import { NSPanelColorUtils } from './nspanel-colorutils'
import { SimplePageCache } from './nspanel-page-cache'
import {
    IPanelNode,
    PageConfig,
    NodeRedOnErrorCallback,
    NodeRedSendCallback,
    EventArgs,
    EventMapping,
    ConfiguredEventsMap,
    PageInputMessage,
    PageEntityData,
    PageOptions,
    PageData,
    NodeAPI,
    IPageCache,
    IPageNode,
    InputHandlingResult,
    HMICommand,
    CommandData,
    SwitchCommandParams,
} from '../types/types'
import * as NSPanelConstants from './nspanel-constants'

export class PageNodeBase<TConfig extends PageConfig> extends NodeBase<TConfig> implements IPageNode {
    private panelNode: IPanelNode | null = null

    private pageNodeConfig: TConfig

    protected options: PageOptions | null = null

    private __log: ILogger | null = null

    private _cache: IPageCache = null

    private pageData: PageData = {
        entities: [],
    }

    private configuredEvents: ConfiguredEventsMap = new Map()

    private isActive = false

    constructor(config: TConfig, RED: NodeAPI, options: PageOptions) {
        super(config, RED)
        this.pageNodeConfig = config
        this.options = options

        this.__log = Logger(this.constructor.name)

        this._cache = new SimplePageCache()

        this.initPageNode(config, options)
        const panelNode = (<unknown>RED.nodes.getNode(config.nsPanel)) as IPanelNode
        if (!panelNode || panelNode.type !== 'nspanel-panel') {
            this.warn('Panel configuration is wrong or missing, please review the node settings')
            this.status({
                fill: 'red',
                shape: 'dot',
                text: RED._('common.status.notAssignedToAPanel'),
            })
        } else {
            this.panelNode = panelNode
            this.registerAtPanel()
        }

        this.on('close', (done: () => void) => this.onClose(done))
        this.on('input', (msg, send, done) => this.onInput(msg, send, done))
    }

    public getTimeout() {
        if (this.pageNodeConfig.timeout === null || this.pageNodeConfig.timeout === '') return null

        const num = Number(this.pageNodeConfig.timeout)
        return Number.isNaN(num) ? null : num
    }

    public getPageType() {
        if (this.options == null) throw new Error('Illegal state')
        return this.options.pageType
    }

    public isForceRedraw(): boolean {
        return this.options?.forceRedraw ?? false
    }

    public generatePage(): HMICommand | HMICommand[] | null {
        if (this.getCache().containsData()) return this.getCache().get()

        const pageData = this.doGeneratePage()
        this.getCache().put(pageData)

        return pageData
    }

    protected doGeneratePage(): HMICommand | HMICommand[] | null {
        return null
    }

    public generatePopupDetails(_type: string, _entityId: string): HMICommand | HMICommand[] | null {
        return null
    }

    public isScreenSaver() {
        return false
    }

    public setActive(state: boolean) {
        this.isActive = state
        if (state) {
            this.setNodeStatus('success', 'common.status.active')
        } else {
            this.clearNodeStatus()
        }
    }

    public getPanel() {
        return this.panelNode
    }

    protected generateTitleNav() {
        // TODO: feature-request: retrieve icons from nav target
        let navPrev: string
        let navNext: string

        const navPrevEventMappings: EventMapping[] = this.pageNodeConfig.events.filter(
            (item) => item.event === NSPanelConstants.STR_NAV_ID_PREVIOUS
        )
        const navNextEventMappings: EventMapping[] = this.pageNodeConfig.events.filter(
            (item) => item.event === NSPanelConstants.STR_NAV_ID_NEXT
        )

        if (navPrevEventMappings[0] != null) {
            const item = navPrevEventMappings[0]
            navPrev = NSPanelUtils.makeEntity(
                NSPanelConstants.STR_LUI_ENTITY_BUTTON,
                NSPanelConstants.STR_NAV_ID_PREVIOUS,
                NSPanelUtils.getIcon(item.icon ?? ''),
                NSPanelColorUtils.toHmiColor(item.iconColor ?? DEFAULT_LUI_COLOR)
            )
        } else {
            navPrev = NSPanelUtils.makeEntity(NSPanelConstants.STR_LUI_ENTITY_NONE)
        }

        if (navNextEventMappings[0] != null) {
            const item = navNextEventMappings[0]
            navNext = NSPanelUtils.makeEntity(
                NSPanelConstants.STR_LUI_ENTITY_BUTTON,
                NSPanelConstants.STR_NAV_ID_PREVIOUS,
                NSPanelUtils.getIcon(item.icon ?? ''),
                NSPanelColorUtils.toHmiColor(item.iconColor ?? DEFAULT_LUI_COLOR)
            )
        } else {
            navNext = NSPanelUtils.makeEntity(NSPanelConstants.STR_LUI_ENTITY_NONE)
        }

        return navPrev + STR_LUI_DELIMITER + navNext
    }

    protected getPageData(): PageData {
        return this.pageData
    }

    protected requestUpdate(): void {
        if (this.isActive) {
            this.emit('page:update', this)
        }
    }

    protected sendToPanel(data: HMICommand | HMICommand[]): void {
        this.emit('page:send', this, data)
    }

    protected prePageNavigationEvent(_eventArgs: EventArgs, _eventConfig: EventMapping): boolean {
        return true
    }

    private handlePageNavigationEvent(_eventArgs: EventArgs, eventConfig: EventMapping): void {
        this.emit('nav:pageId', eventConfig.value)
    }

    private handlePageMessageEvent(_eventArgs: EventArgs, eventConfig: EventMapping, send: NodeRedSendCallback): void {
        if (eventConfig.value == null) return

        const outMsg = {}
        let data: any

        switch (eventConfig.dataType) {
            case 'str':
                data = eventConfig.data
                break

            case 'json':
                try {
                    data = eventConfig.data ? JSON.parse(eventConfig.data) : undefined
                } catch (err: unknown) {
                    this.warn('Data not JSON compliant, sending as string')
                    data = eventConfig.data
                }
                break
        }

        // TODO: handle other data
        outMsg[eventConfig.value] = data
        if (!NSPanelUtils.stringIsNullOrEmpty(eventConfig.msgTopic)) {
            outMsg['topic'] = eventConfig.msgTopic
        }

        send(outMsg)
    }

    private initPageNode(config: TConfig, _options: PageOptions): void {
        this.clearNodeStatus()

        // build event mapping index
        const allEventsMappings = config.events ?? []
        const cfgEvents: ConfiguredEventsMap = new Map()
        allEventsMappings.forEach((eventMapping) => {
            cfgEvents.set(eventMapping.event, eventMapping)
        })

        this.configuredEvents = cfgEvents
    }

    protected handleInput(_msg: PageInputMessage, _send: NodeRedSendCallback): InputHandlingResult {
        return {
            handled: false,
        }
    }

    private onInput(msg: PageInputMessage, send: NodeRedSendCallback, done: NodeRedOnErrorCallback): void {
        // forward message to node output
        send(msg) // TODO: really? or just consume?

        if (NSPanelMessageUtils.hasProperty(msg, 'topic', true)) {
            switch (msg.topic) {
                case NSPanelConstants.STR_MSG_TOPIC_EVENT: {
                    const eventArgs = <EventArgs>msg.payload
                    const uiEventHandled = this.handleUiEventInternal(eventArgs, send)
                    if (!uiEventHandled) {
                        this.handleInputInternal(msg, send)
                    }
                    break
                }

                default: {
                    const handled = this.handleInputInternal(msg, send)
                    if (handled) {
                        this.requestUpdate()
                    }
                    break
                }
            }
        }

        done()
    }

    private handleInputInternal(msg: PageInputMessage, send: NodeRedSendCallback): InputHandlingResult {
        let inputResult: InputHandlingResult = { handled: false }

        try {
            inputResult = this.handleInput(msg, send)
        } catch (err: unknown) {
            if (err instanceof Error) {
                this.__log?.error(`Error handling input: ${err.message}`)
            }
        }

        if (inputResult.handled === false) {
            switch (msg.topic) {
                case NSPanelConstants.STR_MSG_TOPIC_DATA:
                    inputResult = this.handleDataInputInternal(msg, send)
                    break
            }
        }

        return inputResult
    }

    private handleDataInputInternal(msg: PageInputMessage, _send: NodeRedSendCallback): InputHandlingResult {
        const result: PageEntityData[] = []

        // TODO: take msg.parts or index into account to allow to set specific status
        const entityInputData = Array.isArray(msg.payload) ? msg.payload : [msg.payload]

        entityInputData.forEach((item, _idx) => {
            const conversionResult = NSPanelMessageUtils.convertToEntityItemData(item)
            result.push(conversionResult)
        })

        this.pageData.entities = result.slice(0, this.options?.maxEntities ?? 0)
        return { handled: true }
    }

    protected getConfiguredEvents(): ConfiguredEventsMap {
        return this.configuredEvents
    }

    protected preHandleUiEvent(_eventArgs: EventArgs, _send: NodeRedSendCallback): boolean {
        return false
    }

    private handleUiEventInternal(eventArgs: EventArgs, send: NodeRedSendCallback): boolean {
        let handled = false

        const preHandleUiEventResult = this.preHandleUiEvent(eventArgs, send)
        if (preHandleUiEventResult === true) {
            return preHandleUiEventResult
        }

        // translate possible hardware button press when hw buttons do not controll power outputs (@see
        const event2 = eventArgs.type === 'hw' ? `${eventArgs.type}.${eventArgs.source}` : eventArgs.event2

        // event mapped in config?
        if (event2 != null && this.configuredEvents.has(event2)) {
            const cfgEvent = this.configuredEvents.get(event2)

            handled = this.handleConfiguredEvent(eventArgs, cfgEvent, send)
        }

        return handled
    }

    protected handleConfiguredEvent(eventArgs: EventArgs, cfgEvent: EventMapping, send: NodeRedSendCallback): boolean {
        let handled: boolean = false
        if (cfgEvent) {
            switch (cfgEvent.t) {
                // mapped to navigation action
                case 'page': {
                    const preHandleResult = this.prePageNavigationEvent(eventArgs, cfgEvent)
                    if (preHandleResult !== false) {
                        this.handlePageNavigationEvent(eventArgs, cfgEvent)
                    }
                    handled = true
                    break
                }

                case 'relay1':
                case 'relay2': {
                    const relayNum = cfgEvent.t === 'relay1' ? 0 : 1
                    const relayCmd = cfgEvent.value === 'toggle' ? 'toggle' : 'switch'
                    const relayCmdParams: SwitchCommandParams = {
                        id: relayNum,
                    }
                    if (relayCmd === 'switch') {
                        relayCmdParams.active = cfgEvent.value === 'on'
                    }

                    const cmdData: CommandData = {
                        cmd: relayCmd,
                        params: relayCmdParams,
                    }
                    this.emit('page:cmd', this, cmdData)
                    handled = true

                    break
                }

                // mapped to out msg
                case 'msg': {
                    this.handlePageMessageEvent(eventArgs, cfgEvent, send)
                    handled = true
                    break
                }
            }
        }

        return handled
    }

    private registerAtPanel(): void {
        this.panelNode?.registerPage(this)
    }

    private onClose(done: () => void) {
        this.panelNode?.deregisterPage(this)
        done()
    }

    protected getCache(): IPageCache {
        return this._cache
    }
}
