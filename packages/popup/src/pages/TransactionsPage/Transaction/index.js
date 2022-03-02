import React from 'react';
import moment from 'moment';
import LitetokensWeb from 'litetokensweb';

import { SUPPORTED_CONTRACTS } from '@litetokenslink/lib/constants';

import {
    FormattedMessage,
    FormattedNumber
} from 'react-intl';

import './Transaction.scss';

const SUFFIX = {
    from: 'Sent',
    to: 'Received'
};

const renderAmount = (type, transaction, direction) => {
    let amount = false;

    switch(type) {
        case 'FreezeBalanceContract':
            amount = transaction.raw.value.frozen_balance / 1000000;
            direction = 'from';
            break;
        case 'TransferContract':
            amount = transaction.amount / 1000000;
            break;
        case 'TransferAssetContract':
            amount = transaction.amount;
            break;
        default: break;
    }

    if(amount === false)
        return null;

    if(direction) {
        return (
            <FormattedNumber
                value={ amount }
                maximumFractionDigits={ 6 }
                children={ amount => (
                    <div className={ `transactionAmount direction-${ direction }` }>
                        { direction === 'from' ? '-' : '+' } { amount }
                    </div>
                ) }
            />
        );
    }

    return (
        <FormattedNumber
            value={ amount }
            maximumFractionDigits={ 6 }
            children={ amount => (
                <div className='transactionAmount'>
                    { amount }
                </div>
            ) }
        />
    );
};

const renderType = (type, direction) => {
    let localeID;

    switch(type) {
        case 'TransferContract':
        case 'TransferAssetContract':
            localeID = type + SUFFIX[ direction ];
            break;
        default:
            localeID = type;
            break;
    }

    return (
        <FormattedMessage id={ `TRANSACTIONS.TYPE.${ localeID }` } children={ type => (
            <div className={ `transactionType type-${ localeID }` }>
                { type }
            </div>
        )}
        />
    );
};

const transformAddress = address => {
    const transformedAddress = LitetokensWeb.address.fromHex(address);

    const shortAddress = [
        transformedAddress.substr(0, 20),
        transformedAddress.substr(28)
    ].join('...');

    return shortAddress;
};

const renderAddress = address => {
    const transformedAddress = transformAddress(address);

    return (
        <div className='transactionAddress mono'>
            { transformedAddress }
        </div>
    );
};

const renderDetails = (type, transaction) => {
    const recipient = transaction.direction === 'from' ?
        transaction.recipient :
        transaction.sender;

    switch(type) {
        case 'TransferContract':
            return renderAddress(recipient);
        case 'TriggerSmartContract':
            return renderAddress(transaction.raw.value.contract_address);
        case 'FreezeBalanceContract':
            return (
                <FormattedMessage
                    id='TRANSACTIONS.FROZE_BALANCE'
                    values={{
                        duration: transaction.raw.value.frozen_duration
                    }}
                />
            );
        case 'TransferAssetContract':
            return (
                <React.Fragment>
                    <FormattedMessage
                        id={
                            transaction.direction === 'from' ?
                                'TRANSACTIONS.SENT_TOKEN' :
                                'TRANSACTIONS.RECEIVED_TOKEN'
                        }
                        values={{
                            token: transaction.token,
                            amount: transaction.amount,
                            address: transformAddress(recipient)
                        }}
                        children={ string => (
                            <div className='transactionAddress mono'>
                                { string }
                            </div>
                        )}
                    />
                </React.Fragment>
            );
        default:
            return null;
    }
};

const Transaction = ({ transaction }) => {
    const {
        direction = false,
        timestamp,
        type
    } = transaction;

    if(!SUPPORTED_CONTRACTS.includes(type))
        return null;

    // Show fee if receipt.net_usage has a value?

    return (
        <div className='transaction'>
            <div className='transactionDetails'>
                { renderType(type, direction) }
                { renderDetails(type, transaction) }
            </div>
            <div className='transactionMeta'>
                { renderAmount(type, transaction, direction) }
                <div className='transactionDate'>
                    { moment(timestamp).format('MMMM D, YYYY') }
                </div>
            </div>
        </div>
    );
};

export default Transaction;