import React from 'react';
import WalletOption from 'components/WalletOption';

import { FormattedMessage } from 'react-intl';
import { APP_STATE } from '@litetokenslink/lib/constants';
import { PopupAPI } from '@litetokenslink/lib/api';

const onCreationSelect = () => PopupAPI.changeState(APP_STATE.CREATING);
const onRestoreSelect = () => PopupAPI.changeState(APP_STATE.RESTORING);

const WalletCreationController = () => (
    <div className='insetContainer'>
        <div className='pageHeader'>
            LitetokensLink
        </div>
        <div className='greyModal'>
            <FormattedMessage
                id='CREATION'
                children={ text => (
                    <div className='modalDesc hasBottomMargin'>
                        { text }
                    </div>
                ) }
            />
            <WalletOption tabIndex={ 1 } className='hasBottomMargin' name='CREATION.CREATE' onClick={ onCreationSelect } />
            <WalletOption tabIndex={ 2 } name='CREATION.RESTORE' onClick={ onRestoreSelect } />
        </div>
    </div>
);

export default WalletCreationController;