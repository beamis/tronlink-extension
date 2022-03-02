import Logger from '@litetokenslink/lib/logger';
import EventEmitter from 'eventemitter3';
import StorageService from '../StorageService';
import NodeService from '../NodeService';
import Account from './Account';
import axios from 'axios';
import extensionizer from 'extensionizer';

import {
    APP_STATE,
    ACCOUNT_TYPE
} from '@litetokenslink/lib/constants';

const logger = new Logger('WalletService');

class Wallet extends EventEmitter {
    constructor() {
        super();

        this.state = APP_STATE.UNINITIALISED;
        this.selectedAccount = false;
        this.isConfirming = false;
        this.popup = false;
        this.accounts = {};
        this.contractWhitelist = {};
        this.confirmations = [];

        // This should be moved into its own component
        this.isPolling = false;
        this.shouldPoll = false;

        this._checkStorage();

        setInterval(() => {
            this._updatePrice();
        }, 30 * 60 * 1000);
    }

    async _checkStorage() {
        if(await StorageService.dataExists() || StorageService.needsMigrating)
            this._setState(APP_STATE.PASSWORD_SET);
    }

    migrate(password) {
        if(!StorageService.needsMigrating) {
            logger.info('No migration required');
            return false;
        }

        StorageService.authenticate(password);

        const {
            error = false,
            accounts,
            selectedAccount
        } = StorageService.migrate();

        if(error)
            return false;

        localStorage.setItem('LitetokensLink_WALLET.bak', localStorage.getItem('LitetokensLink_WALLET'));
        localStorage.removeItem('LitetokensLink_WALLET');

        accounts.forEach(account => (
            this.importAccount(account)
        ));

        this.selectAccount(selectedAccount);

        // Force "Reboot" LitetokensLink
        this.state = APP_STATE.PASSWORD_SET;
        StorageService.ready = false;

        this.unlockWallet(StorageService.password);

        return true;
    }

    _setState(appState) {
        if(this.state === appState)
            return;

        logger.info(`Setting app state to ${ appState }`);

        this.state = appState;
        this.emit('newState', appState);

        return appState;
    }

    _loadAccounts() {
        const accounts = StorageService.getAccounts();
        const selected = StorageService.selectedAccount;

        Object.entries(accounts).forEach(([ address, account ]) => {
            const accountObj = new Account(
                account.type,
                account.mnemonic || account.privateKey,
                account.accountIndex
            );

            accountObj.loadCache();
            accountObj.update();

            this.accounts[ address ] = accountObj;
        });

        this.selectedAccount = selected;
    }

    async _pollAccounts() {
        if(!this.shouldPoll) {
            logger.info('Stopped polling');
            return this.isPolling = false;
        }

        if(this.isPolling)
            return;

        this.isPolling = true;
        const accounts = Object.values(this.accounts);

        // We could show a loading indicator for each
        // individual account, and publish updates accordingly
        // instead of in bulk

        for(const account of accounts) {
            await account.update();

            account.updateTransactions()
                .then(() => {
                    if(account.address === this.selectedAccount)
                        this.emit('setAccount', account.address);

                    this.emit('setAccounts', this.getAccounts());
                });

            if(account.address === this.selectedAccount)
                this.emit('setAccount', account.address);

            this.emit('setAccounts', this.getAccounts());
        }

        this.isPolling = false;

        setTimeout(() => (
            this._pollAccounts()
        ), 10 * 1000);
    }

    async _updatePrice() {
        if(!StorageService.ready)
            return;

        const prices = await axios('https://min-api.cryptocompare.com/data/price?fsym=TRX&tsyms=USD,GBP,EUR,BTC,ETH')
            .then(res => res.data)
            .catch(err => logger.error(err), false);

        if(!prices)
            return logger.warn('Failed to update prices');

        StorageService.setPrices(prices);
        this.emit('setPriceList', prices);
    }

    selectCurrency(currency) {
        StorageService.selectCurrency(currency);
        this.emit('setCurrency', currency);
    }

    async _updateWindow() {
        return new Promise(resolve => {
            if(typeof chrome !== 'undefined') {
                return extensionizer.windows.update(this.popup.id, { focused: true }, window => {
                    resolve(!!window);
                });
            }

            extensionizer.windows.update(this.popup.id, {
                focused: true
            }).then(resolve).catch(() => resolve(false));
        });
    }

    async _openPopup() {
        if(this.popup && this.popup.closed)
            this.popup = false;

        if(this.popup && await this._updateWindow())
            return;

        if(typeof chrome !== 'undefined') {
            return extensionizer.windows.create({
                url: 'packages/popup/build/index.html',
                type: 'popup',
                width: 436,
                height: 636,
                left: 25,
                top: 25
            }, window => this.popup = window);
        }

        this.popup = await extensionizer.windows.create({
            url: 'packages/popup/build/index.html',
            type: 'popup',
            width: 436,
            height: 636,
            left: 25,
            top: 25
        });
    }

    _closePopup() {
        if(this.confirmations.length)
            return;

        if(!this.popup)
            return;

        extensionizer.windows.remove(this.popup.id);
        this.popup = false;
    }

    startPolling() {
        if(this.isPolling && this.shouldPoll)
            return; // Don't poll if already polling

        if(this.pollg && !this.shouldPoll)
            return this.shouldPoll = true;

        logger.info('Started polling');

        this.shouldPoll = true;
        this._pollAccounts();
    }

    stopPolling() {
        this.shouldPoll = false;
    }

    changeState(appState) {
        if(![ APP_STATE.RESTORING, APP_STATE.CREATING ].includes(appState))
            return logger.error(`Attempted to change app state to ${ appState }. Only 'restoring' and 'creating' is permitted`);

        this._setState(appState);
    }

    async resetState() {
        logger.info('Resetting app state');

        if(!await StorageService.dataExists())
            return this._setState(APP_STATE.UNINITIALISED);

        if(!StorageService.hasAccounts && !StorageService.ready)
            return this._setState(APP_STATE.PASSWORD_SET);

        if(!StorageService.hasAccounts && StorageService.ready)
            return this._setState(APP_STATE.UNLOCKED);

        if(StorageService.needsMigrating)
            return this._setState(APP_STATE.MIGRATING);

        if(this.state === APP_STATE.REQUESTING_CONFIRMATION && this.confirmations.length)
            return;

        this._setState(APP_STATE.READY);
    }

    // We shouldn't handle requests directly in WalletService.
    setPassword(password) {
        if(this.state !== APP_STATE.UNINITIALISED)
            return Promise.reject('ERRORS.ALREADY_INITIALISED');

        StorageService.authenticate(password);
        StorageService.save();
        NodeService.save();

        this._updatePrice();

        logger.info('User has set a password');
        this._setState(APP_STATE.UNLOCKED);

        const node = NodeService.getCurrentNode();

        this.emit('setNode', {
            fullNode: node.fullNode,
            solidityNode: node.solidityNode,
            eventServer: node.eventServer
        });
    }

    async unlockWallet(password) {
        if(this.state !== APP_STATE.PASSWORD_SET) {
            logger.error('Attempted to unlock wallet whilst not in PASSWORD_SET state');
            return Promise.reject('ERRORS.NOT_LOCKED');
        }

        if(StorageService.needsMigrating) {
            const success = this.migrate(password);

            if(!success)
                return Promise.reject('ERRORS.INVALID_PASSWORD');

            return;
        }

        const unlockFailed = await StorageService.unlock(password);

        if(unlockFailed) {
            logger.error(`Failed to unlock wallet: ${ unlockFailed }`);
            return Promise.reject(unlockFailed);
        }

        if(!StorageService.hasAccounts) {
            logger.info('Wallet does not have any accounts');
            return this._setState(APP_STATE.UNLOCKED);
        }

        NodeService.init();

        this._loadAccounts();
        this._updatePrice();

        this._setState(APP_STATE.READY);

        const node = NodeService.getCurrentNode();

        this.emit('setNode', {
            fullNode: node.fullNode,
            solidityNode: node.solidityNode,
            eventServer: node.eventServer
        });

        this.emit('setAccount', this.selectedAccount);
    }

    queueConfirmation(confirmation, uuid, callback) {
        this.confirmations.push({
            confirmation,
            callback,
            uuid
        });

        if(this.state !== APP_STATE.REQUESTING_CONFIRMATION)
            this._setState(APP_STATE.REQUESTING_CONFIRMATION);

        logger.info('Added confirmation to queue', confirmation);

        this.emit('setConfirmations', this.confirmations);
        this._openPopup();
    }

    whitelistContract(confirmation, duration) {
        const {
            input: {
                contract_address: address
            },
            contractType,
            hostname
        } = confirmation;

        if(!address)
            return Promise.reject('INVALID_CONFIRMATION');

        if(contractType !== 'TriggerSmartContract')
            return Promise.reject('INVALID_CONFIRMATION');

        if(!this.contractWhitelist[ address ])
            this.contractWhitelist[ address ] = {};

        this.contractWhitelist[ address ][ hostname ] = (
            duration === -1 ?
                -1 :
                Date.now() + duration
        );

        logger.info(`Added contact ${ address } on host ${ hostname } with duration ${ duration } to whitelist`);

        this.acceptConfirmation();
    }

    acceptConfirmation(whitelistDuration) {
        if(!this.confirmations.length)
            return Promise.reject('NO_CONFIRMATIONS');

        if(this.isConfirming)
            return Promise.reject('ALREADY_CONFIRMING');

        this.isConfirming = true;

        const {
            confirmation,
            callback,
            uuid
        } = this.confirmations.pop();

        if(whitelistDuration !== false)
            this.whitelistContract(confirmation, whitelistDuration);

        callback({
            success: true,
            data: confirmation.signedTransaction,
            uuid
        });

        this.isConfirming = false;

        this.emit('setConfirmations', this.confirmations);
        this._closePopup();

        this.resetState();
    }

    rejectConfirmation() {
        if(this.isConfirming)
            return Promise.reject('ALREADY_CONFIRMING');

        this.isConfirming = true;

        const {
            callback,
            uuid
        } = this.confirmations.pop();

        callback({
            success: false,
            data: 'Confirmation declined by user',
            uuid
        });

        this.isConfirming = false;

        this.emit('setConfirmations', this.confirmations);
        this._closePopup();

        this.resetState();
    }

    addAccount({ mnemonic, name }) {
        logger.info(`Adding account '${ name }' from popup`);

        const account = new Account(
            ACCOUNT_TYPE.MNEMONIC,
            mnemonic
        );

        const {
            address
        } = account;

        account.name = name;

        this.accounts[ address ] = account;
        StorageService.saveAccount(account);

        this.emit('setAccounts', this.getAccounts());
        this.selectAccount(address);
    }

    // This and the above func should be merged into one
    importAccount({ privateKey, name }) {
        logger.info(`Importing account '${ name }' from popup`);

        const account = new Account(
            ACCOUNT_TYPE.PRIVATE_KEY,
            privateKey
        );

        const {
            address
        } = account;

        account.name = name;

        this.accounts[ address ] = account;
        StorageService.saveAccount(account);

        this.emit('setAccounts', this.getAccounts());
        this.selectAccount(address);
    }

    selectAccount(address) {
        StorageService.selectAccount(address);
        NodeService.setAddress();

        this.selectedAccount = address;

        this.emit('setAccount', address);
    }

    selectNode(nodeID) {
        NodeService.selectNode(nodeID);

        Object.values(this.accounts).forEach(account => (
            account.reset()
        ));

        this._pollAccounts();
        const node = NodeService.getCurrentNode();

        this.emit('setNode', {
            fullNode: node.fullNode,
            solidityNode: node.solidityNode,
            eventServer: node.eventServer
        });

        this.emit('setAccounts', this.getAccounts());
        this.emit('setAccount', this.selectedAccount);
    }

    addNode(node) {
        this.selectNode(
            NodeService.addNode(node)
        );
    }

    getAccounts() {
        const accounts = Object.entries(this.accounts).reduce((accounts, [ address, account ]) => {
            accounts[ address ] = {
                name: account.name,
                balance: account.balance,
                bandwidth: account.bandwidth,
                energy: account.energy,
                tokenCount: Object.keys(account.tokens.basic).length + Object.keys(account.tokens.smart).length
            };

            return accounts;
        }, {});

        return accounts;
    }

    getAccountDetails(address) {
        if(!address) {
            return {
                tokens: {
                    basic: {},
                    smart: {}
                },
                type: false,
                name: false,
                address: false,
                balance: 0,
                transactions: {
                    cached: [],
                    uncached: 0
                }
            };
        }

        return this.accounts[ address ].getDetails();
    }

    getSelectedAccount() {
        if(!this.selectedAccount)
            return false;

        return this.getAccountDetails(this.selectedAccount);
    }

    getAccount(address) {
        return this.accounts[ address ];
    }

    deleteAccount() {
        delete this.accounts[ this.selectedAccount ];
        StorageService.deleteAccount(this.selectedAccount);

        this.emit('setAccounts', this.getAccounts());

        if(!Object.keys(this.accounts).length) {
            this.selectAccount(false);
            return this._setState(APP_STATE.UNLOCKED);
        }

        this.selectAccount(Object.keys(this.accounts)[ 0 ]);
    }

    async addSmartToken(token) {
        const {
            selectedAccount: address
        } = this;

        await this.accounts[ address ].addSmartToken(token);
        this.emit('setAccount', address);
    }

    getPrices() {
        return StorageService.prices;
    }

    getConfirmations() {
        return this.confirmations;
    }

    async sendTrx({ recipient, amount }) {
        await this.accounts[ this.selectedAccount ].sendTrx(
            recipient,
            amount
        );

        this._pollAccounts();
    }

    async sendBasicToken({ recipient, amount, token }) {
        await this.accounts[ this.selectedAccount ].sendBasicToken(
            recipient,
            amount,
            token
        );

        this._pollAccounts();
    }

    async sendSmartToken({ recipient, amount, token }) {
        await this.accounts[ this.selectedAccount ].sendSmartToken(
            recipient,
            amount,
            token
        );

        this._pollAccounts();
    }

    exportAccount() {
        const {
            mnemonic,
            privateKey
        } = this.accounts[ this.selectedAccount ];

        return {
            mnemonic: mnemonic || false,
            privateKey
        };
    }
}

export default Wallet;