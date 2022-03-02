import Logger from '@litetokenslink/lib/logger';
import MessageDuplex from '@litetokenslink/lib/MessageDuplex';
import NodeService from './services/NodeService';
import StorageService from './services/StorageService';
import WalletService from './services/WalletService';
import Utils from '@litetokenslink/lib/utils';
import transactionBuilder from '@litetokenslink/lib/transactionBuilder';

import * as Sentry from '@sentry/browser';

import { CONFIRMATION_TYPE } from '@litetokenslink/lib/constants';
import { BackgroundAPI } from '@litetokenslink/lib/api';
import { version } from './package.json';

// Make error reporting user-configurable
Sentry.init({
    dsn: 'https://4757a0fdd2e743d48c184f75a179dffe@sentry.io/1273081',
    release: `LitetokensLink@${ version }`
});

const duplex = new MessageDuplex.Host();
const logger = new Logger('backgroundScript');

const backgroundScript = {
    walletService: Utils.requestHandler(
        new WalletService()
    ),

    nodeService: Utils.requestHandler(NodeService),

    run() {
        BackgroundAPI.init(duplex);

        this.bindPopupDuplex();
        this.bindTabDuplex();
        this.bindWalletEvents();
    },

    bindPopupDuplex() {
        // Popup Handling (For transaction polling)
        duplex.on('popup:connect', () => (
            this.walletService.startPolling()
        ));

        duplex.on('popup:disconnect', () => (
            this.walletService.stopPolling()
        ));

        // Getter methods
        duplex.on('requestState', ({ resolve }) => resolve(
            this.walletService.state
        ));

        // WalletService: Confirmation responses
        duplex.on('acceptConfirmation', this.walletService.acceptConfirmation);
        duplex.on('rejectConfirmation', this.walletService.rejectConfirmation);

        // WalletService: BLockchain actions
        duplex.on('sendTrx', this.walletService.sendTrx);
        duplex.on('sendBasicToken', this.walletService.sendBasicToken);
        duplex.on('sendSmartToken', this.walletService.sendSmartToken);
        duplex.on('getPrices', this.walletService.getPrices);

        // WalletService: Account management / migration
        duplex.on('addAccount', this.walletService.addAccount);
        duplex.on('selectAccount', this.walletService.selectAccount);
        duplex.on('getAccountDetails', this.walletService.getAccountDetails);
        duplex.on('getAccounts', this.walletService.getAccounts);
        duplex.on('importAccount', this.walletService.importAccount);
        duplex.on('getSelectedAccount', this.walletService.getSelectedAccount);
        duplex.on('addSmartToken', this.walletService.addSmartToken);
        duplex.on('getConfirmations', this.walletService.getConfirmations);
        duplex.on('selectCurrency', this.walletService.selectCurrency);
        duplex.on('deleteAccount', this.walletService.deleteAccount);
        duplex.on('exportAccount', this.walletService.exportAccount);

        // WalletService: State management
        duplex.on('changeState', this.walletService.changeState);
        duplex.on('resetState', this.walletService.resetState);

        // WalletService: Authentication
        duplex.on('setPassword', this.walletService.setPassword);
        duplex.on('unlockWallet', this.walletService.unlockWallet);

        // NodeService: Node management
        duplex.on('selectNode', this.walletService.selectNode);
        duplex.on('addNode', this.walletService.addNode);
        // duplex.on('deleteNode', this.nodeService.deleteNode);
        duplex.on('getNodes', this.nodeService.getNodes);
        duplex.on('getSmartToken', this.nodeService.getSmartToken);
    },

    bindTabDuplex() {
        duplex.on('tabRequest', async ({ hostname, resolve, data: { action, data, uuid } }) => {
            // Abstract this so we can just do resolve(data) or reject(data)
            // and it will map to { success, data, uuid }

            switch(action) {
                case 'init': {
                    const response = {
                        address: false,
                        node: {
                            fullNode: false,
                            solidityNode: false,
                            eventServer: false
                        }
                    };

                    if(StorageService.ready) {
                        const node = NodeService.getCurrentNode();

                        response.address = this.walletService.selectedAccount;
                        response.node = {
                            fullNode: node.fullNode,
                            solidityNode: node.solidityNode,
                            eventServer: node.eventServer
                        };
                    }

                    resolve({
                        success: true,
                        data: response,
                        uuid
                    });
                    break;
                } case 'sign': {
                    if(!this.walletService.selectedAccount) {
                        return resolve({
                            success: false,
                            data: 'User has not unlocked wallet',
                            uuid
                        });
                    }

                    try {
                        const {
                            transaction,
                            input
                        } = data;

                        const {
                            selectedAccount
                        } = this.walletService;

                        const litetokensWeb = NodeService.litetokensWeb;
                        const account = this.walletService.getAccount(selectedAccount);

                        if(typeof input === 'string') {
                            const signedTransaction = await account.sign(input);

                            return this.walletService.queueConfirmation({
                                type: CONFIRMATION_TYPE.STRING,
                                hostname,
                                signedTransaction,
                                input
                            }, uuid, resolve);
                        }

                        const contractType = transaction.raw_data.contract[ 0 ].type;

                        const {
                            mapped,
                            error
                        } = await transactionBuilder(litetokensWeb, contractType, input); // NodeService.getCurrentNode()

                        if(error) {
                            return resolve({
                                success: false,
                                data: 'Invalid transaction provided',
                                uuid
                            });
                        }

                        const signedTransaction = await account.sign(
                            mapped.transaction ||
                            mapped
                        );

                        const whitelist = this.walletService.contractWhitelist[ input.contract_address ];

                        if(contractType === 'TriggerSmartContract' && whitelist) {
                            const expiration = whitelist[ hostname ];

                            if(expiration === -1 || expiration >= Date.now()) {
                                logger.info('Automatically signing transaction', signedTransaction);

                                return resolve({
                                    success: true,
                                    data: signedTransaction,
                                    uuid
                                });
                            }
                        }

                        this.walletService.queueConfirmation({
                            type: CONFIRMATION_TYPE.TRANSACTION,
                            hostname,
                            signedTransaction,
                            contractType,
                            input
                        }, uuid, resolve);
                    } catch(ex) {
                        logger.error('Failed to sign transaction:', ex);

                        return resolve({
                            success: false,
                            data: 'Invalid transaction provided',
                            uuid
                        });
                    }
                    break;
                } default:
                    resolve({
                        success: false,
                        data: 'Unknown method called',
                        uuid
                    });
                    break;
            }
        });
    },

    bindWalletEvents() {
        this.walletService.on('newState', appState => (
            BackgroundAPI.setState(appState)
        ));

        this.walletService.on('setAccount', address => BackgroundAPI.setAccount(
            this.walletService.getAccountDetails(address)
        ));

        this.walletService.on('setNode', node => (
            BackgroundAPI.setNode(node)
        ));

        this.walletService.on('setAccounts', accounts => (
            BackgroundAPI.setAccounts(accounts)
        ));

        this.walletService.on('setConfirmations', confirmations => (
            BackgroundAPI.setConfirmations(confirmations)
        ));

        this.walletService.on('setPriceList', priceList => (
            BackgroundAPI.setPriceList(priceList)
        ));

        this.walletService.on('setCurrency', currency => (
            BackgroundAPI.setCurrency(currency)
        ));
    }
};

backgroundScript.run();