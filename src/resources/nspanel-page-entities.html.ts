;(function ($) {
    const allValidEvents = NSPanelLui.Events.allNavigationEvents

    const MAX_ENTITIES = 4
    const ALLOWED_ENTITIES = [
        'delete',
        'shutter',
        'light',
        'fan',
        'input_sel',
        'timer',
        'switch',
        'number',
        'button',
        'text',
    ]

    var editableEventList, editableEntitiesList

    RED.nodes.registerType('nspanel-page-entities', {
        category: 'NSPanel',
        paletteLabel: NSPanelLui._('label.palette', 'nspanel-page-entities'),

        inputs: 1,
        outputs: 1,

        icon: 'font-awesome/fa-television',
        color: 'rgb( 50, 120, 190)',

        defaults: {
            name: { value: '' },
            title: { value: '' },
            nsPanel: { type: 'nspanel-panel', required: true },
            timeout: { value: null },
            events: { value: [] },
            entities: { value: [] },
        },

        label: function () {
            return NSPanelLui.Editor.util.getNodeLabel(this)
        },

        oneditprepare: function () {
            var self = this

            var eventInputControl = $('#node-input-event-control')

            // keep track of assigned NSPanel
            var nsPanelInputField = $('#node-input-nsPanel')
            var nsPanelInputField_lastVal = this.nsPanel
            nsPanelInputField.on('change', function () {
                if (nsPanelInputField.val() == '_ADD_') {
                    eventInputControl.hide()
                } else {
                    //TODO remove all events? ... keep track of original nsPanelId
                    if (nsPanelInputField.val() != nsPanelInputField_lastVal) eventInputControl.empty()
                    eventInputControl.show()
                }
            })
            nsPanelInputField.change()

            editableEntitiesList = NSPanelLui.Editor.make.editableEntitiesList(
                this,
                '#node-input-entities-control',
                MAX_ENTITIES,
                this.entities,
                ALLOWED_ENTITIES
            )

            // assignable event list editor
            editableEventList = NSPanelLui.Editor.make.editableEventList(
                this,
                '#node-input-event-control',
                allValidEvents,
                this.events
            )

            var tabs = RED.tabs.create({
                id: 'nspanel-page-tabs',
                onchange: function (tab) {
                    $('#nspanel-page-tabs-content').children().hide()
                    $('#' + tab.id).show()
                },
            })
            tabs.addTab({
                id: 'nspanel-page-tab-general',
                iconClass: 'fa fa-cog',
                label: NSPanelLui._('label.general', 'nspanel-panel', 'common'),
            })
            tabs.addTab({
                id: 'nspanel-page-tab-entities',
                iconClass: 'fa fa-list',
                label: NSPanelLui._('label.entities', 'nspanel-panel', 'common'),
            })
            tabs.addTab({
                id: 'nspanel-page-tab-events',
                iconClass: 'fa fa-list',
                label: NSPanelLui._('label.events', 'nspanel-panel', 'common'),
            })
        },
        oneditsave: function () {
            this.events = editableEventList.getEvents() || []
            this.entities = editableEntitiesList.getEntities() || []

            if (!NSPanelLui.Editor.validate.stringIsNotNullOrEmpty(this.timeout)) {
                this.timeout = undefined
            }
        },
    })
})(jQuery)
