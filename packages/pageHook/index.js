import EventChannel from '@litetokenslink/lib/EventChannel';
import Logger from '@litetokenslink/lib/logger';
import LitetokensWeb from 'litetokensweb';
import Utils from '@litetokenslink/lib/utils';
import RequestHandler from './handlers/RequestHandler';
import ProxiedProvider from './handlers/ProxiedProvider';

const logger = new Logger('pageHook');

const pageHook = {
    proxiedMethods: {
        setAddress: false,
        sign: false
    },

    init() {
        this._bindLitetokensWeb();
        this._bindEventChannel();
        this._bindEvents();

        this.request('init').then(({ address, node }) => {
            if(address)
                this.setAddress(address);

            if(node.fullNode)
                this.setNode(node);

            logger.info('LitetokensLink initiated');
        }).catch(err => {
            logger.info('Failed to initialise LitetokensWeb', err);
        });
    },

    _bindLitetokensWeb() {
        if(window.litetokensWeb !== undefined)
            logger.warn('LitetokensWeb is already initiated. LitetokensLink will overwrite the current instance');

        const litetokensWeb = new LitetokensWeb(
            new ProxiedProvider(),
            new ProxiedProvider(),
            new ProxiedProvider()
        );

        this.proxiedMethods = {
            setAddress: litetokensWeb.setAddress.bind(litetokensWeb),
            sign: litetokensWeb.trx.sign.bind(litetokensWeb)
        };

        [ 'setPrivateKey', 'setAddress', 'setFullNode', 'setSolidityNode', 'setEventServer' ].forEach(method => (
            litetokensWeb[ method ] = () => new Error('LitetokensLink has disabled this method')
        ));

        litetokensWeb.trx.sign = (...args) => (
            this.sign(...args)
        );

        window.litetokensWeb = litetokensWeb;
    },

    _bindEventChannel() {
        this.eventChannel = new EventChannel('pageHook');
        this.request = RequestHandler.init(this.eventChannel);
    },

    _bindEvents() {
        this.eventChannel.on('setAccount', address => (
            this.setAddress(address)
        ));

        this.eventChannel.on('setNode', node => (
            this.setNode(node)
        ));
    },

    setAddress(address) {
        // logger.info('LitetokensLink: New address configured');

        this.proxiedMethods.setAddress(address);
        litetokensWeb.ready = true;
    },

    setNode(node) {
        // logger.info('LitetokensLink: New node configured');

        litetokensWeb.fullNode.configure(node.fullNode);
        litetokensWeb.solidityNode.configure(node.solidityNode);
        litetokensWeb.eventServer.configure(node.eventServer);
    },

    sign(transaction, privateKey = false, useLitetokensHeader = true, callback = false) {
        if(Utils.isFunction(privateKey)) {
            callback = privateKey;
            privateKey = false;
        }

        if(Utils.isFunction(useLitetokensHeader)) {
            callback = useLitetokensHeader;
            useLitetokensHeader = true;
        }

        if(!callback)
            return Utils.injectPromise(this.sign.bind(this), transaction, privateKey, useLitetokensHeader);

        if(privateKey)
            return this.proxiedMethods.sign(transaction, privateKey, useLitetokensHeader, callback);

        if(!transaction)
            return callback('Invalid transaction provided');

        if(!litetokensWeb.ready)
            return callback('User has not unlocked wallet');

        this.request('sign', {
            transaction,
            useLitetokensHeader,
            input: (
                typeof transaction === 'string' ?
                    transaction :
                    transaction.__payload__ ||
                    transaction.raw_data.contract[ 0 ].parameter.value
            )
        }).then(transaction => (
            callback(null, transaction)
        )).catch(err => {
            logger.warn('Failed to sign transaction:', err);
            callback(err);
        });
    }
};

pageHook.init();
