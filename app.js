'use strict';

const Homey = require('homey');
const flowActions = require('./lib/flows/actions');
const { splitTime, formatToken, calculationType } = require('./lib/helpers');

const _settingsKey = `${Homey.manifest.id}.settings`;

class App extends Homey.App {
    log() {
        console.log.bind(this, '[log]').apply(this, arguments);
    }

    error() {
        console.error.bind(this, '[error]').apply(this, arguments);
    }

    // -------------------- INIT ----------------------

    async onInit() {
        this.log(`${this.homey.manifest.id} - ${this.homey.manifest.version} started...`);

        await this.initSettings();
        await this.setTokens(this.appSettings.VARIABLES);

        this.log('[onInit] - Loaded settings', this.appSettings);

        await flowActions.init(this);
    }

    // -------------------- SETTINGS ----------------------

    async initSettings() {
        try {
            let settingsInitialized = false;
            this.homey.settings.getKeys().forEach((key) => {
                if (key == _settingsKey) {
                    settingsInitialized = true;
                }
            });

            this.TOKENS = {};

            this.defaultOptions = {
                name: null,
                dateStart: null,
                comparison: null
            };

            if (settingsInitialized) {
                this.log('[initSettings] - Found settings key', _settingsKey);
                this.appSettings = this.homey.settings.get(_settingsKey);
            } else {
                this.log(`Initializing ${_settingsKey} with defaults`);
                await this.updateSettings({
                    VARIABLES: [],
                    COMPARISONS: [],
                    TOTALS: []
                });
            }
        } catch (err) {
            this.error(err);
        }
    }

    async updateSettings(settings, update = false) {
        try {
            this.log('[updateSettings] - New settings:', settings);
            const oldSettings = this.appSettings;
            this.appSettings = settings;

            await this.homey.settings.set(_settingsKey, this.appSettings);

            if (update) {
                await this.setTokens(settings.VARIABLES, oldSettings.VARIABLES);
            }
        } catch (err) {
            this.error(err);
        }
    }

    async setTokens(newSettings, oldSettings = []) {
        newSettings.forEach((t) => {
            this.createToken(t, 'duration');
            this.createToken(t, 'currency', null, 'string');
            this.createToken(t, 'comparison', null, 'number');
            this.createToken(t, 'calculation', null, 'number');
        });

        if (oldSettings.length) {
            const difference = oldSettings.filter((x) => !newSettings.includes(x));
            difference.forEach((d) => {
                this.removeToken(d, 'duration');
                this.removeToken(d, 'currency');
                this.removeToken(d, 'comparison');
                this.removeToken(d, 'calculation');
            });
        }
    }

    async createToken(name, src = null, value = null, type = 'string') {
        const suffix = this.homey.__(`helpers.${src}`);
        let title = `${name} ${suffix}`;

        const id = formatToken(title);

        if (!this.TOKENS[id]) {
            this.TOKENS[id] = await this.homey.flow.createToken(id, {
                type,
                title
            });
            this.log(`[createToken] - created Token => ID: ${id} - Title: ${title} - Type: ${type} - Value: ${value}`);
        }

        await this.TOKENS[id].setValue(value);
    }

    async removeToken(name, src) {
        const suffix = this.homey.__(`helpers.${src}`);
        let title = `${name} ${suffix}`;
        const id = formatToken(title);

        if (this.TOKENS[id]) {
            await this.TOKENS[id].unregister();
            this.log(`[removeToken] - removed Token => ID: ${id} - Title: ${title}`);
        }
    }

    // -------------------- FUNCTIONS ----------------------

    async action_START(paramOptions) {
        const options = { ...this.defaultOptions, ...paramOptions };
        const { name, dateStart, comparison } = options;
        const date = dateStart ? new Date() : dateStart;
        const newSettings = this.appSettings.COMPARISONS.filter((setting) => setting.name !== name);

        await this.updateSettings({
            ...this.appSettings,
            COMPARISONS: [...newSettings, { name, date, comparison }]
        });
    }

    async action_END(name, value = null) {
        this.homey.app.log('[action_END]: ', name);
        const existing_comparison = this.appSettings.COMPARISONS.find((x) => x.name === name);
        const date = existing_comparison.date ? new Date() : null;

        if (!existing_comparison) {
            throw new Error(`No comparison found for ${name}`);
        } else {
            this.homey.app.log('[action_END]: found existing comparison', existing_comparison);
        }

        const duration = date ? this.calculateDuration(existing_comparison.date, date) : null;
        const comparison = value ? this.calculateComparison(existing_comparison.comparison, value) : null;

        const totals = this.appSettings.TOTALS.filter((total) => total.name !== name);

        await this.updateSettings({
            ...this.appSettings,
            TOTALS: [...totals, { name, duration, comparison }]
        });

        await this.createToken(name, 'duration', duration);
        if (comparison) {
            await this.createToken(name, 'comparison', parseFloat(comparison), 'number');
        }
    }

    async action_SET_CURRENCY(token, number, currency) {
        const setLocalCurrency = number.toLocaleString(this.homey.__('helpers.locale'), { style: 'currency', currency: currency });
        this.homey.app.log('action_SET_CURRENCY - args', token, number, currency, setLocalCurrency);

        await this.createToken(token, 'currency', setLocalCurrency);
    }

    async action_CALCULATION(token, calcType, number1, number2) {
        const calculation = calculationType(calcType, number1, number2);
        this.homey.app.log('action_CALCULATION - args', token, calcType, number1, number2, calculation);

        await this.createToken(token, 'calculation', calculation);
    }

    calculateDuration(startDate, endDate) {
        const diffInMilliseconds = Math.abs(startDate - endDate) / 1000;
        return splitTime(diffInMilliseconds, this.homey.__);
    }

    calculateComparison(start, end) {
        const comparison = parseFloat(end) - parseFloat(start);
        return comparison ? comparison.toFixed(2) : 0;
    }
}

module.exports = App;
